/**
 * Tests for ref-point-recovery.ts
 *
 * Recovery module: extracts full RefPointDefinition objects from ZIP files
 * and merges observations by H3 cell ID. Unlike ref-point-importer (which
 * returns simplified ImportedRefPoint for display), this module preserves
 * complete observation data (AR poses, GPS, timestamps) needed for 3D
 * display and OPFS restoration after browser data loss.
 *
 * @module ref-point-recovery.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlobWriter, ZipWriter, TextReader } from '@zip.js/zip.js';
import type {
  RefPointDefinition,
  RefPointObservation,
} from './ref-point-loader';
import type { GpsPoint } from 'gps-plus-slam-app-framework/core';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock FileSystemDirectoryHandle for testing.
 * Same pattern as ref-point-importer.test.ts.
 */
function createMockFolderHandle(
  entries: Array<{
    name: string;
    kind: 'file' | 'directory';
    getFile?: () => Promise<File>;
  }>
): FileSystemDirectoryHandle {
  return {
    kind: 'directory' as const,
    name: 'test-folder',
    values: vi.fn(() => {
      let index = 0;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          if (index < entries.length) {
            return Promise.resolve({
              value: entries[index++],
              done: false as const,
            });
          }
          return Promise.resolve({ value: undefined, done: true as const });
        },
      };
    }),
    getFileHandle: vi.fn((name: string) => {
      const entry = entries.find((e) => e.name === name && e.kind === 'file');
      if (!entry) {
        return Promise.reject(new Error(`File not found: ${name}`));
      }
      return Promise.resolve(entry);
    }),
  } as unknown as FileSystemDirectoryHandle;
}

/** Build a realistic GpsPoint with all required fields. */
function makeGpsPoint(lat: number, lon: number, alt: number = 100): GpsPoint {
  return {
    id: `gps-${Date.now()}`,
    zeroRef: { lat, lon },
    latitude: lat,
    longitude: lon,
    altitude: alt,
    latLongAccuracy: 5,
    coordinates: [0, 0, 0],
    weight: 1,
    timestamp: Date.now(),
  };
}

/** Build a RefPointObservation with all required nested fields. */
function makeObservation(
  sessionId: string,
  timestamp: number,
  lat: number = 50.0,
  lon: number = 8.0
): RefPointObservation {
  return {
    sessionId,
    timestamp,
    arPose: {
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
    },
    gpsPoint: makeGpsPoint(lat, lon),
  };
}

/** Build a RefPointDefinition with the given observations. */
function makeRefPointDef(
  id: string,
  name: string,
  observations: RefPointObservation[]
): RefPointDefinition {
  return {
    id,
    name,
    createdAt: observations.length > 0 ? observations[0].timestamp : Date.now(),
    observations,
  };
}

/**
 * Create a ZIP blob containing ref point definitions and an optional session.json.
 *
 * `metadataField` controls how the scenario name is carried (mirrors the
 * production zips): `'scenarioName'` (legacy field, default — matches the
 * older tests), `'contextTag'` (current framework field), or `'none'`
 * (no session.json at all → indexing must fall back to DEFAULT_SCENARIO).
 */
async function createTestZipBlob(
  refPoints: RefPointDefinition[],
  scenarioName: string = 'TestScenario',
  metadataField: 'scenarioName' | 'contextTag' | 'none' = 'scenarioName'
): Promise<Blob> {
  const blobWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(blobWriter, { level: 0 });

  if (metadataField !== 'none') {
    await zipWriter.add(
      'session.json',
      new TextReader(
        JSON.stringify({
          version: 1,
          startedAt: new Date().toISOString(),
          ...(metadataField === 'contextTag'
            ? { contextTag: scenarioName }
            : { scenarioName }),
          actionCount: 0,
          frameCount: 0,
          userAgent: 'test',
        })
      )
    );
  }

  for (const rp of refPoints) {
    await zipWriter.add(
      `refPoints/${rp.id}.json`,
      new TextReader(JSON.stringify(rp))
    );
  }

  return zipWriter.close();
}

/** Create a mock file entry (matching the pattern from importer tests). */
function createMockFileEntry(
  name: string,
  blob: Blob
): { name: string; kind: 'file'; getFile: () => Promise<File> } {
  return {
    name,
    kind: 'file' as const,
    getFile: () =>
      Promise.resolve(new File([blob], name, { type: 'application/zip' })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ref-point-recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recoverRefPointDefinitionsFromZips', () => {
    /**
     * Why this test matters:
     * Empty folder is the base case — recovery should not crash and
     * should return an empty result set.
     */
    it('should return empty definitions for empty folder', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const folderHandle = createMockFolderHandle([]);
      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toEqual([]);
      expect(result.zipFilesScanned).toBe(0);
      expect(result.errors).toEqual([]);
    });

    /**
     * Why this test matters:
     * Core recovery scenario — a single ZIP with one ref point should return
     * the full RefPointDefinition including all observation data (AR poses,
     * GPS, timestamps) needed for 3D display and OPFS restoration.
     */
    it('should extract full RefPointDefinition from single ZIP', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const obs = makeObservation('session-1', 1000, 50.1, 8.1);
      const def = makeRefPointDef('h3-cell-a', 'Bench', [obs]);
      const zipBlob = await createTestZipBlob([def]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('h3-cell-a');
      expect(result.definitions[0].name).toBe('Bench');
      expect(result.definitions[0].observations).toHaveLength(1);
      // Full observation data preserved (not simplified to lat/lon)
      expect(result.definitions[0].observations[0].arPose.position).toEqual([
        1, 2, 3,
      ]);
      expect(
        result.definitions[0].observations[0].gpsPoint.latitude
      ).toBeCloseTo(50.1);
      expect(result.definitions[0].observations[0].sessionId).toBe('session-1');
      expect(result.zipFilesScanned).toBe(1);
    });

    /**
     * Why this test matters:
     * The key merge scenario — same H3 cell observed in two different session
     * ZIPs. Observations must be unioned (not deduplicated by first-wins like
     * the simplified importer). This is what enables full OPFS reconstruction.
     */
    it('should merge observations from multiple ZIPs for the same ref point ID', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const obs1 = makeObservation('session-1', 1000, 50.1, 8.1);
      const obs2 = makeObservation('session-2', 2000, 50.1001, 8.1001);

      const def1 = makeRefPointDef('h3-cell-a', 'Bench', [obs1]);
      const def2 = makeRefPointDef('h3-cell-a', 'Bench Renamed', [obs2]);

      const zip1 = await createTestZipBlob([def1]);
      const zip2 = await createTestZipBlob([def2]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zip1),
        createMockFileEntry('session-2.zip', zip2),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('h3-cell-a');
      // Observations from both ZIPs merged
      expect(result.definitions[0].observations).toHaveLength(2);
      // Uses earliest createdAt
      expect(result.definitions[0].createdAt).toBe(1000);
      // Uses first-encountered name (consistent with current first-name-wins behavior)
      expect(result.definitions[0].name).toBe('Bench');
      expect(result.zipFilesScanned).toBe(2);
    });

    /**
     * Why this test matters:
     * Different H3 cells must remain separate — the merge is by ID only.
     */
    it('should keep different H3 cell ref points separate', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const defA = makeRefPointDef('h3-cell-a', 'Bench', [
        makeObservation('session-1', 1000, 50.1, 8.1),
      ]);
      const defB = makeRefPointDef('h3-cell-b', 'Tree', [
        makeObservation('session-1', 1001, 50.2, 8.2),
      ]);

      const zip1 = await createTestZipBlob([defA]);
      const zip2 = await createTestZipBlob([defB]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zip1),
        createMockFileEntry('session-2.zip', zip2),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(2);
      const ids = result.definitions.map((d) => d.id).sort();
      expect(ids).toEqual(['h3-cell-a', 'h3-cell-b']);
    });

    /**
     * Why this test matters:
     * Deduplication by sessionId + timestamp prevents double-counting when
     * the same observation appears in multiple exports (e.g., periodic sync
     * re-exports).
     */
    it('should deduplicate observations by sessionId + timestamp', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      // Same observation in two ZIPs (periodic sync produced both)
      const obs = makeObservation('session-1', 1000, 50.1, 8.1);
      const def1 = makeRefPointDef('h3-cell-a', 'Bench', [obs]);
      const def2 = makeRefPointDef('h3-cell-a', 'Bench', [obs]);

      const zip1 = await createTestZipBlob([def1]);
      const zip2 = await createTestZipBlob([def2]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zip1),
        createMockFileEntry('session-1-final.zip', zip2),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      // Only one observation despite appearing in two ZIPs
      expect(result.definitions[0].observations).toHaveLength(1);
    });

    /**
     * Why this test matters:
     * ZIPs without refPoints/ should not cause errors — many session ZIPs
     * from before the Problem 3 fix have no ref points.
     */
    it('should handle ZIP without refPoints folder gracefully', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter, { level: 0 });
      await zipWriter.add('session.json', new TextReader('{}'));
      const zipBlob = await zipWriter.close();

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('old-session.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toEqual([]);
      expect(result.zipFilesScanned).toBe(1);
      expect(result.errors).toEqual([]);
    });

    /**
     * Why this test matters:
     * Malformed JSON should be reported but not block recovery of other
     * ref points from the same or other ZIPs.
     */
    it('should log error for malformed JSON and continue', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      // ZIP with one valid and one malformed ref point
      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter, { level: 0 });
      await zipWriter.add('session.json', new TextReader('{}'));
      await zipWriter.add(
        'refPoints/bad.json',
        new TextReader('{ invalid json }')
      );
      const validDef = makeRefPointDef('good-point', 'Good', [
        makeObservation('session-1', 1000),
      ]);
      await zipWriter.add(
        'refPoints/good-point.json',
        new TextReader(JSON.stringify(validDef))
      );
      const zipBlob = await zipWriter.close();

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('good-point');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('bad.json');
    });

    /**
     * Why this test matters:
     * Corrupt ZIPs should not block recovery from other valid ZIPs
     * in the same folder.
     */
    it('should continue after corrupt ZIP', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const validDef = makeRefPointDef('point-b', 'Point B', [
        makeObservation('session-2', 2000),
      ]);
      const validZip = await createTestZipBlob([validDef]);
      const corruptZip = new Blob(['not a zip'], {
        type: 'application/zip',
      });

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('corrupt.zip', corruptZip),
        createMockFileEntry('valid.zip', validZip),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('point-b');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    /**
     * Why this test matters:
     * Non-ZIP files in the folder should be silently ignored.
     */
    it('should ignore non-ZIP files', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const folderHandle = createMockFolderHandle([
        {
          name: 'readme.txt',
          kind: 'file',
          getFile: () => Promise.resolve(new File(['text'], 'readme.txt')),
        },
        { name: 'subfolder', kind: 'directory' },
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toEqual([]);
      expect(result.zipFilesScanned).toBe(0);
    });

    /**
     * Why this test matters:
     * Empty observations is technically valid per the schema but has no
     * useful data for recovery. The definition should still be included
     * (it preserves the ref point identity and name).
     */
    it('should include ref points with empty observations array', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const def: RefPointDefinition = {
        id: 'empty-obs',
        name: 'Empty Point',
        createdAt: Date.now(),
        observations: [],
      };
      const zipBlob = await createTestZipBlob([def]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      // Empty-obs ref points are included (schema-valid, preserves identity)
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('empty-obs');
      expect(result.definitions[0].observations).toHaveLength(0);
    });

    /**
     * Why this test matters:
     * When 3+ ZIPs contribute observations for the same ref point (some
     * with duplicates), deduplication must be correct across all merges —
     * not just the first pair. This catches regressions in the seen-set
     * lifecycle (e.g., recreating it from scratch on every merge).
     */
    it('should deduplicate correctly across 3+ ZIPs for the same ref point', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const obsA = makeObservation('session-1', 1000, 50.1, 8.1);
      const obsB = makeObservation('session-2', 2000, 50.2, 8.2);
      const obsC = makeObservation('session-3', 3000, 50.3, 8.3);

      // ZIP 1: obsA
      const def1 = makeRefPointDef('h3-cell-x', 'Lamp', [obsA]);
      // ZIP 2: obsA (duplicate) + obsB (new)
      const def2 = makeRefPointDef('h3-cell-x', 'Lamp', [obsA, obsB]);
      // ZIP 3: obsB (duplicate) + obsC (new)
      const def3 = makeRefPointDef('h3-cell-x', 'Lamp', [obsB, obsC]);

      const zip1 = await createTestZipBlob([def1]);
      const zip2 = await createTestZipBlob([def2]);
      const zip3 = await createTestZipBlob([def3]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zip1),
        createMockFileEntry('session-2.zip', zip2),
        createMockFileEntry('session-3.zip', zip3),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      // Exactly 3 unique observations despite 6 total across ZIPs
      expect(result.definitions[0].observations).toHaveLength(3);
      const sessionIds = result.definitions[0].observations
        .map((o) => o.sessionId)
        .sort();
      expect(sessionIds).toEqual(['session-1', 'session-2', 'session-3']);
      expect(result.zipFilesScanned).toBe(3);
    });

    /**
     * Why this test matters:
     * folderHandle.values() already yields FileSystemFileHandle objects.
     * After the `kind === 'file'` guard the entry IS a FileSystemFileHandle,
     * so calling folderHandle.getFileHandle(entry.name) is a redundant
     * directory lookup. This test asserts the implementation uses the
     * iterator entry directly rather than re-resolving through getFileHandle.
     */
    it('should use iterator entry directly without calling getFileHandle', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const def = makeRefPointDef('direct-entry', 'DirectEntry', [
        makeObservation('session-1', 1000),
      ]);
      const zipBlob = await createTestZipBlob([def]);
      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      // Recovery should succeed
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('direct-entry');
      // getFileHandle should NOT have been called — entry is used directly
      expect(folderHandle.getFileHandle).not.toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * Sorting by createdAt provides deterministic output order for tests
     * and consistent display in the UI.
     */
    it('should sort merged definitions by createdAt', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const defOlder = makeRefPointDef('cell-older', 'Older', [
        makeObservation('session-1', 1000),
      ]);
      const defNewer = makeRefPointDef('cell-newer', 'Newer', [
        makeObservation('session-2', 5000),
      ]);

      // Newer ZIP processed first, but older ref point should come first
      const zip1 = await createTestZipBlob([defNewer]);
      const zip2 = await createTestZipBlob([defOlder]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('newer-session.zip', zip1),
        createMockFileEntry('older-session.zip', zip2),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(2);
      expect(result.definitions[0].id).toBe('cell-older');
      expect(result.definitions[1].id).toBe('cell-newer');
    });
  });

  // ==========================================================================
  // indexRefPointDefinitionsFromFolder — the scenario-aware, observable,
  // abortable full-folder pass (2026-07-05 folder-import plan, Slice 1).
  // ==========================================================================
  describe('indexRefPointDefinitionsFromFolder', () => {
    /**
     * Why this test matters:
     * D4a (strict per-scenario routing) depends on resolving each ZIP's
     * scenario from its session.json with the same precedence as the replay
     * discovery: contextTag (current) → scenarioName (legacy) → the
     * canonical Default Scenario for zips with no metadata.
     */
    it('groups definitions per scenario (contextTag primary, legacy scenarioName fallback, missing metadata → Default Scenario)', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');
      const { DEFAULT_SCENARIO } = await import('./session-zip-naming');

      const zipParis = await createTestZipBlob(
        [
          makeRefPointDef('cell-paris', 'Paris point', [
            makeObservation('s1', 1000),
          ]),
        ],
        'Paris',
        'contextTag'
      );
      const zipBerlin = await createTestZipBlob(
        [
          makeRefPointDef('cell-berlin', 'Berlin point', [
            makeObservation('s2', 2000),
          ]),
        ],
        'Berlin',
        'scenarioName'
      );
      const zipNoMeta = await createTestZipBlob(
        [
          makeRefPointDef('cell-default', 'Orphan point', [
            makeObservation('s3', 3000),
          ]),
        ],
        'ignored',
        'none'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zipParis),
        createMockFileEntry('recording-2026-01-02_10-00-00utc.zip', zipBerlin),
        createMockFileEntry('recording-2026-01-03_10-00-00utc.zip', zipNoMeta),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      expect(result.zipFilesScanned).toBe(3);
      expect(result.errors).toEqual([]);
      expect([...result.definitionsByScenario.keys()].sort()).toEqual(
        ['Berlin', DEFAULT_SCENARIO, 'Paris'].sort()
      );
      expect(
        result.definitionsByScenario.get('Paris')!.map((d) => d.id)
      ).toEqual(['cell-paris']);
      expect(
        result.definitionsByScenario.get('Berlin')!.map((d) => d.id)
      ).toEqual(['cell-berlin']);
      expect(
        result.definitionsByScenario.get(DEFAULT_SCENARIO)!.map((d) => d.id)
      ).toEqual(['cell-default']);
    });

    /**
     * Why this test matters:
     * The literal "Default Scenario" written into metadata must land in the
     * same canonical bucket as missing metadata (UX feedback 2026-03-23
     * Issue 2) — otherwise the same recordings split into two groups.
     */
    it('canonicalizes an explicit "Default Scenario" metadata value into the same bucket as missing metadata', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');
      const { DEFAULT_SCENARIO } = await import('./session-zip-naming');

      const zipExplicit = await createTestZipBlob(
        [makeRefPointDef('cell-a', 'A', [makeObservation('s1', 1000)])],
        DEFAULT_SCENARIO,
        'contextTag'
      );
      const zipNone = await createTestZipBlob(
        [makeRefPointDef('cell-b', 'B', [makeObservation('s2', 2000)])],
        'ignored',
        'none'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry(
          'recording-2026-01-01_10-00-00utc.zip',
          zipExplicit
        ),
        createMockFileEntry('recording-2026-01-02_10-00-00utc.zip', zipNone),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      expect([...result.definitionsByScenario.keys()]).toEqual([
        DEFAULT_SCENARIO,
      ]);
      expect(
        result.definitionsByScenario
          .get(DEFAULT_SCENARIO)!
          .map((d) => d.id)
          .sort()
      ).toEqual(['cell-a', 'cell-b']);
    });

    /**
     * Why this test matters:
     * The start-screen progress bar (D2) renders directly from these
     * callbacks: an initial 0/total event (so the bar appears before the
     * first ZIP finishes) and one event per processed ZIP. Non-zip files
     * must not inflate the total.
     */
    it('reports an initial 0/total progress event and one event per ZIP, excluding non-zip entries from the total', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const zip1 = await createTestZipBlob(
        [makeRefPointDef('cell-1', 'One', [makeObservation('s1', 1000)])],
        'Paris',
        'contextTag'
      );
      const zip2 = await createTestZipBlob(
        [makeRefPointDef('cell-2', 'Two', [makeObservation('s2', 2000)])],
        'Paris',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zip1),
        { name: 'notes.txt', kind: 'file' as const },
        { name: 'subdir', kind: 'directory' as const },
        createMockFileEntry('recording-2026-01-02_10-00-00utc.zip', zip2),
      ]);

      const events: Array<{ done: number; total: number }> = [];
      await indexRefPointDefinitionsFromFolder(folderHandle, {
        onProgress: (p) => events.push({ ...p }),
      });

      expect(events).toEqual([
        { done: 0, total: 2 },
        { done: 1, total: 2 },
        { done: 2, total: 2 },
      ]);
    });

    /**
     * Why this test matters:
     * A corrupt ZIP must not stall the bar (progress still advances past it)
     * nor abort the pass — its failure is reported via `errors` while the
     * remaining ZIPs are still indexed (async-UX failure path).
     */
    it('advances progress past a corrupt ZIP, records an error, and still indexes the remaining ZIPs', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const corrupt = new Blob(['this is not a zip archive']);
      const good = await createTestZipBlob(
        [makeRefPointDef('cell-good', 'Good', [makeObservation('s1', 1000)])],
        'Paris',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        // Newer timestamp → processed first, so the corrupt zip leads.
        createMockFileEntry('recording-2026-06-01_10-00-00utc.zip', corrupt),
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', good),
      ]);

      const events: Array<{ done: number; total: number }> = [];
      const result = await indexRefPointDefinitionsFromFolder(folderHandle, {
        onProgress: (p) => events.push({ ...p }),
      });

      expect(events).toEqual([
        { done: 0, total: 2 },
        { done: 1, total: 2 },
        { done: 2, total: 2 },
      ]);
      expect(result.zipFilesScanned).toBe(1);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(
        result.definitionsByScenario.get('Paris')!.map((d) => d.id)
      ).toEqual(['cell-good']);
    });

    /**
     * Why this test matters:
     * D3 requires the pass to be abortable (teardown / new folder pick). An
     * already-aborted signal must prevent any file reads; a mid-pass abort
     * must stop before the next ZIP and surface as a DOMException AbortError.
     */
    it('throws AbortError without reading any file when the signal is already aborted', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const zip = await createTestZipBlob(
        [makeRefPointDef('cell-1', 'One', [makeObservation('s1', 1000)])],
        'Paris',
        'contextTag'
      );
      const entry = createMockFileEntry(
        'recording-2026-01-01_10-00-00utc.zip',
        zip
      );
      const getFileSpy = vi.spyOn(entry, 'getFile');
      const folderHandle = createMockFolderHandle([entry]);

      const controller = new AbortController();
      controller.abort();

      const events: unknown[] = [];
      await expect(
        indexRefPointDefinitionsFromFolder(folderHandle, {
          signal: controller.signal,
          onProgress: (p) => events.push(p),
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(getFileSpy).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it('stops before the next ZIP when the signal aborts mid-pass', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const mkZip = async (id: string) =>
        createTestZipBlob(
          [makeRefPointDef(id, id, [makeObservation('s1', 1000)])],
          'Paris',
          'contextTag'
        );
      const entries = [
        createMockFileEntry(
          'recording-2026-06-03_10-00-00utc.zip',
          await mkZip('cell-1')
        ),
        createMockFileEntry(
          'recording-2026-06-02_10-00-00utc.zip',
          await mkZip('cell-2')
        ),
        createMockFileEntry(
          'recording-2026-06-01_10-00-00utc.zip',
          await mkZip('cell-3')
        ),
      ];
      const spies = entries.map((e) => vi.spyOn(e, 'getFile'));
      const folderHandle = createMockFolderHandle(entries);

      const controller = new AbortController();
      await expect(
        indexRefPointDefinitionsFromFolder(folderHandle, {
          signal: controller.signal,
          onProgress: ({ done }) => {
            if (done === 1) controller.abort();
          },
        })
      ).rejects.toMatchObject({ name: 'AbortError' });

      // Newest-first: only the newest ZIP (entries[0]) was read before abort.
      expect(spies[0]).toHaveBeenCalledTimes(1);
      expect(spies[1]).not.toHaveBeenCalled();
      expect(spies[2]).not.toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * D4b-ii — ZIPs are processed newest-first (filename timestamp) so the
     * newest recording provides the canonical metadata (name) of a merged
     * definition, while observations from all recordings are unioned and
     * createdAt keeps the earliest value. The entries are handed to the mock
     * folder oldest-first to prove the sort (directory order is arbitrary in
     * real folders).
     */
    it('processes ZIPs newest-first so the newest recording provides the canonical name (D4b-ii)', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const oldObs = makeObservation('session-old', 1000);
      const newObs = makeObservation('session-new', 2000);
      const zipOld = await createTestZipBlob(
        [
          makeRefPointDef('cell-x', 'Old Name', [oldObs]),
          // Unique to the old zip, with the earliest createdAt (500) — pins
          // that buckets keep FIRST-ENCOUNTER order (newest recording first),
          // not createdAt order: the Slice-2 gap-fill acceptance loop walks
          // the bucket in order and must see the newest definitions first.
          makeRefPointDef('cell-y', 'Only Old', [
            makeObservation('session-old', 500),
          ]),
        ],
        'Paris',
        'contextTag'
      );
      const zipNew = await createTestZipBlob(
        [makeRefPointDef('cell-x', 'New Name', [newObs])],
        'Paris',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        // Oldest handed over first on purpose — the sort must reorder.
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zipOld),
        createMockFileEntry('recording-2026-06-01_10-00-00utc.zip', zipNew),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      const paris = result.definitionsByScenario.get('Paris')!;
      expect(paris.map((d) => d.id)).toEqual(['cell-x', 'cell-y']);
      expect(paris[0]!.name).toBe('New Name');
      expect(paris[0]!.createdAt).toBe(1000);
      expect(paris[0]!.observations).toHaveLength(2);
    });

    /**
     * Why this test matters:
     * D4a — the same H3 id observed under two different scenarios must stay
     * in both scenario buckets (strict routing, no cross-scenario merge).
     */
    it('keeps the same ref-point id in separate scenario buckets without cross-scenario merging', async () => {
      const { indexRefPointDefinitionsFromFolder } =
        await import('./ref-point-recovery');

      const zipParis = await createTestZipBlob(
        [
          makeRefPointDef('cell-x', 'Paris view', [
            makeObservation('s1', 1000),
          ]),
        ],
        'Paris',
        'contextTag'
      );
      const zipBerlin = await createTestZipBlob(
        [
          makeRefPointDef('cell-x', 'Berlin view', [
            makeObservation('s2', 2000),
          ]),
        ],
        'Berlin',
        'contextTag'
      );

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('recording-2026-01-01_10-00-00utc.zip', zipParis),
        createMockFileEntry('recording-2026-01-02_10-00-00utc.zip', zipBerlin),
      ]);

      const result = await indexRefPointDefinitionsFromFolder(folderHandle);

      expect(
        result.definitionsByScenario.get('Paris')!.map((d) => ({
          id: d.id,
          obs: d.observations.length,
        }))
      ).toEqual([{ id: 'cell-x', obs: 1 }]);
      expect(
        result.definitionsByScenario.get('Berlin')!.map((d) => ({
          id: d.id,
          obs: d.observations.length,
        }))
      ).toEqual([{ id: 'cell-x', obs: 1 }]);
    });
  });
});
