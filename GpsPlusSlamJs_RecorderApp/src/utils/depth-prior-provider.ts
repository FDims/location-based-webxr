/**
 * Depth Prior Provider
 *
 * Samples recorded depth point clouds, unprojects them to 3D world space,
 * and computes a distance-decaying confidence weight penalized by local edge variance.
 */

import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-app-framework/core';

/** A single recorded depth point containing normalized viewport coordinates and raw depth. */
export interface DepthPointInput {
  readonly screenX: number;
  readonly screenY: number;
  readonly depthM: number;
}

/** A frame's depth points, camera pose, and projection matrix. */
export interface DepthSampleInput {
  readonly points: readonly DepthPointInput[];
  readonly projectionMatrix?: Matrix4;
  readonly cameraPos: Vector3;
  readonly cameraRot: Quaternion;
}

/** The computed 3D world position and confidence weight for a target depth prior. */
export interface DepthPriorObservation {
  readonly point: Vector3;
  readonly weight: number;
  readonly depthM: number;
}

/** Configuration options for depth prior sampling. */
export interface SampleDepthPriorOptions {
  readonly referenceRangeM?: number;
  readonly maxScreenDist?: number;
  readonly maxAllowedDepthStdDevM?: number;
}

/**
 * Samples a depth point near the aimed coordinate, checks for depth boundaries,
 * unprojects it, and computes a confidence weight decaying with distance.
 * Returns null if no usable depth is found in the target neighborhood or if on a depth boundary.
 */
export function sampleDepthPrior(
  sample: DepthSampleInput | null | undefined,
  aimedScreenX: number,
  aimedScreenY: number,
  options: SampleDepthPriorOptions = {}
): DepthPriorObservation | null {
  if (!sample) return null;

  const { projectionMatrix, points, cameraPos, cameraRot } = sample;
  if (!projectionMatrix) return null;

  const maxScreenDist = options.maxScreenDist ?? 0.15;
  const referenceRangeM = options.referenceRangeM ?? 2.0;
  const maxAllowedDepthStdDevM = options.maxAllowedDepthStdDevM ?? 0.5;

  // Step 1: Neighborhood search
  const localPoints = findDepthPointsInRadius(points, aimedScreenX, aimedScreenY, maxScreenDist);
  if (localPoints.length === 0) return null;

  let nearest: DepthPointInput | null = null;
  let nearestDist2 = Infinity;
  for (const p of localPoints) {
    const dx = p.screenX - aimedScreenX;
    const dy = p.screenY - aimedScreenY;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestDist2) {
      nearestDist2 = d2;
      nearest = p;
    }
  }

  if (!nearest) return null;
  const { depthM, screenX, screenY } = nearest;
  if (!Number.isFinite(depthM) || depthM <= 0) return null;

  // Step 2: Edge penalty
  const edgePenalty = computeEdgePenalty(localPoints, maxAllowedDepthStdDevM);
  if (edgePenalty <= 0) return null;

  // Step 3: Unproject to camera space
  const cameraPt = unprojectScreenToCamera(screenX, screenY, depthM, projectionMatrix);
  if (!cameraPt) return null;

  // Step 4: Transform to world space
  const worldPt = transformCameraToWorld(cameraPt, cameraPos, cameraRot);

  // Step 5: Compute weight
  const baseWeight = computeDepthWeight(depthM, referenceRangeM);
  const finalWeight = baseWeight * edgePenalty;

  if (finalWeight <= 0) return null;

  return { point: worldPt, weight: finalWeight, depthM };
}

/**
 * Finds all recorded depth points within a screen-space radius of the aimed pixel.
 */
export function findDepthPointsInRadius(
  points: readonly DepthPointInput[],
  aimedX: number,
  aimedY: number,
  maxDist: number
): DepthPointInput[] {
  const maxDist2 = maxDist * maxDist;
  const results: DepthPointInput[] = [];

  for (const p of points) {
    const dx = p.screenX - aimedX;
    const dy = p.screenY - aimedY;
    if (dx * dx + dy * dy <= maxDist2) {
      results.push(p);
    }
  }

  return results;
}

/**
 * Computes a weight penalty based on standard deviation of depth values in the neighborhood.
 * Returns 1.0 for flat neighborhoods, decaying to 0.0 at discontinuity boundaries.
 */
export function computeEdgePenalty(
  localPoints: readonly DepthPointInput[],
  maxAllowedDepthStdDevM: number
): number {
  if (localPoints.length <= 1) return 1.0;

  let sum = 0;
  for (const p of localPoints) {
    sum += p.depthM;
  }
  const mean = sum / localPoints.length;

  let sumSqDiff = 0;
  for (const p of localPoints) {
    const diff = p.depthM - mean;
    sumSqDiff += diff * diff;
  }

  const variance = sumSqDiff / localPoints.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev >= maxAllowedDepthStdDevM) return 0.0;
  return 1.0 - stdDev / maxAllowedDepthStdDevM;
}

/**
 * Inverts WebXR perspective projection to map screen coordinates and depth to camera-local space.
 * Uses sign-aligned Y coordinates mapping matching depth-unprojection.ts (ndcY = 1.0 - 2.0 * screenY).
 */
export function unprojectScreenToCamera(
  screenX: number,
  screenY: number,
  depthM: number,
  projectionMatrix: Matrix4
): Vector3 | null {
  if (projectionMatrix.length !== 16) return null;
  const p00 = projectionMatrix[0];
  const p11 = projectionMatrix[5];
  const p20 = projectionMatrix[8];
  const p21 = projectionMatrix[9];

  if (!Number.isFinite(p00) || !Number.isFinite(p11) || p00 === 0 || p11 === 0) {
    return null;
  }

  const ndcX = 2.0 * screenX - 1.0;
  const ndcY = 1.0 - 2.0 * screenY;
  const zC = -depthM;

  const xC = ((ndcX - p20) * (-zC)) / p00;
  const yC = ((ndcY - p21) * (-zC)) / p11;

  return [xC, yC, zC];
}

/**
 * Transforms a camera-local 3D coordinate to world space using camera position and orientation.
 */
export function transformCameraToWorld(
  cameraPt: Vector3,
  cameraPos: Vector3,
  cameraRot: Quaternion
): Vector3 {
  const [x, y, z] = cameraPt;
  const [qx, qy, qz, qw] = cameraRot;

  const tx = 2.0 * (qy * z - qz * y);
  const ty = 2.0 * (qz * x - qx * z);
  const tz = 2.0 * (qx * y - qy * x);

  return [
    cameraPos[0] + x + qw * tx + (qy * tz - qz * ty),
    cameraPos[1] + y + qw * ty + (qz * tx - qx * tz),
    cameraPos[2] + z + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Computes a quartic distance-decaying confidence weight matching ToF/stereo noise models.
 */
export function computeDepthWeight(depthM: number, referenceRangeM: number): number {
  if (!Number.isFinite(depthM) || depthM < 0) return 0;
  if (!Number.isFinite(referenceRangeM) || referenceRangeM <= 0) return 0;
  const ratio = depthM / referenceRangeM;
  const ratio2 = ratio * ratio;
  return 1.0 / (1.0 + ratio2 * ratio2);
}
