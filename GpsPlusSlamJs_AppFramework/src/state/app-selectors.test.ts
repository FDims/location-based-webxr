/**
 * Tests for app-level memoized selectors.
 *
 * Why these tests matter:
 * These selectors wrap library getter functions with createSelector for
 * standard RTK memoization. They establish a consistent select* naming
 * convention and provide the foundation for subscribeToSelector-based
 * change detection in store subscribers.
 *
 * Key invariants tested:
 * - Null/missing state returns correct fallback (null or empty array)
 * - Same state input → same output reference (memoization)
 * - Different state input with same relevant data → same output reference
 *
 * @see docs/2026-04-07-architecture-observations-consolidated.md §1
 */

import { describe, it, expect } from 'vitest';
import type { CombinedRootState } from './combined-root-state';
import type { GpsModel } from 'gps-plus-slam-js';
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectOdometryRotations,
  selectZeroReference,
  selectReferencePoints,
} from './app-selectors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal CombinedRootState with optional gpsData override. */
function makeState(
  gpsData: CombinedRootState['gpsData'] = null
): CombinedRootState {
  return {
    gpsData,
    gpsElements: {} as CombinedRootState['gpsElements'],
    arElements: {} as CombinedRootState['arElements'],
    recorder: {} as CombinedRootState['recorder'],
    refPoints: {} as CombinedRootState['refPoints'],
  };
}

/** Create a minimal GpsModel for testing. */
function makeGpsData(
  overrides: Partial<GpsModel> = {}
): CombinedRootState['gpsData'] {
  return {
    zero: { lat: 50, lon: 8 },
    gpsEvents: {
      alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      gpsPositions: [],
      odometryPositions: [],
      odometryRotations: [],
      alignmentRotation: [0, 0, 0, 1],
      alignmentTranslation: [0, 0, 0],
      alignmentRotationInDegree: [0, 0, 0],
      gpsPositionsVec4: [],
      odometryPosOffset: [0, 0, 0],
      odometryRotOffset: [0, 0, 0, 1],
      latestLoopClosureFixPointPos: null,
      latestLoopClosureFixPointRot: null,
      gpsAccuracyMedian: null,
      gpsAccuracyMean: null,
      currentGpsPosGeoHash: null,
    },
    odometryPath: { positions: [], rotations: [] },
    referencePoints: [],
    ...overrides,
  } as CombinedRootState['gpsData'];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('app-level selectors', () => {
  // --- Null state handling ---

  describe('null gpsData', () => {
    const state = makeState(null);

    it('selectAlignmentMatrix returns null', () => {
      expect(selectAlignmentMatrix(state)).toBeNull();
    });

    it('selectGpsPositions returns empty array', () => {
      expect(selectGpsPositions(state)).toEqual([]);
    });

    it('selectOdometryPositions returns empty array', () => {
      expect(selectOdometryPositions(state)).toEqual([]);
    });

    it('selectOdometryRotations returns empty array', () => {
      expect(selectOdometryRotations(state)).toEqual([]);
    });

    it('selectZeroReference returns null', () => {
      expect(selectZeroReference(state)).toBeNull();
    });

    it('selectReferencePoints returns empty array', () => {
      expect(selectReferencePoints(state)).toEqual([]);
    });
  });

  // --- Non-null state ---

  describe('populated gpsData', () => {
    it('selectAlignmentMatrix returns the matrix', () => {
      const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 5, 1] as const;
      const gpsData = makeGpsData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test-only override of opaque state
      (gpsData as any).gpsEvents.alignmentMatrix = matrix;
      const state = makeState(gpsData);
      expect(selectAlignmentMatrix(state)).toBe(matrix);
    });

    it('selectGpsPositions returns GPS positions array', () => {
      const gpsData = makeGpsData();
      const gps = [
        {
          id: '1',
          latitude: 50,
          longitude: 8,
          coordinates: [0, 0, 0] as [number, number, number],
          weight: 1,
          timestamp: 1,
          zeroRef: { lat: 50, lon: 8 },
        },
      ];
      (gpsData as any).gpsEvents.gpsPositions = gps; // eslint-disable-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test-only override of opaque state
      const state = makeState(gpsData);
      expect(selectGpsPositions(state)).toBe(gps);
    });

    it('selectZeroReference returns the zero ref', () => {
      const zero = { lat: 50.123, lon: 8.456 };
      const gpsData = makeGpsData({ zero });
      const state = makeState(gpsData);
      expect(selectZeroReference(state)).toBe(zero);
    });

    it('selectReferencePoints returns reference points', () => {
      const refPoints = [
        {
          id: 'rp1',
          gpsPoint: {
            id: 'rp1',
            latitude: 50,
            longitude: 8,
            zeroRef: { lat: 50, lon: 8 },
            coordinates: [0, 0, 0] as [number, number, number],
            weight: 1,
            timestamp: 1000,
          },
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          timestamp: 1000,
        },
      ];
      const gpsData = makeGpsData({ referencePoints: refPoints });
      const state = makeState(gpsData);
      expect(selectReferencePoints(state)).toBe(refPoints);
    });
  });

  // --- Memoization ---

  describe('memoization', () => {
    it('selectAlignmentMatrix returns same reference for same gpsData', () => {
      // Why: subscribeToSelector relies on reference equality to skip unchanged values
      const gpsData = makeGpsData();
      const state = makeState(gpsData);
      const result1 = selectAlignmentMatrix(state);
      const result2 = selectAlignmentMatrix(state);
      expect(result1).toBe(result2);
    });

    it('selectGpsPositions returns same reference for same gpsData', () => {
      const gpsData = makeGpsData();
      const state = makeState(gpsData);
      const result1 = selectGpsPositions(state);
      const result2 = selectGpsPositions(state);
      expect(result1).toBe(result2);
    });

    it('selectors return stable empty arrays for null gpsData across calls', () => {
      // Why: prevents subscribeToSelector from firing on every dispatch
      // when gpsData is null (e.g., before recording starts)
      const state1 = makeState(null);
      const state2 = makeState(null); // different state object, same gpsData=null

      // Same state → same result
      expect(selectGpsPositions(state1)).toBe(selectGpsPositions(state1));

      // For different state objects but same null gpsData, createSelector
      // will re-evaluate since the input (gpsData) ref changes from the first
      // state to the second state... but null === null, so it should cache.
      // Actually: state1.gpsData === null and state2.gpsData === null
      // null === null → input unchanged → cached result returned
      expect(selectGpsPositions(state1)).toBe(selectGpsPositions(state2));
    });
  });
});
