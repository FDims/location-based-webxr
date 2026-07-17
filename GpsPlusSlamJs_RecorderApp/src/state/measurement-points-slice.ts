/**
 * Measurement Points Slice — RTK state for the measurement-point marking flow.
 *
 * Mirrors the ref-points-slice.ts pattern: a createSlice with typed reducers,
 * registered in recorder-store.ts via extraReducers + persistedExtraPrefixes
 * so every action is persisted to the action log and replays deterministically.
 *
 * The slice owns:
 *  - Pending rays (accumulated during the marking flow, pre-confirm)
 *  - Confirmed measurement points (persisted to disk)
 *
 * The `selectProvisionalMeasurement` memoized selector runs the MSAC solver
 * on pending rays, providing a single source of truth for both the provisional
 * Three.js sphere and the UI coaching banner.
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSelector, createSlice } from '@reduxjs/toolkit';
import type {
  MeasurementRayRecord,
  MeasurementPointEntity,
} from '../storage/measurement-point-loader';
import {
  solveRobustTriangulation,
  type MeasurementRayObservation,
  type RobustTriangulationResult,
} from '../utils/robust-triangulation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeasurementPointsState {
  /** Rays accumulated for the currently-being-measured point (pre-confirm) */
  readonly pendingRays: MeasurementRayRecord[];
  /** Confirmed, persisted measurement points */
  readonly confirmed: MeasurementPointEntity[];
}

const initialState: MeasurementPointsState = {
  pendingRays: [],
  confirmed: [],
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const measurementPointsSlice = createSlice({
  name: 'measurementPoints',
  initialState,
  reducers: {
    addMeasurementRay(state, action: PayloadAction<MeasurementRayRecord>) {
      // Immer Draft widens readonly tuples; assert through.
      state.pendingRays.push(
        action.payload as (typeof state.pendingRays)[number]
      );
    },
    confirmMeasurementPoint(
      state,
      action: PayloadAction<MeasurementPointEntity>
    ) {
      state.confirmed.push(action.payload as (typeof state.confirmed)[number]);
      // Clear pending rays — the marking flow for this point is complete.
      state.pendingRays = [];
    },
    deleteMeasurementPoint(state, action: PayloadAction<{ id: string }>) {
      state.confirmed = state.confirmed.filter(
        (p) => p.id !== action.payload.id
      );
    },
    undoMeasurementRay(state) {
      state.pendingRays.pop();
    },
    resetMeasurementPoints() {
      return initialState;
    },
  },
});

export const {
  addMeasurementRay,
  confirmMeasurementPoint,
  deleteMeasurementPoint,
  undoMeasurementRay,
  resetMeasurementPoints,
} = measurementPointsSlice.actions;

export const measurementPointsReducer = measurementPointsSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Convert a MeasurementRayRecord (persistence shape) to the
 * MeasurementRayObservation (solver shape) expected by
 * solveRobustTriangulation.
 */
function toSolverObservation(
  ray: MeasurementRayRecord
): MeasurementRayObservation {
  return {
    id: ray.id,
    timestamp: ray.timestamp,
    rayOrigin: ray.rayOrigin,
    rayDirection: ray.rayDirection,
    rayWeight: ray.rayWeight,
    depthPoint: ray.depthPoint,
    depthWeight: ray.depthWeight,
  };
}

const EMPTY_RAYS: readonly MeasurementRayRecord[] = Object.freeze([]);

/**
 * Returns the pending rays array. When empty, returns a stable sentinel
 * so reselect subscribers don't re-render on unrelated dispatches.
 */
export const selectPendingRays = createSelector(
  (state: MeasurementPointsState) => state.pendingRays,
  (rays): readonly MeasurementRayRecord[] =>
    rays.length === 0 ? EMPTY_RAYS : rays
);

/**
 * Memoized selector that runs the MSAC solver on the pending rays.
 * Provides the single source of truth for the provisional UI coaching
 * banner and the live Three.js provisional sphere.
 *
 * Returns null when there are no pending rays, or when the solver
 * cannot find a valid solution (e.g. single ray without depth).
 */
export const selectProvisionalMeasurement = createSelector(
  (state: MeasurementPointsState) => state.pendingRays,
  (pendingRays): RobustTriangulationResult | null => {
    if (pendingRays.length === 0) return null;
    const solverObs = pendingRays.map(toSolverObservation);
    return solveRobustTriangulation(solverObs);
  }
);

const EMPTY_CONFIRMED: readonly MeasurementPointEntity[] = Object.freeze([]);

/**
 * Returns the confirmed measurement points. Stable sentinel when empty.
 */
export const selectConfirmedMeasurementPoints = createSelector(
  (state: MeasurementPointsState) => state.confirmed,
  (confirmed): readonly MeasurementPointEntity[] =>
    confirmed.length === 0 ? EMPTY_CONFIRMED : confirmed
);
