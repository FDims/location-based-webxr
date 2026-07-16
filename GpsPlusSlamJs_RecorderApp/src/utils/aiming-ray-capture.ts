/**
 * Aiming Ray Capture.
 * Turns a user "shoot" action into a mathematical ray in 3D space.
 */

import type { Vector3, Quaternion } from 'gps-plus-slam-app-framework/core';
import { createDepthUnprojector } from 'gps-plus-slam-app-framework/ar/depth-unprojection';

/**
 * A mathematical ray in 3D world space representing a user's measurement "shoot".
 */
export interface MeasurementRay {
  readonly origin: Vector3;
  /** Normalized direction vector. */
  readonly direction: Vector3;
}

/**
 * Creates a ray originating at the camera and passing through a specific normalized
 * screen pixel (tap).
 *
 * Uses the framework's createDepthUnprojector to handle inverse projection and
 * top-left coordinate conventions consistently with the depth grid.
 *
 * @param cameraPos The world-space camera position
 * @param cameraRot The world-space camera rotation (quaternion)
 * @param projectionMatrix The camera's projection matrix
 * @param screenX Normalized [0, 1] screen X coordinate (top-left origin)
 * @param screenY Normalized [0, 1] screen Y coordinate (top-left origin)
 * @returns A MeasurementRay or null if the projection matrix is degenerate or coordinates are out of bounds
 */
export function createTapRay(
  cameraPos: Vector3,
  cameraRot: Quaternion,
  projectionMatrix: number[] | Float32Array,
  screenX: number,
  screenY: number
): MeasurementRay | null {
  // Enforce coordinate clamping to [0, 1] bounds
  if (screenX < 0 || screenX > 1 || screenY < 0 || screenY > 1) {
    return null;
  }

  // Step 1: Create the unprojector
  const unprojector = createDepthUnprojector(cameraPos, cameraRot, projectionMatrix);
  if (!unprojector) return null;

  // Step 2: Unproject a point at an arbitrary depth (e.g., 1.0 meters)
  const targetPt = unprojector.unproject({ screenX, screenY, depthM: 1.0 });
  if (!targetPt) return null;

  // Step 3: Compute the direction vector from the camera origin to the unprojected target.
  const diffX = targetPt[0] - cameraPos[0];
  const diffY = targetPt[1] - cameraPos[1];
  const diffZ = targetPt[2] - cameraPos[2];

  const length = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);
  if (length === 0) return null; // Degenerate tap ray

  const direction: Vector3 = [
    diffX / length,
    diffY / length,
    diffZ / length
  ];

  return { origin: cameraPos, direction };
}
