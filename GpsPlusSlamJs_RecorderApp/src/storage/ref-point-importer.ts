/**
 * Reference Point Importer Module
 *
 * Extracts reference points from ZIP files in a folder, enabling reuse of
 * ref points from previous recording sessions.
 *
 * This module:
 * 1. Enumerates all *.zip files in a folder
 * 2. Opens each ZIP and looks for refPoints/*.json files
 * 3. Parses and validates each ref point definition
 * 4. Merges and deduplicates ref points by ID
 *
 * Uses @zip.js/zip.js for ZIP reading (same library as zip-export.ts).
 */

import type { RefPointDefinition } from './ref-point-loader';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  h3CellsMatch,
  isH3Index,
} from 'gps-plus-slam-app-framework/geo/h3-proximity';
import {
  extractRefPointEntriesFromZip,
  isRefPointDefinitionShape,
  isZipFileName,
} from './ref-point-zip-helpers';

const log = createLogger('RefPointImporter');

// ============================================================================
// Types
// ============================================================================

/**
 * Simplified reference point for import/suggestion purposes.
 * Contains only the essential data needed for ref point suggestions and display.
 * The `lat`/`lon` are kept for "nearby ref point" proximity suggestions.
 */
export interface ImportedRefPoint {
  /** Unique identifier — H3 hex index since the March 2026 H3 migration */
  readonly id: string;
  /** Human-readable display name entered by the user (e.g., "Bench Corner") */
  readonly name: string;
  /** Latitude from first observation (for future proximity-based suggestions) */
  readonly lat: number;
  /** Longitude from first observation */
  readonly lon: number;
  /** Optional altitude */
  readonly alt?: number;
  /** Source ZIP file name for debugging/tracking */
  readonly sourceZipName: string;
}

/**
 * Result from importing reference points from a folder.
 */
export interface RefPointImportResult {
  /** Whether the import completed (even with some errors) */
  readonly success: boolean;
  /** Merged, deduplicated reference points from all ZIPs */
  readonly refPoints: ImportedRefPoint[];
  /** Number of ZIP files successfully scanned */
  readonly zipFilesScanned: number;
  /** Error messages from failed ZIPs or malformed ref points */
  readonly errors: string[];
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Type guard to validate parsed JSON matches RefPointDefinition shape.
 * Builds on the shared base predicate and additionally requires the first
 * observation to expose a `gpsPoint` with numeric `latitude`/`longitude`,
 * because this importer needs those coordinates for proximity suggestions.
 */
function isValidRefPointDefinition(
  value: unknown
): value is RefPointDefinition {
  if (!isRefPointDefinitionShape(value)) {
    return false;
  }

  // Empty observations is technically valid (though unusual)
  if (value.observations.length === 0) {
    return true;
  }

  // Check first observation has valid structure
  const firstObs = value.observations[0] as unknown as Record<string, unknown>;
  if (typeof firstObs !== 'object' || firstObs === null) {
    return false;
  }

  // Check gpsPoint exists with lat/lon
  const gpsPoint = firstObs.gpsPoint as Record<string, unknown> | undefined;
  if (
    typeof gpsPoint !== 'object' ||
    gpsPoint === null ||
    typeof gpsPoint.latitude !== 'number' ||
    typeof gpsPoint.longitude !== 'number'
  ) {
    return false;
  }

  return true;
}

/**
 * Convert a RefPointDefinition to an ImportedRefPoint.
 * Extracts GPS coordinates from the first observation.
 */
function toImportedRefPoint(
  def: RefPointDefinition,
  sourceZipName: string
): ImportedRefPoint | null {
  if (def.observations.length === 0) {
    // No observations - can't get GPS coordinates
    return null;
  }

  const firstObs = def.observations[0]!;
  return {
    id: def.id,
    name: def.name,
    lat: firstObs.gpsPoint.latitude,
    lon: firstObs.gpsPoint.longitude,
    alt: firstObs.gpsPoint.altitude,
    sourceZipName,
  };
}

// ============================================================================
// ZIP Processing
// ============================================================================

/**
 * Extract reference points from a single ZIP file.
 *
 * @param zipBlob - The ZIP file as a Blob
 * @param zipFileName - Name of the ZIP file (for error messages)
 * @returns Array of imported ref points and any errors
 */
async function extractRefPointsFromZip(
  zipBlob: Blob,
  zipFileName: string
): Promise<{ refPoints: ImportedRefPoint[]; errors: string[] }> {
  const { items, errors } = await extractRefPointEntriesFromZip(
    zipBlob,
    zipFileName,
    isValidRefPointDefinition,
    (def) => toImportedRefPoint(def, zipFileName)
  );
  return { refPoints: items, errors };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Import reference points from all ZIP files in a folder.
 *
 * Enumerates all *.zip files in the folder, extracts refPoints/*.json from each,
 * and merges them into a deduplicated list.
 *
 * Deduplication: If the same ref point ID appears in multiple ZIPs, the first
 * occurrence is kept (based on iteration order).
 *
 * @param folderHandle - Read-only directory handle from showDirectoryPicker
 * @returns Result containing merged ref points, scan count, and errors
 */
export async function importRefPointsFromFolder(
  folderHandle: FileSystemDirectoryHandle
): Promise<RefPointImportResult> {
  const allRefPoints: ImportedRefPoint[] = [];
  const seenIds = new Set<string>();
  const allErrors: string[] = [];
  let zipFilesScanned = 0;

  // Deduplicate one ZIP's points into the accumulator: for H3 IDs, gridDisk
  // overlap catches GPS jitter; legacy string IDs use exact match. (Extracted
  // from the scan loop to keep its nesting readable.)
  const mergeRefPoints = (
    refPoints: readonly ImportedRefPoint[],
    entryName: string
  ): void => {
    for (const refPoint of refPoints) {
      const isDuplicate = isH3Index(refPoint.id)
        ? allRefPoints.some(
            (existing) =>
              isH3Index(existing.id) && h3CellsMatch(existing.id, refPoint.id)
          )
        : seenIds.has(refPoint.id);

      if (!isDuplicate) {
        seenIds.add(refPoint.id);
        allRefPoints.push(refPoint);
      } else {
        log.debug(
          `Skipping duplicate ref point: ${refPoint.id} from ${entryName}`
        );
      }
    }
  };

  log.info(`Scanning folder: ${folderHandle.name}`);

  try {
    // Iterate over all entries in the folder
    for await (const entry of folderHandle.values()) {
      // Skip non-files and non-ZIPs
      if (entry.kind !== 'file' || !isZipFileName(entry.name)) {
        continue;
      }

      log.debug(`Processing ZIP: ${entry.name}`);

      try {
        // Get file handle and read blob
        const fileHandle = await folderHandle.getFileHandle(entry.name);
        const file = await fileHandle.getFile();

        // Extract ref points from this ZIP
        const { refPoints, errors } = await extractRefPointsFromZip(
          file,
          entry.name
        );

        zipFilesScanned++;
        allErrors.push(...errors);
        mergeRefPoints(refPoints, entry.name);
      } catch (zipErr) {
        const errorMsg = `Failed to process ${entry.name}: ${(zipErr as Error).message}`;
        log.warn(errorMsg);
        allErrors.push(errorMsg);
      }
    }

    log.info(
      `Imported ${allRefPoints.length} ref points from ${zipFilesScanned} ZIP files`
    );

    return {
      success: true,
      refPoints: allRefPoints,
      zipFilesScanned,
      errors: allErrors,
    };
  } catch (err) {
    const errorMsg = `Failed to scan folder: ${(err as Error).message}`;
    log.error(errorMsg);
    return {
      success: false,
      refPoints: allRefPoints,
      zipFilesScanned,
      errors: [...allErrors, errorMsg],
    };
  }
}
