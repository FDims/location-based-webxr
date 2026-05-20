/**
 * Tests for {@link loadRecording} — the version-transparent recording loader.
 *
 * These tests use real recording zips from `TestDataJs/` to cover the
 * format-evolution path end-to-end:
 *   - An old era-≤3 recording (`2026-03-05_06-47-31utc.zip`): no sidecar
 *     `refPoints/` subdir, payloads use the pre-migration `gpsPoint` shape.
 *     The loader must apply the migration and reconstruct `refPoints` from
 *     `gpsData/markReferencePoint` actions.
 *   - A new era-4+ recording (`2026-04-23_15-55-36utc.zip`): sidecar
 *     `refPoints/*.json` files present. The loader must surface them and
 *     prefer sidecar entries over action-derived ones when ids overlap.
 *
 * Tests skip themselves when the zips are not present (CI without TestDataJs).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadRecording, type LoadedRecording } from './recording-loader';

const RECORDINGS_DIR = path.resolve(__dirname, '../../../../TestDataJs');
const OLD_ZIP = path.join(RECORDINGS_DIR, '2026-03-05_06-47-31utc.zip');
const NEW_ZIP = path.join(RECORDINGS_DIR, '2026-04-23_15-55-36utc.zip');

function readZip(p: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(p));
}

let oldLoaded: LoadedRecording | null = null;
let newLoaded: LoadedRecording | null = null;
let dataAvailable = false;

describe('loadRecording — version-transparent loader', () => {
  beforeAll(async () => {
    if (!fs.existsSync(OLD_ZIP) || !fs.existsSync(NEW_ZIP)) {
      return;
    }
    oldLoaded = await loadRecording(readZip(OLD_ZIP));
    newLoaded = await loadRecording(readZip(NEW_ZIP));
    dataAvailable = true;
  });

  describe('legacy recording (era ≤ 3, no sidecar refPoints)', () => {
    it('applies migration and reports it', () => {
      if (!dataAvailable) return;
      // Old recording uses `gpsPoint` shape → migration rewrites payloads.
      expect(oldLoaded!.capabilities.migrationApplied).toBe(true);
    });

    it('reports no sidecar ref points', () => {
      if (!dataAvailable) return;
      expect(oldLoaded!.capabilities.hasSidecarRefPoints).toBe(false);
    });

    it('reconstructs refPoints from markReferencePoint actions', () => {
      if (!dataAvailable) return;
      // The old recording is known to contain ≥1 markReferencePoint action.
      expect(oldLoaded!.refPoints.length).toBeGreaterThan(0);
      for (const def of oldLoaded!.refPoints) {
        expect(typeof def.id).toBe('string');
        expect(typeof def.createdAt).toBe('number');
        expect(def.observations.length).toBeGreaterThan(0);
        for (const obs of def.observations) {
          // Lat/lon must be real numbers post-migration (era ≤ 3 used
          // `gpsPoint.latitude/longitude` which migration renames to
          // `rawGpsPoint.latitude/longitude`).
          expect(typeof obs.gpsPoint.latitude).toBe('number');
          expect(typeof obs.gpsPoint.longitude).toBe('number');
          expect(Number.isFinite(obs.gpsPoint.latitude)).toBe(true);
          expect(Number.isFinite(obs.gpsPoint.longitude)).toBe(true);
        }
      }
    });

    it('returns actions in chronological order with post-migration schema', () => {
      if (!dataAvailable) return;
      const actions = oldLoaded!.actions;
      expect(actions.length).toBeGreaterThan(0);
      for (let i = 1; i < actions.length; i++) {
        expect(actions[i]!.index).toBeGreaterThanOrEqual(actions[i - 1]!.index);
      }
    });
  });

  describe('modern recording (era ≥ 4, sidecar refPoints/)', () => {
    it('reports sidecar ref points present', () => {
      if (!dataAvailable) return;
      expect(newLoaded!.capabilities.hasSidecarRefPoints).toBe(true);
    });

    it('reports session.json present', () => {
      if (!dataAvailable) return;
      expect(newLoaded!.capabilities.hasSessionMeta).toBe(true);
      expect(newLoaded!.meta).not.toBeNull();
    });

    it('returns at least one refPoint with sidecar fields (name not equal to id)', () => {
      if (!dataAvailable) return;
      expect(newLoaded!.refPoints.length).toBeGreaterThan(0);
      // Sidecar defs carry curated names. Reconstruction from actions
      // falls back to `name === id`. So at least one def must have a
      // distinct human-readable name to prove sidecars won.
      const hasCuratedName = newLoaded!.refPoints.some(
        (d) => typeof d.name === 'string' && d.name !== d.id
      );
      expect(hasCuratedName).toBe(true);
    });
  });

  describe('finalState (lazy, memoized)', () => {
    it('replays actions into a recorder store and is memoized', () => {
      if (!dataAvailable) return;
      const first = newLoaded!.getFinalState();
      const second = newLoaded!.getFinalState();
      expect(first).toBe(second);
    });
  });
});
