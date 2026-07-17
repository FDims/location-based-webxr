/**
 * Measurement Point Handlers
 *
 * Encapsulates the side-effect orchestration for the measurement-point
 * marking flow: capturing rays, persisting confirmed points, and deleting.
 *
 * Modeled after ref-point-handlers.ts — the factory pattern allows main.ts
 * to inject dependencies that change over the app lifecycle (the active
 * store, current session name, scenario handle).
 *
 * Pure math lives in ray-triangulation-core.ts and robust-triangulation.ts.
 * This module wires the Redux dispatches and OPFS side-effects.
 */

import { getCurrentArPose } from 'gps-plus-slam-app-framework/ar/webxr-session';
import {
  extractOdomPosition,
  extractOdomRotation,
} from 'gps-plus-slam-app-framework/state/gps-event-coordinator';
import { getCurrentScenarioHandle } from '../storage/scenario-storage';
import {
  writeMeasurementPoint,
  deleteMeasurementPointFile,
  type MeasurementRayRecord,
  type MeasurementPointEntity,
} from '../storage/measurement-point-loader';
import { sampleDepthPrior } from '../utils/depth-prior-provider';
import {
  addMeasurementRay,
  confirmMeasurementPoint,
  deleteMeasurementPoint,
  undoMeasurementRay,
  selectProvisionalMeasurement,
} from '../state/measurement-points-slice';
import type { RobustTriangulationResult } from '../utils/robust-triangulation';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import type { RecorderStore } from '../state/recorder-store';

const log = createLogger('MeasurementPointHandlers');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeasurementPointHandlersDeps {
  /** Returns the current store instance (may change between recordings). */
  getStore: () => RecorderStore;
  /** Returns the current session name (set when recording starts). */
  getCurrentSessionName: () => string;
  /** UI: show error toast/banner. */
  showError: (msg: string) => void;
  /** UI: show info toast. */
  showToast: (msg: string) => void;
}

export interface MeasurementPointHandlers {
  /**
   * "Shoot" a ray: capture the current AR pose, sample depth, and dispatch
   * addMeasurementRay into the store.
   *
   * @param aimedScreenX - Normalised screen X [0,1] of the aimed pixel
   * @param aimedScreenY - Normalised screen Y [0,1] of the aimed pixel
   */
  handleShootRay(aimedScreenX: number, aimedScreenY: number): void;

  /**
   * Confirm the current pending measurement: solve the final point,
   * persist to OPFS, and dispatch confirmMeasurementPoint.
   */
  handleConfirmPoint(scenarioId: string): Promise<void>;

  /**
   * Delete a confirmed measurement point from the store and OPFS.
   */
  handleDeletePoint(pointId: string): Promise<void>;

  /**
   * Undo the last added ray (before confirmation).
   */
  handleUndoRay(): void;

  /**
   * Get the current provisional measurement result (for UI coaching).
   */
  getProvisionalResult(): RobustTriangulationResult | null;

  /** Lifecycle reset. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let rayIdCounter = 0;

function generateRayId(): string {
  return `ray-${Date.now()}-${rayIdCounter++}`;
}

/**
 * Build the ray direction from the AR pose.
 * For crosshair aiming, the ray direction is the camera forward vector
 * (negative Z in WebXR convention), rotated by the device orientation.
 */
function buildRayFromPose(
  position: Vector3,
  rotation: readonly [number, number, number, number]
): { origin: Vector3; direction: Vector3 } {
  // Quaternion-rotate the forward vector (0, 0, -1) by the device rotation.
  const [qx, qy, qz, qw] = rotation;
  // v' = q * v * q^-1, where v = (0, 0, -1)
  // Simplified for v = (0, 0, -1):
  const dx = 2 * (qx * qz + qy * qw);
  const dy = 2 * (qy * qz - qx * qw);
  const dz = -(1 - 2 * (qx * qx + qy * qy));
  // Normalise
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const direction: Vector3 =
    len > 1e-10 ? [dx / len, dy / len, dz / len] : [0, 0, -1];
  return { origin: position, direction };
}

/**
 * Convert an AR-local position to GPS-world coordinates
 * using the current alignment matrix. Returns null if no alignment available.
 */
function arLocalToGpsWorld(
  arPosition: Vector3,
  state: ReturnType<RecorderStore['getState']>
): Vector3 | null {
  const alignmentMatrix = state.gpsData?.gpsEvents?.alignmentMatrix;
  if (!alignmentMatrix) return null;

  // Apply the 4x4 alignment matrix to the AR position.
  // alignmentMatrix is column-major [m00, m10, m20, m30, m01, ...]
  const m = alignmentMatrix;
  const [x, y, z] = arPosition;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** @public */
export function createMeasurementPointHandlers(
  deps: MeasurementPointHandlersDeps
): MeasurementPointHandlers {
  function handleShootRay(aimedScreenX: number, aimedScreenY: number): void {
    const arPose = getCurrentArPose();
    if (!arPose) {
      deps.showError('Cannot shoot ray — AR tracking not available');
      return;
    }

    const position = extractOdomPosition(arPose);
    const rotation = extractOdomRotation(arPose);
    const { origin, direction } = buildRayFromPose(position, rotation);
    const timestamp = Date.now();

    // Sample depth prior at the aimed pixel
    const state = deps.getStore().getState();
    const depthSample = state.recording.latestDepthSample ?? null;
    const depthObs = sampleDepthPrior(depthSample, aimedScreenX, aimedScreenY);

    const rayRecord: MeasurementRayRecord = {
      id: generateRayId(),
      timestamp,
      arPose: { position, rotation },
      rayOrigin: origin,
      rayDirection: direction,
      rayWeight: 1.0,
      ...(depthObs
        ? { depthPoint: depthObs.point, depthWeight: depthObs.weight }
        : {}),
    };

    deps.getStore().dispatch(addMeasurementRay(rayRecord));
    log.info(
      `Shot ray ${rayRecord.id} (depth: ${depthObs ? `${depthObs.depthM.toFixed(1)}m w=${depthObs.weight.toFixed(2)}` : 'none'})`
    );
  }

  async function handleConfirmPoint(scenarioId: string): Promise<void> {
    const state = deps.getStore().getState();
    const provisional = selectProvisionalMeasurement(state.measurementPoints);

    if (!provisional) {
      deps.showError('Cannot confirm — no valid solution');
      return;
    }

    const pendingRays = state.measurementPoints.pendingRays;
    const gpsSnapshot = arLocalToGpsWorld(provisional.point, state);

    const entity: MeasurementPointEntity = {
      schemaVersion: 1,
      id: `mp-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scenarioId,
      observations: [...pendingRays],
      arPosition: provisional.point,
      gpsPositionSnapshot: gpsSnapshot ?? [0, 0, 0],
      uncertainty: provisional.uncertainty,
      rmsError: provisional.rmsError,
      inlierIds: provisional.inlierIds,
      outlierIds: provisional.outlierIds,
    };

    deps.getStore().dispatch(confirmMeasurementPoint(entity));

    // Persist to OPFS
    const scenarioHandle = getCurrentScenarioHandle();
    if (scenarioHandle) {
      try {
        await writeMeasurementPoint(scenarioHandle, entity);
        deps.showToast(`Confirmed measurement point`);
      } catch (err) {
        log.error('Failed to persist measurement point:', err);
        deps.showError('Failed to save measurement point to disk');
      }
    }
  }

  async function handleDeletePoint(pointId: string): Promise<void> {
    deps.getStore().dispatch(deleteMeasurementPoint({ id: pointId }));

    const scenarioHandle = getCurrentScenarioHandle();
    if (scenarioHandle) {
      try {
        await deleteMeasurementPointFile(scenarioHandle, pointId);
      } catch (err) {
        log.error('Failed to delete measurement point from disk:', err);
        deps.showError('Failed to delete measurement point from disk');
      }
    }
  }

  function handleUndoRay(): void {
    deps.getStore().dispatch(undoMeasurementRay());
    log.info('Undid last measurement ray');
  }

  function getProvisionalResult(): RobustTriangulationResult | null {
    const state = deps.getStore().getState();
    return selectProvisionalMeasurement(state.measurementPoints);
  }

  function reset(): void {
    // resetMeasurementPoints is imported from the slice but dispatched
    // through the recorder's lifecycle reset — see main.ts.
    // The handler reset is a no-op for local state; the slice reset
    // is dispatched by whoever owns the lifecycle.
    rayIdCounter = 0;
  }

  return {
    handleShootRay,
    handleConfirmPoint,
    handleDeletePoint,
    handleUndoRay,
    getProvisionalResult,
    reset,
  };
}
