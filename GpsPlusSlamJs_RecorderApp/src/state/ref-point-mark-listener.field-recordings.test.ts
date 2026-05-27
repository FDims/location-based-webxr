/**
 * Field-recording replay test for the ref-point-mark listener.
 *
 * Replays a real outdoor recording (`TestDataJs/2026-05-19_15-43-55utc.zip`)
 * through `createRecorderStore()` and asserts that every
 * `gpsData/markReferencePoint` action persisted in the recording produces
 * exactly one entry in `refPoints.currentMarks` — i.e. the F2 listener
 * middleware closes the gap that previously left replay sessions without
 * any current-session red sphere.
 *
 * See F2 of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 *
 * Why this test matters: the dedicated unit tests
 * (`ref-point-mark-listener.test.ts`) verify the listener in isolation.
 * This integration test verifies it against the exact action stream
 * shape that ships in production recordings — guarding against schema
 * drift (e.g. payload field rename) or coupling regressions with the
 * upstream `gpsData/recordGpsEvent` ordering.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadActionsFromZip,
  type ZipActionEntry,
} from 'gps-plus-slam-app-framework/storage/zip-reader';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import { createRecorderStore } from './recorder-store';

// ---------------------------------------------------------------------------
// Fixture resolution — same scheme as
// AppFramework/src/state/tracking-quality.field-recordings.test.ts.
// Layout: <gpsRoot>/location-based-webxr/GpsPlusSlamJs_RecorderApp/src/state/
//         <gpsRoot>/gps-plus-slam/TestDataJs/...
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const GPS_ROOT = resolve(__dirname, '../../../..');
const FIXTURE = resolve(
  GPS_ROOT,
  'gps-plus-slam/TestDataJs/2026-05-19_15-43-55utc.zip'
);
const fixtureAvailable = existsSync(FIXTURE);

describe.runIf(fixtureAvailable)(
  'ref-point-mark-listener — outdoor field recording (F2)',
  () => {
    let markActions: ZipActionEntry[];
    let marks: readonly {
      odomPosition: readonly number[];
      odomRotation: readonly number[];
    }[];

    beforeAll(async () => {
      const bytes = new Uint8Array(readFileSync(FIXTURE));
      const actionEntries = await loadActionsFromZip(bytes);
      markActions = actionEntries.filter(
        (e) => e.action.type === 'gpsData/markReferencePoint'
      );
      const store = createRecorderStore({
        storageBackend: new NullStorageBackend(),
      });
      for (const entry of actionEntries) {
        store.dispatch(entry.action);
      }
      marks = store.getState().refPoints.currentMarks ?? [];
    }, 120_000);

    it('recording contains at least one markReferencePoint action', () => {
      // Why: if the recording stops persisting markReferencePoint actions,
      // every downstream assertion is vacuously true — pin the precondition.
      expect(markActions.length).toBeGreaterThan(0);
    });

    it('replay produces one currentMarks entry per markReferencePoint action', () => {
      expect(marks).toHaveLength(markActions.length);
    });

    it('every dispatched mark carries the odom pose from its action payload', () => {
      // Why: the listener must propagate raw odom — losing it would break
      // the visualizer's GPS-anchored placement on the replay side.
      for (const mark of marks) {
        expect(Array.isArray(mark.odomPosition)).toBe(true);
        expect(mark.odomPosition).toHaveLength(3);
        expect(Array.isArray(mark.odomRotation)).toBe(true);
        expect(mark.odomRotation).toHaveLength(4);
      }
    });
  }
);
