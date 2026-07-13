/**
 * Depth Prior Provider — Component 2 of the Measurement Points feature.
 *
 * Samples the recorder's existing depth map along the aimed direction (the
 * crosshair pixel, or a tapped pixel), unprojects it to a 3D point on the ray,
 * and attaches a confidence weight that decays with distance.
 *
 * Reuses the framework's existing `createDepthGridLookup` (bilinear
 * interpolation on the sparse depth grid) and `createDepthUnprojector`
 * (NDC → camera → world transform) rather than reimplementing them.
 *
 * Pure function — no DOM, no Three.js, no WebXR, no global state.
 *
 * @see 2026-10-07-PLAN-DEPTH-PRIOR-PROVIDER.md — the design document.
 * @see depth-unprojection.ts — the framework's unprojection (NDC Y-flip etc.).
 * @see depth-grid-lookup.ts — the framework's bilinear grid lookup.
 */

import type { DepthPoint, DepthSample } from 'gps-plus-slam-app-framework/types/ar-types';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import { createDepthGridLookup } from 'gps-plus-slam-app-framework/ar/depth-grid-lookup';
import { createDepthUnprojector } from 'gps-plus-slam-app-framework/ar/depth-unprojection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The depth-prior observation for one "shoot": a 3D world-space point on the
 * aimed ray plus a confidence weight.
 * Feed point and weight directly into the triangulation solver's depth-prior slot.
 */
export interface DepthPriorObservation {
  /**
   * 3D world-space position of the depth reading in the raw WebXR frame
   * (apply webxrToNUE when NUE is needed downstream).
   */
  readonly point: Vector3;
  /** Confidence weight in [0, 1] — see computeDepthWeight for the model. */
  readonly weight: number;
  /** Raw depth reading in metres (for diagnostics / logging). */
  readonly depthM: number;
}

/** Options for sampleDepthPrior. */
export interface SampleDepthPriorOptions {
  /**
   * Distance (metres) at which the confidence weight equals 0.5.
   * Matches the effective depth-sensor range of the target device.
   * Default: 2.0 m (conservative value for ARCore / ARKit depth).
   */
  readonly referenceRangeM?: number;
  /**
   * Maximum screen-space distance (normalised [0,1]) between the aimed pixel
   * and a depth point to include them in the neighbourhood variance calculation.
   * Default: 0.10 — tuned for the current 32-column depth grid where the cell
   * spacing is ~1/33 ≈ 0.030 (the sampler avoids edges: `(col+1)/(gridSize+1)`),
   * so 0.10 captures ~3 cells in each direction (~36 points in the neighbourhood).
   * If the recorder's gridSize changes, this default should be revisited to
   * maintain ~3-cell coverage.
   */
  readonly maxScreenDist?: number;
  /**
   * Maximum allowed standard deviation in depth within the local neighbourhood (metres).
   * If standard deviation exceeds this value, the prior is considered to be on a
   * depth discontinuity (edge) and its weight is zeroed.
   * Default: 0.5 m
   */
  readonly maxAllowedDepthStdDevM?: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Main entry point.
 *
 * Bilinearly interpolates the depth grid at the aimed pixel (via the framework's
 * createDepthGridLookup — the same lookup the QR depth resolver uses), checks
 * the local neighbourhood for depth discontinuities (edges), unprojects the
 * interpolated depth to world space (via the framework's createDepthUnprojector),
 * and calculates a distance-decaying weight penalized by edge variance.
 *
 * Returns null when no usable depth is available:
 *   - sample is null / undefined (no depth session, or replay pre-dating depth)
 *   - sample.projectionMatrix is absent (recording made before intrinsics capture)
 *   - bilinear depth lookup returns null or ≤ 0 at the aimed pixel
 *   - no DepthPoint within maxScreenDist of the aimed pixel (edge check needs neighbours)
 *   - depth standard deviation is too high (edge boundary, weight drops to 0)
 *   - unprojection fails (degenerate projection matrix)
 */
export function sampleDepthPrior(
  sample: DepthSample | null | undefined,
  aimedScreenX: number,
  aimedScreenY: number,
  options: SampleDepthPriorOptions = {},
): DepthPriorObservation | null {
  if (!sample) return null;

  const { projectionMatrix, points, cameraPos, cameraRot } = sample;
  if (!projectionMatrix) return null;

  const maxScreenDist = options.maxScreenDist ?? 0.1;
  const referenceRangeM = options.referenceRangeM ?? 2.0;
  const maxAllowedDepthStdDevM = options.maxAllowedDepthStdDevM ?? 0.5;

  // Step 1 — Bilinear depth interpolation at the aimed pixel
  // Uses the framework's createDepthGridLookup (same as QR depth resolver)
  // instead of snapping to the nearest grid point. This produces a smoother,
  // more accurate depth reading — especially on the coarse depth grids where
  // the nearest grid point can be far from the actual aimed pixel.
  // depthAt returns number | null (null for out-of-grid or invalid nodes).
  const depthLookup = createDepthGridLookup(points);
  const depthM = depthLookup.depthAt(aimedScreenX, aimedScreenY);
  if (depthM === null || depthM <= 0) return null;

  // Step 2 — Edge variance check on the local neighbourhood
  // Even though we interpolate for the depth value, we still check the raw
  // grid neighbourhood for depth discontinuities. A large variance means the
  // aimed pixel sits on a depth edge (e.g., building corner against sky)
  // where interpolation would blend foreground and background depths.
  const localPoints = findDepthPointsInRadius(
    points,
    aimedScreenX,
    aimedScreenY,
    maxScreenDist,
  );
  if (localPoints.length === 0) return null;

  const edgePenalty = computeEdgePenalty(localPoints, maxAllowedDepthStdDevM);
  if (edgePenalty <= 0) return null;

  // Step 3 — Unproject the interpolated depth to world space
  // Uses the framework's createDepthUnprojector which correctly handles:
  //   - Top-left origin screen coordinates (Y flip: ndcY = 1 - 2·screenY)
  //   - Full inverse-projection via gl-matrix mat4.invert
  //   - Quaternion camera-to-world rotation
  // This avoids reimplementing the NDC convention and projection math.
  const unprojector = createDepthUnprojector(cameraPos, cameraRot, projectionMatrix);
  if (!unprojector) return null;

  // Build a synthetic DepthPoint at the aimed pixel with the interpolated depth
  const worldPt = unprojector.unproject({
    screenX: aimedScreenX,
    screenY: aimedScreenY,
    depthM,
  });
  if (!worldPt) return null;

  // Step 4 — Compute weight (base range weight × edge penalty)
  const baseWeight = computeDepthWeight(depthM, referenceRangeM);
  const finalWeight = baseWeight * edgePenalty;

  if (finalWeight <= 0) return null;

  return { point: worldPt, weight: finalWeight, depthM };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find all depth points within a screen-space radius of the aimed point.
 * Used for edge-variance detection (Step 2), not for depth value selection
 * (Step 1 uses bilinear interpolation instead).
 */
export function findDepthPointsInRadius(
  points: readonly DepthPoint[],
  aimedX: number,
  aimedY: number,
  maxDist: number,
): DepthPoint[] {
  const maxDist2 = maxDist * maxDist;
  const results: DepthPoint[] = [];

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
 * Compute edge confidence penalty based on local depth variance.
 *
 * Active ToF/stereo sensors suffer from edge bleeding: at depth boundaries
 * (e.g. a building corner against the sky), the sensor returns depth values
 * that blend foreground and background, producing catastrophically wrong
 * readings — not just slightly noisy ones.
 *
 * Quadratic penalty (not linear) to match the severity of edge errors:
 *   Penalty = Max(0, 1 − (σ / σ_max)²)
 *
 * This is more aggressive than linear: at σ = 0.35·σ_max (~moderate variance),
 * linear gives 0.65 but quadratic gives 0.88 — still trusting the reading.
 * At σ = 0.7·σ_max, linear gives 0.30 but quadratic gives 0.51 — both
 * skeptical but quadratic holds on slightly longer for genuinely sloped
 * surfaces. The key difference is in the transition: quadratic is gentle for
 * small variance (natural surface undulation) but drops hard near the threshold
 * (genuine edges). This matches the bimodal nature of edge errors — either
 * you're on a smooth surface (low σ, high trust) or a depth boundary (high σ,
 * zero trust), with little useful middle ground.
 */
export function computeEdgePenalty(
  localPoints: readonly DepthPoint[],
  maxAllowedDepthStdDevM: number,
): number {
  // Single-point neighbourhood: no variance data available, so we assume no
  // edge. This is the right default — if there's only one nearby grid node,
  // we have no evidence of a depth discontinuity.
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
  const ratio = stdDev / maxAllowedDepthStdDevM;
  return 1.0 - ratio * ratio;
}

// NOTE: unprojectScreenToCamera and transformCameraToWorld are NOT reimplemented
// here. We delegate to the framework's createDepthUnprojector (from
// depth-unprojection.ts) which already handles:
//
//   - Top-left origin screen coordinates: ndcY = 1 − 2·screenY
//     (the depth sampler's screenY=0 is the TOP of the image, matching the
//     WebXR getDepthInMeters convention — NOT bottom-left GL convention)
//   - Full inverse-projection via gl-matrix mat4.invert (handles off-axis
//     projection matrices, not just the simple p00/p11/p20/p21 diagonal case)
//   - Quaternion camera-to-world rotation (same sandwich formula)
//   - Degenerate input guards (singular matrix, non-finite results)
//
// See depth-unprojection.ts lines 8–14 for the convention documentation.
// Reimplementing this math here would create a divergence risk — the QR
// sizing path and the measurement-point path would silently disagree if one
// fixed a bug and the other didn't.

/**
 * Quartic confidence weight matching active sensor noise laws.
 *
 *   baseWeight = 1 / (1 + (depthM / referenceRangeM)^4)
 *
 * Quartic exponent (d^4) models the quadratic standard deviation noise growth
 * (O(d^2)) typical of ToF and stereo depth sensors.
 *
 * Weight table (referenceRangeM = 2 m):
 *   0 m  → 1.000
 *   1 m  → 0.941
 *   2 m  → 0.500  ← knee
 *   3 m  → 0.165
 *   5 m  → 0.025
 *  10 m  → 0.002
 *
 * Returns 0 for non-finite or negative inputs.
 */
export function computeDepthWeight(depthM: number, referenceRangeM: number): number {
  if (!Number.isFinite(depthM) || depthM < 0) return 0;
  if (!Number.isFinite(referenceRangeM) || referenceRangeM <= 0) return 0;
  const ratio = depthM / referenceRangeM;
  const ratio2 = ratio * ratio;
  return 1.0 / (1.0 + ratio2 * ratio2);
}
