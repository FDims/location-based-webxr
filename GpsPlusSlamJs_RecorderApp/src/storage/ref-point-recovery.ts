/**
 * Reference Point Recovery Module
 *
 * Extracts full RefPointDefinition objects from ZIP files in a folder and
 * merges observations by ref point ID. Unlike ref-point-importer.ts (which
 * returns simplified ImportedRefPoint with only lat/lon), this module
 * preserves complete observation data (AR poses, GPS, timestamps) needed
 * for 3D display and OPFS restoration after browser data loss.
 *
 * Used by the recovery flow: when OPFS is empty after browser data clear,
 * this module reconstructs the full scenario-level ref point state from
 * session ZIPs so the user can continue recording with prior ref points visible.
 *
 * Uses @zip.js/zip.js for ZIP reading (same library as zip-export.ts
 * and ref-point-importer.ts).
 */

import type { RefPointDefinition } from './ref-point-loader';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { loadSessionMetadataFromBlob } from 'gps-plus-slam-app-framework/storage/zip-reader';
import {
  extractRefPointEntriesFromZip,
  isRefPointDefinitionShape,
  isZipFileName,
} from './ref-point-zip-helpers';
import {
  parseDateFromSessionFilename,
  resolveScenarioNameFromMetadata,
} from './session-zip-naming';

const log = createLogger('RefPointRecovery');

// ============================================================================
// Types
// ============================================================================

/**
 * Progress of the full-folder indexing pass, emitted once per processed ZIP.
 * (Module-private until a consumer needs the named type — knip flags unused
 * exports; the Slice-2 folder-manager integration re-exports it when needed.)
 */
interface RefPointIndexProgress {
  /** ZIPs processed so far (including ZIPs that failed to read) */
  readonly done: number;
  /** Total ZIP files discovered in the folder */
  readonly total: number;
}

/**
 * Result of the scenario-aware full-folder indexing pass.
 */
export interface RefPointIndexResult {
  /**
   * Merged, deduplicated definitions grouped by the scenario each ZIP
   * belongs to (session.json `contextTag` → legacy `scenarioName` →
   * `DEFAULT_SCENARIO`; see `resolveScenarioNameFromMetadata`).
   * Each bucket is in first-encounter order — newest recording first
   * (D4b-ii) — which the folder-manager gap-fill acceptance relies on.
   */
  readonly definitionsByScenario: Map<string, RefPointDefinition[]>;
  /** Number of ZIP files successfully scanned */
  readonly zipFilesScanned: number;
  /** Error messages from failed ZIPs or malformed ref points */
  readonly errors: string[];
}

/** Options for {@link indexRefPointDefinitionsFromFolder}. */
export interface RefPointIndexOptions {
  /** Called with `{done: 0, total}` before the first ZIP, then after each ZIP. */
  onProgress?: (progress: RefPointIndexProgress) => void;
  /** Abort the pass (checked before each ZIP); throws DOMException AbortError. */
  signal?: AbortSignal;
}

/**
 * Result of recovering ref point definitions from ZIP files.
 */
export interface RefPointRecoveryResult {
  /** Merged, deduplicated RefPointDefinition objects from all ZIPs */
  readonly definitions: RefPointDefinition[];
  /** Number of ZIP files successfully scanned */
  readonly zipFilesScanned: number;
  /** Error messages from failed ZIPs or malformed ref points */
  readonly errors: string[];
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate parsed JSON matches RefPointDefinition shape.
 * Looser than ref-point-loader's validator: accepts empty observations
 * (schema-valid, preserves identity) and doesn't require arPose/gpsPoint
 * validation on every observation (the importer's validator already checks
 * first obs structure).
 */
const isValidRefPointDefinition = isRefPointDefinitionShape;

// ============================================================================
// ZIP Processing
// ============================================================================

/**
 * Extract full RefPointDefinition objects from a single ZIP file.
 */
async function extractDefinitionsFromZip(
  zipBlob: Blob,
  zipFileName: string
): Promise<{ definitions: RefPointDefinition[]; errors: string[] }> {
  const { items, errors } = await extractRefPointEntriesFromZip(
    zipBlob,
    zipFileName,
    isValidRefPointDefinition,
    (def) => def
  );
  return { definitions: items, errors };
}

// ============================================================================
// Merge Logic
// ============================================================================

/**
 * Merge observations from multiple RefPointDefinitions with the same ID.
 * Deduplicates observations by sessionId + timestamp.
 * Uses earliest createdAt and first-encountered name.
 *
 * `order` controls the output ordering: `'createdAt'` (legacy recovery
 * behavior, deterministic display order) or `'encounter'` (first-encounter
 * order — the indexing pass feeds definitions newest-recording-first, and the
 * folder-manager gap-fill acceptance walks the result in order, so the newest
 * definition must come first; D4b-ii).
 */
function mergeDefinitions(
  allDefs: RefPointDefinition[],
  order: 'createdAt' | 'encounter' = 'createdAt'
): RefPointDefinition[] {
  const byId = new Map<
    string,
    { def: RefPointDefinition; seen: Set<string> }
  >();

  for (const def of allDefs) {
    let entry = byId.get(def.id);
    if (!entry) {
      entry = {
        def: {
          id: def.id,
          name: def.name,
          createdAt: def.createdAt,
          observations: [],
        },
        seen: new Set<string>(),
      };
      byId.set(def.id, entry);
    } else if (def.createdAt < entry.def.createdAt) {
      entry.def.createdAt = def.createdAt;
    }

    // Unified dedup: every observation (initial or merged) passes through seen
    for (const obs of def.observations) {
      const key = `${obs.sessionId}:${obs.timestamp}`;
      if (!entry.seen.has(key)) {
        entry.seen.add(key);
        entry.def.observations.push(obs);
      }
    }
  }

  const merged = Array.from(byId.values()).map((e) => e.def);
  if (order === 'encounter') {
    // Map iteration preserves insertion order = first-encounter order.
    return merged;
  }
  // Sort by createdAt for deterministic output
  return merged.sort((a, b) => a.createdAt - b.createdAt);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract full RefPointDefinition objects from all ZIPs in a folder,
 * merge observations by ref point ID, and return the merged definitions.
 *
 * Unlike importRefPointsFromFolder() which returns simplified ImportedRefPoint[],
 * this preserves full observation data (AR poses, GPS, timestamps) needed for
 * 3D display and OPFS recovery.
 *
 * @param folderHandle - Read-only directory handle from showDirectoryPicker
 * @returns Result containing merged definitions, scan count, and errors
 */
export async function recoverRefPointDefinitionsFromZips(
  folderHandle: FileSystemDirectoryHandle
): Promise<RefPointRecoveryResult> {
  const allDefinitions: RefPointDefinition[] = [];
  const allErrors: string[] = [];
  let zipFilesScanned = 0;

  log.info(`Recovery scan: ${folderHandle.name}`);

  try {
    for await (const entry of folderHandle.values()) {
      if (entry.kind !== 'file' || !isZipFileName(entry.name)) continue;

      log.debug(`Processing ZIP: ${entry.name}`);

      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        const { definitions, errors } = await extractDefinitionsFromZip(
          file,
          entry.name
        );

        zipFilesScanned++;
        allErrors.push(...errors);
        allDefinitions.push(...definitions);
      } catch (zipErr) {
        const errorMsg = `Failed to process ${entry.name}: ${(zipErr as Error).message}`;
        log.warn(errorMsg);
        allErrors.push(errorMsg);
      }
    }

    const merged = mergeDefinitions(allDefinitions);
    log.info(
      `Recovered ${merged.length} ref points from ${zipFilesScanned} ZIP files`
    );

    return {
      definitions: merged,
      zipFilesScanned,
      errors: allErrors,
    };
  } catch (err) {
    const errorMsg = `Failed to scan folder: ${(err as Error).message}`;
    log.error(errorMsg);
    return {
      definitions: mergeDefinitions(allDefinitions),
      zipFilesScanned,
      errors: [...allErrors, errorMsg],
    };
  }
}

// ============================================================================
// Scenario-aware full-folder indexing pass (2026-07-05 folder-import plan)
// ============================================================================

/** Throw a DOMException AbortError when the signal has fired. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

/**
 * Collect the folder's ZIP file entries sorted newest-first (D4b-ii): by the
 * timestamp in the filename (`..._YYYY-MM-DD_HH-MM-SSutc.zip`); non-conforming
 * names fall back to `File.lastModified` so renamed archives still sort
 * roughly by age instead of clumping at one end. Name-descending tiebreak
 * keeps the order deterministic.
 *
 * Collecting before processing lets the caller know the total up front — the
 * progress UI needs a determinate bar from the first event.
 */
async function collectZipEntriesNewestFirst(
  folderHandle: FileSystemDirectoryHandle
): Promise<Array<{ name: string; handle: FileSystemFileHandle }>> {
  const zips: Array<{
    name: string;
    handle: FileSystemFileHandle;
    sortKey: number;
  }> = [];
  for await (const entry of folderHandle.values()) {
    if (entry.kind !== 'file' || !isZipFileName(entry.name)) continue;
    const handle = entry as FileSystemFileHandle;
    let sortKey = parseDateFromSessionFilename(entry.name)?.getTime();
    if (sortKey === undefined) {
      try {
        sortKey = (await handle.getFile()).lastModified;
      } catch {
        sortKey = 0;
      }
    }
    zips.push({ name: entry.name, handle, sortKey });
  }
  zips.sort((a, b) => b.sortKey - a.sortKey || b.name.localeCompare(a.name));
  return zips;
}

/**
 * Resolve the scenario a recording ZIP belongs to from its `session.json`.
 * Unreadable/missing metadata resolves to the canonical default scenario,
 * consistent with `discoverScenariosFromZipMetadata`.
 */
async function resolveZipScenario(file: File): Promise<string> {
  let metadata: Record<string, unknown> | null;
  try {
    metadata = await loadSessionMetadataFromBlob(file);
  } catch {
    metadata = null;
  }
  return resolveScenarioNameFromMetadata(metadata);
}

/** Append definitions to a scenario's bucket, creating the bucket on demand. */
function appendToBucket(
  buckets: Map<string, RefPointDefinition[]>,
  scenario: string,
  definitions: RefPointDefinition[]
): void {
  const bucket = buckets.get(scenario);
  if (bucket) {
    bucket.push(...definitions);
  } else {
    buckets.set(scenario, [...definitions]);
  }
}

/**
 * Index every recording ZIP in the folder into per-scenario ref-point
 * definitions (decisions D1/D4/D4a/D4b-ii of the 2026-07-05 folder-import
 * feedback):
 *
 * - **Newest-first (D4b-ii):** ZIPs are sorted descending by the timestamp in
 *   their filename (`..._YYYY-MM-DD_HH-MM-SSutc.zip`; non-conforming names
 *   fall back to `File.lastModified`), so when the same ref-point id occurs
 *   in several recordings the newest one provides the canonical metadata
 *   (`name`) while observations are unioned and `createdAt` keeps the
 *   earliest value (see `mergeDefinitions`).
 * - **Strict per-scenario routing (D4a):** each ZIP's definitions land only
 *   in the bucket of that ZIP's scenario (from its `session.json`); the same
 *   id under two scenarios stays in both buckets, unmerged.
 * - **Observable:** `onProgress` fires with `{done: 0, total}` before the
 *   first ZIP and once after each ZIP — including failed ones, so a progress
 *   bar never stalls on a corrupt archive (whose failure is reported via
 *   `errors` instead).
 * - **Abortable:** `signal` is checked before each ZIP; aborting throws a
 *   DOMException `AbortError`. The function is pure with respect to storage —
 *   persistence is the caller's job (folder-manager), so an abort never
 *   leaves a half-written store behind.
 *
 * @param folderHandle - Read-only directory handle from showDirectoryPicker
 * @param options - Optional progress callback and abort signal
 * @returns Per-scenario merged definitions, scan count, and errors
 */
export async function indexRefPointDefinitionsFromFolder(
  folderHandle: FileSystemDirectoryHandle,
  options: RefPointIndexOptions = {}
): Promise<RefPointIndexResult> {
  const { onProgress, signal } = options;
  throwIfAborted(signal);

  log.info(`Index scan: ${folderHandle.name}`);

  const zips = await collectZipEntriesNewestFirst(folderHandle);
  const total = zips.length;
  const rawByScenario = new Map<string, RefPointDefinition[]>();
  const allErrors: string[] = [];
  let done = 0;
  let zipFilesScanned = 0;
  onProgress?.({ done, total });

  for (const zip of zips) {
    throwIfAborted(signal);
    try {
      const file = await zip.handle.getFile();
      const scenario = await resolveZipScenario(file);
      const { definitions, errors } = await extractDefinitionsFromZip(
        file,
        zip.name
      );
      zipFilesScanned++;
      allErrors.push(...errors);
      appendToBucket(rawByScenario, scenario, definitions);
    } catch (zipErr) {
      const errorMsg = `Failed to process ${zip.name}: ${(zipErr as Error).message}`;
      log.warn(errorMsg);
      allErrors.push(errorMsg);
    }
    done++;
    onProgress?.({ done, total });
  }

  // Merge per scenario only (D4a). Buckets were filled newest-first, so the
  // first-encountered name inside mergeDefinitions is the newest recording's,
  // and 'encounter' order keeps the newest definition first in each bucket
  // (the gap-fill acceptance loop in folder-manager relies on this; D4b-ii).
  const definitionsByScenario = new Map<string, RefPointDefinition[]>();
  for (const [scenario, defs] of rawByScenario) {
    definitionsByScenario.set(scenario, mergeDefinitions(defs, 'encounter'));
  }

  log.info(
    `Indexed ${definitionsByScenario.size} scenario(s) from ${zipFilesScanned}/${total} ZIP files`
  );

  return { definitionsByScenario, zipFilesScanned, errors: allErrors };
}
