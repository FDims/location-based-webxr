/**
 * Recording Migration Tests
 *
 * Why these tests matter:
 * The migration system handles four recording eras:
 *
 * Era 1 (pre-2026-03-15, no odomCoordVersion): Positions are raw WebXR (already
 * correct for the current reducer which applies webxrToNUE). GPS payloads use
 * old `gpsPoint` with derived fields — rename to `rawGpsPoint` and strip.
 *
 * Era 2 (2026-03-15 → 2026-04, odomCoordVersion: 2): Positions were converted
 * to NUE at dispatch time. They must be reversed back to raw WebXR so the
 * reducer's webxrToNUE() produces correct NUE state. GPS payloads also get
 * the gpsPoint→rawGpsPoint migration.
 *
 * Era 3 (2026-04, odomCoordVersion: 3): Positions are raw WebXR (correct).
 * GPS payloads use old `gpsPoint` with derived fields — rename + strip.
 *
 * Era 4 (current, odomCoordVersion: 4): No migration needed.
 *
 * Related docs: docs/2026-04-09-raw-storage-convert-on-read.md
 */

import { describe, it, expect, vi } from 'vitest';
import {
  migrateActionsIfNeeded,
  ODOM_COORD_VERSION,
} from './recording-migration';
import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';

// Minimal session metadata shapes for testing
type Era1Metadata = Record<string, unknown>; // no odomCoordVersion field
type Era2Metadata = Record<string, unknown> & { odomCoordVersion: 2 };
type Era3Metadata = Record<string, unknown> & { odomCoordVersion: 3 };
type Era4Metadata = Record<string, unknown> & { odomCoordVersion: 4 };

describe('recording-migration', () => {
  describe('ODOM_COORD_VERSION', () => {
    /**
     * Why this test matters:
     * The constant is used at both write-time (session metadata) and read-time
     * (migration guard). A typo would silently disable migration or trigger
     * wrong-era logic.
     */
    it('equals 5', () => {
      expect(ODOM_COORD_VERSION).toBe(5);
    });
  });

  describe('migrateActionsIfNeeded', () => {
    // =======================================================================
    // Era 4: no migration needed (odomCoordVersion >= 4)
    // =======================================================================

    describe('era 4 — no migration (odomCoordVersion >= 4)', () => {
      /**
       * Why this test matters:
       * Era-4 recordings store raw WebXR positions and rawGpsPoint payloads.
       * No migration needed — the original array reference must be returned.
       */
      it('returns actions unchanged (same reference) for odomCoordVersion = 4', () => {
        const metadata: Era4Metadata = { odomCoordVersion: 4 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              rawGpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        expect(result).toBe(actions); // same reference
      });

      /**
       * Why this test matters:
       * Future versions (5, 6, …) must also skip migration.
       */
      it('returns actions unchanged for odomCoordVersion > 4', () => {
        const metadata = { odomCoordVersion: 5 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: { odomPosition: [1, 2, 3] },
          },
        ];

        expect(migrateActionsIfNeeded(actions, metadata)).toBe(actions);
      });
    });

    // =======================================================================
    // Era 3: gpsPoint→rawGpsPoint migration only (positions already correct)
    // =======================================================================

    describe('era 3 — gpsPoint→rawGpsPoint (odomCoordVersion = 3)', () => {
      /**
       * Why this test matters:
       * Era-3 recordings have raw WebXR positions (correct) but use the old
       * `gpsPoint` field with derived fields. Migration renames to `rawGpsPoint`
       * and strips coordinates, weight, zeroRef, deviceRotation.
       */
      it('renames gpsPoint to rawGpsPoint and strips derived fields', () => {
        const metadata: Era3Metadata = { odomCoordVersion: 3 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                altitude: 100,
                latLongAccuracy: 5,
                zeroRef: { lat: 49, lon: 8 },
                coordinates: [10, 0, 5],
                weight: 0.2,
                deviceRotation: [0, 0, 0, 1],
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        // odomPosition unchanged (already raw WebXR)
        expect(payload['odomPosition']).toEqual([1, 2, 3]);
        // gpsPoint renamed to rawGpsPoint, derived fields stripped
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['id']).toBe('gps-1');
        expect(raw['latitude']).toBe(49);
        expect(raw['longitude']).toBe(8);
        expect(raw['altitude']).toBe(100);
        expect(raw['latLongAccuracy']).toBe(5);
        expect(raw['timestamp']).toBe(1000);
        // Derived fields must be gone
        expect(raw['coordinates']).toBeUndefined();
        expect(raw['weight']).toBeUndefined();
        expect(raw['zeroRef']).toBeUndefined();
        expect(raw['deviceRotation']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * markReferencePoint payloads also need gpsPoint→rawGpsPoint migration.
       */
      it('renames gpsPoint to rawGpsPoint in markReferencePoint payload', () => {
        const metadata: Era3Metadata = { odomCoordVersion: 3 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'bench',
              position: [1, 2, 3],
              rotation: [0, 0, 0, 1],
              gpsPoint: {
                id: 'gps-ref-1',
                latitude: 49,
                longitude: 8,
                zeroRef: { lat: 49, lon: 8 },
                coordinates: [0, 0, 0],
                weight: 1,
                timestamp: 1000,
              },
              timestamp: 1000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['id']).toBe('gps-ref-1');
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined();
        expect(raw['weight']).toBeUndefined();
        expect(raw['zeroRef']).toBeUndefined();
      });
    });

    // =======================================================================
    // Era 2: reverse NUE positions → raw WebXR
    // =======================================================================

    describe('era 2 — reverse NUE→WebXR (odomCoordVersion = 2)', () => {
      /**
       * Why this test matters:
       * Era-2 recordGpsEvent.odomPosition is already NUE [-z,y,x].
       * Reverse: NUE [n,u,e] → WebXR [e,u,-n] = [v[2],v[1],-v[0]].
       * Example: NUE [-3,2,1] → WebXR [1,2,3].
       */
      it('reverses recordGpsEvent.odomPosition from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [-3, 2, 1], // NUE (era-2 format)
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                zeroRef: { lat: 49, lon: 8 },
                coordinates: [10, 0, 5],
                weight: 0.2,
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        // reversed: [e, u, -n] = [1, 2, 3]
        expect(payload['odomPosition']).toEqual([1, 2, 3]);
        // gpsPoint renamed to rawGpsPoint, derived fields stripped
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined();
        expect(raw['weight']).toBeUndefined();
        expect(raw['zeroRef']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * markReferencePoint.position in era-2 is NUE — must be reversed.
       */
      it('reverses markReferencePoint.position from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'bench',
              position: [-3, 2, 1], // NUE
              rotation: [0, 0, 0, 1],
              gpsPoint: {
                id: 'gps-ref',
                latitude: 49,
                longitude: 8,
                timestamp: 1000,
              },
              timestamp: 1000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['position']).toEqual([1, 2, 3]);
        // non-position fields unchanged
        expect(payload['id']).toBe('bench');
        expect(payload['rotation']).toEqual([0, 0, 0, 1]);
        // gpsPoint → rawGpsPoint
        expect(payload['gpsPoint']).toBeUndefined();
        expect(
          (payload['rawGpsPoint'] as Record<string, unknown>)['latitude']
        ).toBe(49);
      });

      /**
       * Why this test matters:
       * add2dImage.position in era-2 is NUE — must be reversed.
       */
      it('reverses add2dImage.position from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/add2dImage',
            payload: {
              imageFile: 'frames/frame-000001.jpg',
              position: [-3, 2, 1], // NUE
              rotation: [0, 0, 0, 1],
              screenRotation: 0,
              capturedAt: 1704110400000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['position']).toEqual([1, 2, 3]);
        expect(payload['imageFile']).toBe('frames/frame-000001.jpg');
      });

      /**
       * Why this test matters:
       * odometryTrackingRestarted positions in era-2 are NUE — both
       * lastValidOdomPos and newOdomPos must be reversed.
       */
      it('reverses odometryTrackingRestarted positions from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/odometryTrackingRestarted',
            payload: {
              lastValidOdomPos: [-3, 2, 1], // NUE
              lastValidOdomRot: [0, 0, 0, 1],
              lastSensorRot: [0, 0, 0, 1],
              newOdomRot: [0, 0.1, 0, 0.995],
              newSensorRot: [0, 0, 0, 1],
              newOdomPos: [0.3, 1.0, 0.5], // NUE
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['lastValidOdomPos']).toEqual([1, 2, 3]);
        expect(payload['newOdomPos']).toEqual([0.5, 1.0, -0.3]);
        // rotations unchanged
        expect(payload['lastValidOdomRot']).toEqual([0, 0, 0, 1]);
      });

      /**
       * Why this test matters:
       * odometryTrackingRestarted without newOdomPos (optional) must not crash.
       */
      it('handles odometryTrackingRestarted without optional newOdomPos', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/odometryTrackingRestarted',
            payload: {
              lastValidOdomPos: [-3, 2, 1],
              lastValidOdomRot: [0, 0, 0, 1],
              lastSensorRot: [0, 0, 0, 1],
              newOdomRot: [0, 0, 0, 1],
              newSensorRot: [0, 0, 0, 1],
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['lastValidOdomPos']).toEqual([1, 2, 3]);
        expect(payload['newOdomPos']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * recordDepthSample.cameraPos was not handled by the old migration.
       * Era-2 depth samples have NUE cameraPos that must be reversed.
       */
      it('reverses recordDepthSample.cameraPos from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'recording/recordDepthSample',
            payload: {
              cameraPos: [-3, 2, 1], // NUE
              cameraRot: [0, 0, 0, 1],
              timestamp: 12345,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['cameraPos']).toEqual([1, 2, 3]);
        expect(payload['cameraRot']).toEqual([0, 0, 0, 1]);
      });

      /**
       * Why this test matters:
       * arLoopClosureDetected carries lastPos/newPos. In era-2 C# replay
       * recordings these are NUE and must be reversed.
       */
      it('reverses arLoopClosureDetected positions from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/arLoopClosureDetected',
            payload: {
              lastPos: [-3, 2, 1], // NUE
              newPos: [5, 0, -2], // NUE
              lastRot: [0, 0, 0, 1],
              newRot: [0, 0, 0, 1],
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['lastPos']).toEqual([1, 2, 3]);
        expect(payload['newPos']).toEqual([-2, 0, -5]);
      });

      /**
       * Why this test matters:
       * Non-position actions (startSession, stopSession) must pass through.
       */
      it('leaves non-position actions untouched', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          { type: 'recording/startSession', payload: { scenarioName: 'test' } },
          { type: 'recording/stopSession', payload: undefined },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        expect(result[0]).toEqual(actions[0]);
        expect(result[1]).toEqual(actions[1]);
      });
    });

    // =======================================================================
    // Era 1: GPS coord swap only (no position migration)
    // =======================================================================

    describe('era 1 — gpsPoint→rawGpsPoint + strip derived fields (no odomCoordVersion)', () => {
      /**
       * Why this test matters:
       * Era-1 odomPosition is raw WebXR — correct for the current reducer.
       * GPS payload gets renamed from gpsPoint→rawGpsPoint with derived fields stripped.
       * The old ENU coordinates field is removed entirely (reducer recomputes).
       */
      it('renames gpsPoint to rawGpsPoint and strips derived fields, leaves odomPosition unchanged', () => {
        const metadata: Era1Metadata = {}; // no odomCoordVersion
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3], // raw WebXR — must stay as-is
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                coordinates: [5, 0, 10], // old ENU — should be stripped
                weight: 0.2,
                zeroRef: { lat: 49, lon: 8 },
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        // odomPosition unchanged (already raw WebXR)
        expect(payload['odomPosition']).toEqual([1, 2, 3]);
        // gpsPoint → rawGpsPoint, derived fields stripped
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['id']).toBe('gps-1');
        expect(raw['latitude']).toBe(49);
        expect(raw['longitude']).toBe(8);
        expect(raw['timestamp']).toBe(1000);
        expect(raw['coordinates']).toBeUndefined();
        expect(raw['weight']).toBeUndefined();
        expect(raw['zeroRef']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * Walking north: position stays as-is. GPS gpsPoint→rawGpsPoint strip.
       */
      it('keeps walking-north WebXR position unchanged, strips GPS derived fields', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [0, 0, -5], // raw WebXR 5m north
              gpsPoint: {
                id: 'gps-2',
                latitude: 49.001,
                longitude: 8,
                coordinates: [0, 0, 100], // old ENU
                weight: 1,
                timestamp: 2000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['odomPosition']).toEqual([0, 0, -5]); // unchanged
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49.001);
        expect(raw['coordinates']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * Walking east: position stays as-is. GPS gpsPoint→rawGpsPoint strip.
       */
      it('keeps walking-east WebXR position unchanged, strips GPS derived fields', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [3, 0, 0], // raw WebXR 3m east
              gpsPoint: {
                id: 'gps-3',
                latitude: 49,
                longitude: 8.001,
                coordinates: [50, 0, 0], // old ENU
                weight: 1,
                timestamp: 3000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['odomPosition']).toEqual([3, 0, 0]); // unchanged
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['longitude']).toBe(8.001);
        expect(raw['coordinates']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * markReferencePoint.position is raw WebXR in era-1 — must NOT be
       * converted (the reducer handles it). gpsPoint→rawGpsPoint rename applies.
       */
      it('renames gpsPoint→rawGpsPoint in markReferencePoint, leaves position unchanged', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'benchCorner',
              position: [1, 2, 3],
              rotation: [0, 0, 0, 1],
              gpsPoint: {
                id: 'gps-ref',
                latitude: 49.0,
                longitude: 8.0,
                timestamp: 1000,
              },
              timestamp: 1000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['position']).toEqual([1, 2, 3]); // unchanged
        expect(payload['id']).toBe('benchCorner');
        expect(payload['gpsPoint']).toBeUndefined();
        expect(
          (payload['rawGpsPoint'] as Record<string, unknown>)['latitude']
        ).toBe(49);
      });

      /**
       * Why this test matters:
       * add2dImage.position is raw WebXR in era-1 — must NOT be converted.
       */
      it('leaves add2dImage.position unchanged in era-1', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/add2dImage',
            payload: {
              imageFile: 'frames/frame-000001.jpg',
              position: [1, 2, 3],
              rotation: [0, 0, 0, 1],
              screenRotation: 0,
              capturedAt: 1704110400000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['position']).toEqual([1, 2, 3]); // unchanged
      });

      /**
       * Why this test matters:
       * odometryTrackingRestarted positions are raw WebXR in era-1 — unchanged.
       */
      it('leaves odometryTrackingRestarted positions unchanged in era-1', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/odometryTrackingRestarted',
            payload: {
              lastValidOdomPos: [1, 2, 3],
              lastValidOdomRot: [0, 0, 0, 1],
              lastSensorRot: [0, 0, 0, 1],
              newOdomRot: [0, 0.1, 0, 0.995],
              newSensorRot: [0, 0, 0, 1],
              newOdomPos: [0.5, 1.0, -0.3],
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['lastValidOdomPos']).toEqual([1, 2, 3]); // unchanged
        expect(payload['newOdomPos']).toEqual([0.5, 1.0, -0.3]); // unchanged
      });

      /**
       * Why this test matters:
       * Non-position era-1 actions pass through unchanged.
       */
      it('leaves non-position actions untouched (startSession, stopSession)', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          { type: 'recording/startSession', payload: { scenarioName: 'test' } },
          { type: 'recording/stopSession', payload: undefined },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        expect(result[0]).toEqual({
          type: 'recording/startSession',
          payload: { scenarioName: 'test' },
        });
        expect(result[1]).toEqual({
          type: 'recording/stopSession',
          payload: undefined,
        });
      });

      /**
       * Why this test matters:
       * Multiple GPS events must all have gpsPoint→rawGpsPoint applied.
       */
      it('renames gpsPoint→rawGpsPoint for all recordGpsEvent actions in a multi-event recording', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 0, 0],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                coordinates: [10, 0, 0],
                weight: 1,
                timestamp: 1000,
              },
            },
          },
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [2, 0, -3],
              gpsPoint: {
                id: 'gps-2',
                latitude: 49.001,
                longitude: 8.001,
                coordinates: [20, 0, 30],
                weight: 1,
                timestamp: 2000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const p0 = result[0].payload as Record<string, unknown>;
        expect(p0['odomPosition']).toEqual([1, 0, 0]); // unchanged
        expect(p0['gpsPoint']).toBeUndefined();
        expect((p0['rawGpsPoint'] as Record<string, unknown>)['latitude']).toBe(
          49
        );
        expect(
          (p0['rawGpsPoint'] as Record<string, unknown>)['coordinates']
        ).toBeUndefined();

        const p1 = result[1].payload as Record<string, unknown>;
        expect(p1['odomPosition']).toEqual([2, 0, -3]); // unchanged
        expect(p1['gpsPoint']).toBeUndefined();
        expect((p1['rawGpsPoint'] as Record<string, unknown>)['latitude']).toBe(
          49.001
        );
        expect(
          (p1['rawGpsPoint'] as Record<string, unknown>)['coordinates']
        ).toBeUndefined();
      });
    });

    // =======================================================================
    // Immutability
    // =======================================================================

    describe('immutability', () => {
      /**
       * Why this test matters:
       * Migration must not mutate the original actions array.
       */
      it('does not mutate the original actions array (era 1)', () => {
        const metadata: Era1Metadata = {};
        const originalGpsPoint = {
          id: 'gps-1',
          latitude: 49,
          longitude: 8,
          coordinates: [5, 0, 10],
          weight: 1,
          timestamp: 1000,
        };
        const original: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              gpsPoint: originalGpsPoint,
            },
          },
        ];

        migrateActionsIfNeeded(original, metadata);

        const payload = original[0].payload as Record<string, unknown>;
        // Original must still have gpsPoint (not rawGpsPoint)
        expect(payload['gpsPoint']).toBe(originalGpsPoint);
        expect(payload['odomPosition']).toEqual([1, 2, 3]);
      });

      /**
       * Why this test matters:
       * Era-2 reverse migration must also not mutate the original.
       */
      it('does not mutate the original actions array (era 2)', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const original: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [-3, 2, 1],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                coordinates: [10, 0, 5],
                weight: 1,
                timestamp: 1000,
              },
            },
          },
        ];
        const originalOdomCopy = [-3, 2, 1];

        migrateActionsIfNeeded(original, metadata);

        const payload = original[0].payload as Record<string, unknown>;
        expect(payload['odomPosition']).toEqual(originalOdomCopy);
        // Original must still have gpsPoint (not rawGpsPoint)
        expect(payload['gpsPoint']).toBeDefined();
      });
    });

    // =======================================================================
    // Malformed payload guards
    // =======================================================================

    describe('malformed payload guards', () => {
      /**
       * Why this test matters:
       * recordGpsEvent with no payload (undefined) must not crash.
       */
      it('returns recordGpsEvent unmodified when payload is undefined', () => {
        const actions: RecordedAction[] = [
          { type: 'gpsData/recordGpsEvent', payload: undefined },
        ];
        const result = migrateActionsIfNeeded(actions, null);
        expect(result[0]).toEqual(actions[0]);
      });

      /**
       * Why this test matters:
       * Era-1 recordGpsEvent missing gpsPoint skips gpsPoint→rawGpsPoint rename.
       */
      it('returns recordGpsEvent unmodified when gpsPoint is missing (era 1)', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, null);
        // No gpsPoint to rename — action passes through unchanged
        expect(result[0]).toEqual(actions[0]);
      });

      /**
       * Why this test matters:
       * Era-2 recordGpsEvent with missing odomPosition skips position
       * reversal, but gpsPoint→rawGpsPoint rename+strip still happens.
       */
      it('renames gpsPoint→rawGpsPoint even when odomPosition is missing (era 2)', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              gpsPoint: { coordinates: [1, 2, 3], latitude: 49, longitude: 8 },
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, metadata);
        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * gpsPoint exists but has no coordinates — should still rename + strip.
       */
      it('renames gpsPoint→rawGpsPoint even when gpsPoint.coordinates is missing', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                timestamp: 1000,
              },
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, null);
        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['gpsPoint']).toBeUndefined();
        expect(
          (payload['rawGpsPoint'] as Record<string, unknown>)['latitude']
        ).toBe(49);
      });

      /**
       * Why this test matters:
       * Non-numeric elements in odomPosition skip position reversal,
       * but gpsPoint→rawGpsPoint rename+strip still applies.
       */
      it('skips position reversal for non-numeric odomPosition but still renames gpsPoint (era 2)', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: ['a', 'b', 'c'],
              gpsPoint: { coordinates: [1, 2, 3], latitude: 49, longitude: 8 },
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, metadata);
        const payload = result[0].payload as Record<string, unknown>;
        // odomPosition left as-is (non-numeric, can't reverse)
        expect(payload['odomPosition']).toEqual(['a', 'b', 'c']);
        // gpsPoint renamed, derived fields stripped
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * markReferencePoint with no payload must not crash.
       */
      it('returns markReferencePoint unmodified when payload is undefined', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          { type: 'gpsData/markReferencePoint', payload: undefined },
        ];
        const result = migrateActionsIfNeeded(actions, metadata);
        expect(result[0]).toEqual(actions[0]);
      });

      /**
       * Why this test matters:
       * position is not an array — indexing would produce garbage.
       */
      it('returns markReferencePoint unmodified when position is not an array', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'test',
              position: 'bad',
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, metadata);
        expect(result[0]).toEqual(actions[0]);
      });
    });

    // =======================================================================
    // Edge cases
    // =======================================================================

    describe('edge cases', () => {
      /**
       * Why this test matters:
       * Empty recordings must not throw.
       */
      it('handles empty actions array', () => {
        const metadata: Era1Metadata = {};
        expect(() => migrateActionsIfNeeded([], metadata)).not.toThrow();
        expect(migrateActionsIfNeeded([], metadata)).toEqual([]);
      });

      /**
       * Why this test matters:
       * null metadata (zip has no session.json) is treated as era-1 —
       * only GPS coord swap is applied.
       */
      it('treats null metadata as era-1 (renames gpsPoint→rawGpsPoint, keeps positions)', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                coordinates: [5, 0, 10],
                weight: 1,
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, null);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['odomPosition']).toEqual([1, 2, 3]); // unchanged
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined(); // stripped
      });
    });

    // =======================================================================
    // Step 5.6: legacy zip → refPoints translator
    // =======================================================================

    describe('refPoints injection (Step 5.6)', () => {
      /**
       * Why this test matters:
       * Legacy zips persist only `gpsData/markReferencePoint`; the new flat
       * `refPoints` slice that the H3 matcher and visualizer read from
       * (Steps 5.2–5.4) never receives any action on replay unless the
       * migrator synthesises one. Without this translator, replayed
       * recordings would render zero ref points.
       */
      it('inserts refPoints/addRefPointEntry after each markReferencePoint', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: '8b1fa0a3168efff',
              position: [1, 2, 3],
              rotation: [0, 0, 0, 1],
              rawGpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                timestamp: 1500,
              },
              timestamp: 2000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, {
          odomCoordVersion: 5,
        });

        expect(result).toHaveLength(2);
        expect(result[0].type).toBe('gpsData/markReferencePoint');
        expect(result[1].type).toBe('refPoints/addRefPointEntry');
        const v2 = result[1].payload as Record<string, unknown>;
        expect(v2['id']).toBe('8b1fa0a3168efff');
        expect(v2['timestamp']).toBe(2000);
        expect(v2['rawGpsPoint']).toEqual({
          id: 'gps-1',
          latitude: 49,
          longitude: 8,
          timestamp: 1500,
        });
      });

      /**
       * Why this test matters:
       * The investigation harness recomputes alignment from the raw WebXR
       * AR pose, which survives only on the legacy `markReferencePoint`
       * payload. §E.3 forwards `position`/`rotation` (and the display
       * `name`) into the synthesized `addRefPointEntry` so the post-load
       * stream is uniform across eras and the harness extractor handles
       * one action type. See
       * 2026-05-29-investigation-harness-refpoint-source-migration-plan.md §E.3.
       */
      it('forwards position/rotation/name into the injected entry', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: '8b1fa0a3168efff',
              name: 'Town Hall',
              position: [1.5, -2.25, 3.75],
              rotation: [0.1, 0.2, 0.3, 0.9],
              rawGpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                timestamp: 1500,
              },
              timestamp: 2000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, {
          odomCoordVersion: 5,
        });

        const v2 = result[1].payload as Record<string, unknown>;
        expect(v2['position']).toEqual([1.5, -2.25, 3.75]);
        expect(v2['rotation']).toEqual([0.1, 0.2, 0.3, 0.9]);
        expect(v2['name']).toBe('Town Hall');
      });

      /**
       * Why this test matters:
       * Pose/name are optional. A legacy mark that lacks them (or carries a
       * malformed pose) must still synthesise a valid entry — pose/name are
       * simply omitted so the harness falls back to id and treats the entry
       * as "not a live mark", rather than persisting a NaN-laden vector.
       */
      it('omits pose/name when absent or malformed on the legacy mark', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: '8b1fa0a3168efff',
              position: [1, 2], // wrong length → omitted
              rotation: 'nope', // wrong type → omitted
              rawGpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                timestamp: 1500,
              },
              timestamp: 2000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, {
          odomCoordVersion: 5,
        });

        const v2 = result[1].payload as Record<string, unknown>;
        expect(v2['position']).toBeUndefined();
        expect(v2['rotation']).toBeUndefined();
        expect(v2['name']).toBeUndefined();
        // The valid GPS entry is still synthesized.
        expect(v2['id']).toBe('8b1fa0a3168efff');
      });

      it('is a no-op when stream already contains refPoints actions', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'x',
              position: [0, 0, 0],
              rotation: [0, 0, 0, 1],
              rawGpsPoint: {
                id: 'g',
                latitude: 0,
                longitude: 0,
                timestamp: 0,
              },
              timestamp: 0,
            },
          },
          {
            type: 'refPoints/addRefPointEntry',
            payload: {
              id: 'x',
              timestamp: 0,
              rawGpsPoint: {
                id: 'g',
                latitude: 0,
                longitude: 0,
                timestamp: 0,
              },
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, {
          odomCoordVersion: 5,
        });
        expect(result).toBe(actions); // same reference
      });

      /**
       * Why this test matters:
       * Stream with no markReferencePoint must preserve same-reference for
       * memory- and equality-sensitive callers.
       */
      it('returns same reference when no markReferencePoint exists', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              rawGpsPoint: {
                id: 'g',
                latitude: 0,
                longitude: 0,
                timestamp: 0,
              },
            },
          },
        ];
        expect(migrateActionsIfNeeded(actions, { odomCoordVersion: 5 })).toBe(
          actions
        );
      });

      /**
       * Why this test matters:
       * Era-1 zips have `gpsPoint` (not `rawGpsPoint`) and no odomCoordVersion;
       * after the GPS-payload rename pass, the injected refPoints entry
       * must carry the renamed `rawGpsPoint`.
       */
      it('runs after era-1 gpsPoint→rawGpsPoint rename', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'r1',
              position: [1, 2, 3],
              rotation: [0, 0, 0, 1],
              gpsPoint: {
                id: 'g',
                latitude: 49,
                longitude: 8,
                coordinates: [0, 0, 100],
                weight: 1,
                timestamp: 1000,
              },
              timestamp: 1000,
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, null);
        expect(result).toHaveLength(2);
        expect(result[1].type).toBe('refPoints/addRefPointEntry');
        const v2 = result[1].payload as Record<string, unknown>;
        const raw = v2['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49);
        // derived fields were stripped by era-1 migration before injection
        expect(raw['coordinates']).toBeUndefined();
        expect(raw['weight']).toBeUndefined();
      });
    });

    // =======================================================================
    // Step 8: tighten payload validation at the action-loader boundary
    // (§G.8). The loader is the single normalization point — malformed
    // `markReferencePoint` payloads must not silently synthesise a broken
    // `refPoints/addRefPointEntry` whose GPS the H3 matcher and selectors
    // would later read as `undefined`. Drop + warn instead of dropping
    // silently (the old listener middleware behaviour the review flagged).
    // =======================================================================

    describe('refPoints injection payload validation (Step 8)', () => {
      /**
       * Why this test matters:
       * Before Step 8, any `rawGpsPoint` *object* passed the gate — even one
       * with no coordinates. The synthesised entry then carried a GPS point
       * whose `latitude`/`longitude` were `undefined`, which the H3 matcher
       * and `selectKnownAnchorsByCell` read straight into NaN math. Validate
       * the coordinates at the loader boundary so a malformed mark produces
       * no entry at all.
       */
      it('drops a markReferencePoint whose rawGpsPoint lacks numeric coordinates', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const actions: RecordedAction[] = [
            {
              type: 'gpsData/markReferencePoint',
              payload: {
                id: 'broken',
                position: [1, 2, 3],
                rotation: [0, 0, 0, 1],
                rawGpsPoint: { id: 'g', timestamp: 1000 }, // no lat/lon
                timestamp: 1000,
              },
            },
          ];

          const result = migrateActionsIfNeeded(actions, {
            odomCoordVersion: 5,
          });

          // Original mark preserved, but no synthesised entry for it.
          expect(result).toHaveLength(1);
          expect(result[0].type).toBe('gpsData/markReferencePoint');
          expect(
            result.some((a) => a.type === 'refPoints/addRefPointEntry')
          ).toBe(false);
          // Not silent — the boundary warns about the dropped mark.
          expect(warn).toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      });

      /**
       * Why this test matters:
       * A non-finite coordinate (NaN/Infinity) is just as poisonous as a
       * missing one — it must not pass the gate either.
       */
      it('drops a markReferencePoint whose coordinates are non-finite', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const actions: RecordedAction[] = [
            {
              type: 'gpsData/markReferencePoint',
              payload: {
                id: 'nan',
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                rawGpsPoint: {
                  id: 'g',
                  latitude: Number.NaN,
                  longitude: 8,
                  timestamp: 0,
                },
                timestamp: 0,
              },
            },
          ];

          const result = migrateActionsIfNeeded(actions, {
            odomCoordVersion: 5,
          });

          expect(
            result.some((a) => a.type === 'refPoints/addRefPointEntry')
          ).toBe(false);
          expect(warn).toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      });

      /**
       * Why this test matters:
       * Validation must remain a *filter*, not an all-or-nothing gate: a
       * single bad mark in a stream must not suppress entries for the valid
       * marks around it.
       */
      it('keeps valid marks while dropping the malformed one in the same stream', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const actions: RecordedAction[] = [
            {
              type: 'gpsData/markReferencePoint',
              payload: {
                id: 'good-1',
                position: [1, 2, 3],
                rotation: [0, 0, 0, 1],
                rawGpsPoint: {
                  id: 'g1',
                  latitude: 49,
                  longitude: 8,
                  timestamp: 1000,
                },
                timestamp: 1000,
              },
            },
            {
              type: 'gpsData/markReferencePoint',
              payload: {
                id: 'bad',
                position: [4, 5, 6],
                rotation: [0, 0, 0, 1],
                rawGpsPoint: { id: 'g2' }, // no lat/lon
                timestamp: 2000,
              },
            },
            {
              type: 'gpsData/markReferencePoint',
              payload: {
                id: 'good-2',
                position: [7, 8, 9],
                rotation: [0, 0, 0, 1],
                rawGpsPoint: {
                  id: 'g3',
                  latitude: 50,
                  longitude: 9,
                  timestamp: 3000,
                },
                timestamp: 3000,
              },
            },
          ];

          const result = migrateActionsIfNeeded(actions, {
            odomCoordVersion: 5,
          });

          const injected = result.filter(
            (a) => a.type === 'refPoints/addRefPointEntry'
          );
          expect(injected).toHaveLength(2);
          const ids = injected.map(
            (a) => (a.payload as Record<string, unknown>)['id']
          );
          expect(ids).toEqual(['good-1', 'good-2']);
          expect(warn).toHaveBeenCalledTimes(1);
        } finally {
          warn.mockRestore();
        }
      });
    });
  });
});
