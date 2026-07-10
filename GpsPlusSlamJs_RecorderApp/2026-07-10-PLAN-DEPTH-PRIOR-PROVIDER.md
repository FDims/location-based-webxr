### DESCRIPTION
Sample the recorder's existing depth map / occupancy grid along the aimed direction (the crosshair pixel, or the tapped pixel), unproject it to a 3D point on the ray, and attach a confidence weight that decays with distance. Reuse the recorder's depth-sampling rather than adding a parallel one.

### GOALS
- Sample the depth map / occupancy grid along the aimed direction (the crosshair pixel, or the tapped pixel)
- Unproject it to a 3D point on the ray
- Attach a confidence weight that decays with distance
- Reuse the recorder's depth-sampling rather than adding a parallel one

#### Viewport Alignment & Coordinates
To prevent skew from aspect ratio differences (e.g. $19.5:9$ phone screen displaying a letterboxed $4:3$ WebXR camera feed), the caller MUST map screen-space inputs (`aimedScreenX`, `aimedScreenY`) to the normalised camera texture coordinate frame $[0,1]$ matching the projection matrix before passing them to the provider.

#### Types

```typescript
/** Single recorded depth point: screen-normalised coords + depth in metres. */
export interface DepthPointInput {
  /** Normalised horizontal screen position [0, 1]. */
  readonly screenX: number;
  /** Normalised vertical screen position [0, 1]. */
  readonly screenY: number;
  /** Linear depth in metres (positive = in front of camera). */
  readonly depthM: number;
}

/**
 * Subset of DepthSample the provider reads at shoot-time.
 * Matches the shape of DepthSample from gps-plus-slam-app-framework/types/ar-types.
 */
export interface DepthSampleInput {
  /** Recorded depth points for this frame. */
  readonly points: readonly DepthPointInput[];
  /**
   * WebXR projection matrix (column-major, 16 elements).
   * Absent in recordings made before intrinsics capture.
   */
  readonly projectionMatrix?: Matrix4;
  /** Camera position in the raw WebXR frame at capture time. */
  readonly cameraPos: Vector3;
  /** Camera orientation (quaternion xyzw) in the raw WebXR frame. */
  readonly cameraRot: Quaternion;
}

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
   * Default: 0.15 (allows ~2 cells on a 16-column depth grid).
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
```

#### Functions

```typescript
/**
 * Main entry point.
 *
 * Gathers a local neighbourhood of depth points around the aimed pixel, computes
 * the local standard deviation to check for depth discontinuities (edges),
 * unprojects the nearest point to world space, and calculates a distance-decaying
 * weight penalized by the edge variance.
 *
 * Returns null when no usable depth is available:
 *   - sample is null / undefined (no depth session, or replay pre-dating depth)
 *   - sample.projectionMatrix is absent (recording made before intrinsics capture)
 *   - no DepthPoint within maxScreenDist of the aimed pixel
 *   - depthM ≤ 0 or non-finite
 *   - depth standard deviation is too high (edge boundary, weight drops to 0)
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

  // Step 1 — Gather depth points in screen-space radius
  const localPoints = findDepthPointsInRadius(points, aimedScreenX, aimedScreenY, maxScreenDist);
  if (localPoints.length === 0) return null;

  // Find the closest point in screen space to define the aimed ray position
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

  // Step 2 — Check edge variance
  const edgePenalty = computeEdgePenalty(localPoints, maxAllowedDepthStdDevM);
  if (edgePenalty <= 0) return null;

  // Step 3 — Unproject from screen → camera space
  const cameraPt = unprojectScreenToCamera(screenX, screenY, depthM, projectionMatrix);
  if (!cameraPt) return null;

  // Step 4 — Transform camera → world space
  const worldPt = transformCameraToWorld(cameraPt, cameraPos, cameraRot);

  // Step 5 — Compute weight (base range weight * edge penalty)
  const baseWeight = computeDepthWeight(depthM, referenceRangeM);
  const finalWeight = baseWeight * edgePenalty;

  if (finalWeight <= 0) return null;

  return { point: worldPt, weight: finalWeight, depthM };
}

/**
 * Step 1 Helper: Find all depth points within a screen-space radius of the aimed point.
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
 * Step 2 Helper: Compute edge confidence penalty based on local depth variance.
 *
 * Active ToF/stereo sensors suffer from edge bleeding. If standard deviation of
 * depth values in the neighbourhood exceeds maxAllowedDepthStdDevM, confidence drops.
 *
 * Penalty = Max(0, 1 - StandardDeviation / MaxAllowedStandardDeviation)
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
 * Step 3 Helper: Reverse the WebXR NDC → camera-space projection.
 *
 * WebXR projection matrix is column-major: P[col*4 + row].
 * GL convention: camera looks down −Z, so the perspective divide is w = −zC.
 *
 * Derivation (column-major P, forward pass):
 *   NDC_x = P[0]·(xC / −zC) + P[8]
 *   NDC_y = P[5]·(yC / −zC) + P[9]
 *   NDC   = 2·screen − 1
 *   zC    = −depthM
 *
 * Inverting:
 *   xC = (NDC_x − P[8]) · (−zC) / P[0]
 *   yC = (NDC_y − P[9]) · (−zC) / P[5]
 *
 * Returns null for a degenerate projection (zero or non-finite focal length).
 */
export function unprojectScreenToCamera(
  screenX: number,
  screenY: number,
  depthM: number,
  projectionMatrix: Matrix4
): Vector3 | null {
  const p00 = projectionMatrix[0]; // fx_ndc  (col 0, row 0)
  const p11 = projectionMatrix[5]; // fy_ndc  (col 1, row 1)
  const p20 = projectionMatrix[8]; // m20 — principal-point x offset  (col 2, row 0)
  const p21 = projectionMatrix[9]; // m21 — principal-point y offset  (col 2, row 1)

  if (!Number.isFinite(p00) || !Number.isFinite(p11) || p00 === 0 || p11 === 0) {
    return null;
  }

  const ndcX = 2.0 * screenX - 1.0;
  const ndcY = 2.0 * screenY - 1.0;
  const zC = -depthM; // camera looks down −Z

  const xC = ((ndcX - p20) * (-zC)) / p00;
  const yC = ((ndcY - p21) * (-zC)) / p11;

  return [xC, yC, zC];
}

/**
 * Step 4 Helper: transform a camera-local point to world space (raw WebXR frame).
 *
 * Applies the quaternion rotation cameraRot (xyzw) to cameraPt, then adds
 * cameraPos. Uses the efficient sandwich formula:
 *   v' = v + 2w(q × v) + 2(q × (q × v))
 */
export function transformCameraToWorld(
  cameraPt: Vector3,
  cameraPos: Vector3,
  cameraRot: Quaternion
): Vector3 {
  const [x, y, z] = cameraPt;
  const [qx, qy, qz, qw] = cameraRot;

  // t = 2 * (q × v)
  const tx = 2.0 * (qy * z - qz * y);
  const ty = 2.0 * (qz * x - qx * z);
  const tz = 2.0 * (qx * y - qy * x);

  // v' = v + w·t + (q × t)
  return [
    cameraPos[0] + x + qw * tx + (qy * tz - qz * ty),
    cameraPos[1] + y + qw * ty + (qz * tx - qx * tz),
    cameraPos[2] + z + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Step 5 Helper: Quartic confidence weight matching active sensor noise laws.
 *
 *   baseWeight = 1 / (1 + (depthM / referenceRangeM)^4)
 *
 * Quartic exponent (d^4) models the quadratic standard deviation noise growth (O(d^2))
 * typical of ToF and stereo depth sensors.
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
```

#### "No usable depth" — handled cleanly (all return `null`)
1. `sample` is `null` or `undefined`
2. `projectionMatrix` absent (old recording)
3. No `DepthPoint` within `maxScreenDist` of the aimed pixel
4. `depthM ≤ 0` or non-finite
5. Neighbourhood standard deviation $\sigma_d \ge \text{maxAllowedDepthStdDevM}$ (edge boundary)

### TEST
Unit-test the pure unprojection, the local standard deviation variance/edge penalty, and the quartic decay confidence/weight model.

#### `computeDepthWeight`
- value ≈ 1.0 at 0 m
- exactly 0.5 at `referenceRangeM`
- decays toward 0 rapidly at long range (quartic drop-off)
- strictly monotonically decreasing with distance
- returns 0 for negative / NaN / Infinity depthM
- returns 0 for non-positive `referenceRangeM`
- always produces a value in [0, 1]

#### `findDepthPointsInRadius`
- returns empty array if points is empty
- returns all points within Euclidean distance `maxDist` in screen coords
- excludes points outside screen-space radius

#### `computeEdgePenalty`
- returns 1.0 for single point (no variance)
- returns 1.0 for multiple points with identical depths (flat surface)
- returns 0.0 if standard deviation of depths matches or exceeds `maxAllowedDepthStdDevM`
- returns a linear gradient factor for standard deviations between 0 and the max limit

#### `unprojectScreenToCamera`
- crosshair centre (0.5, 0.5) with centred projection → x=0, y=0, z=−depth
- top-left corner (0, 0) unprojects correctly
- bottom-right corner (1, 1) unprojects symmetrically
- output scales linearly with depth
- returns null for degenerate projection (zero focal length)
- returns null for non-finite projection values

#### `transformCameraToWorld`
- identity rotation leaves camera point unchanged (only translates)
- 90° Y-axis rotation maps x-unit vector to −Z
- non-zero origin adds translation after rotation

#### `sampleDepthPrior` (integration)
- null for null sample
- null for undefined sample
- null when `projectionMatrix` absent
- null when no depth point within `maxScreenDist`
- null for depthM ≤ 0
- null if edge penalty drops to 0 due to high standard deviation
- valid observation for flat neighbourhood crosshair at 2 m: weight=0.5, point=[0,0,−2] (identity pose)
- weight is close to 1.0 for very near depth in flat neighbourhood
- weight collapses to near 0 for far target
- picks the nearest depth point from the radius neighbourhood for unprojection

### INTEGRATION NOTE

The caller (e.g. a future `measurement-point-handlers.ts` mirroring `ref-point-handlers.ts`) will:
1. Ensure screen tap or aiming inputs (`screenX`, `screenY`) are corrected for aspect-ratio differences between the camera frustum and viewport *before* unprojection.
2. Read `state.recording.latestDepthSample` from the store at shoot-time.
3. Pass `{ points, projectionMatrix, cameraPos, cameraRot }` + the aimed pixel into `sampleDepthPrior`.
4. Attach the `DepthPriorObservation | null` to the `addMeasurementRay` Redux action payload.
5. The triangulation solver (Components 1 & 3) folds `observation.point` and `observation.weight`
   as the depth soft prior — trusted up close and on flat geometry, fading smoothly to zero at occlusion boundaries.

### DEMO RESULTS

The implementation was successfully completed and verified on 2026-07-10. All 32 unit tests and 4 interactive demo cases passed.

#### 1. Core Utilities Implementation
- Implemented [depth-prior-provider.ts](file:///c:/Users/fachr/Documents/Github/location-based-webxr/GpsPlusSlamJs_RecorderApp/src/utils/depth-prior-provider.ts) containing:
  - `sampleDepthPrior`: orchestration entry-point.
  - `unprojectScreenToCamera`: NDC-to-camera-space inverse projection using sign-aligned Y axis mapping matching `depth-unprojection.ts` (`ndcY = 1.0 - 2.0 * screenY`).
  - `transformCameraToWorld`: pose translation and quaternion sandwich rotation formula.
  - `computeDepthWeight`: quartic decay confidence model ($\frac{1}{1 + (d/r)^4}$).
  - `computeEdgePenalty`: standard deviation check to reject depth prior at discontinuities.

#### 2. Test Verification
- All tests in [depth-prior-provider.test.ts](file:///c:/Users/fachr/Documents/Github/location-based-webxr/GpsPlusSlamJs_RecorderApp/src/utils/depth-prior-provider.test.ts) pass, including:
  - Monotonicity and boundary checks for `computeDepthWeight`.
  - Edge penalty rejection under neighborhood variance.
  - Equivalence check verifying that our custom camera-to-world transform exactly matches the framework's own `unprojectDepthPoint` across randomized inputs.

#### 3. Interactive Demo Output
Running `pnpm vitest run src/utils/depth-prior-demo.test.ts --config=config/vitest.config.ts --coverage=false --silent=false` produces the following console output:

```
================================================================
DEPTH PRIOR PROVIDER DEMO PROTOTYPE
================================================================
Camera Position: [0, 1.6, 0]
Camera Rotation: [0, 0, 0, 1]
Reference Range: 2 meters (confidence drops to 0.5 at this distance)

--- TARGET A: Near Object ---
Aimed screen position   : (0.500, 0.500)
Raw depth measured      : 1.200 m
Unprojected 3D point    : (0.0000, 1.6000, -1.2000)  [world/WebXR frame]
Confidence weight       : 0.88527  [██████████████████░░]
✓ Near object → HIGH confidence (well inside knee distance)

--- TARGET B: Far Object ---
Aimed screen position   : (0.500, 0.500)
Raw depth measured      : 6.000 m
Unprojected 3D point    : (0.0000, 1.6000, -6.0000)  [world/WebXR frame]
Confidence weight       : 0.01220  [░░░░░░░░░░░░░░░░░░░░]
✓ Far object → LOW confidence (quartic collapse 3× past knee)

--- CONFIDENCE COLLAPSE TABLE ---
  Depth     Weight      Bar (20 chars)            World point  [x, y, z]
  ────────────────────────────────────────────────────────────────────────────
  0.5 m     0.99611     [████████████████████]  (0.000, 1.600, -0.500)
  1.0 m     0.94118     [███████████████████░]  (0.000, 1.600, -1.000)
  1.5 m     0.75964     [███████████████░░░░░]  (0.000, 1.600, -1.500)
  2.0 m     0.50000     [██████████░░░░░░░░░░]  (0.000, 1.600, -2.000)  ← knee
  2.5 m     0.29058     [██████░░░░░░░░░░░░░░]  (0.000, 1.600, -2.500)
  3.0 m     0.16495     [███░░░░░░░░░░░░░░░░░]  (0.000, 1.600, -3.000)
  4.0 m     0.05882     [█░░░░░░░░░░░░░░░░░░░]  (0.000, 1.600, -4.000)
  5.0 m     0.02496     [░░░░░░░░░░░░░░░░░░░░]  (0.000, 1.600, -5.000)
  6.0 m     0.01220     [░░░░░░░░░░░░░░░░░░░░]  (0.000, 1.600, -6.000)
  8.0 m     0.00389     [░░░░░░░░░░░░░░░░░░░░]  (0.000, 1.600, -8.000)
  10.0 m    0.00160     [░░░░░░░░░░░░░░░░░░░░]  (0.000, 1.600, -10.000)

  ► Analytical knee check: computeDepthWeight(2.0, 2.0) = 0.500000

--- TARGET C: Edge Discontinuity (Bleeding Boundary) ---
Depths in neighborhood: 0.5m, 2.5m, 2.5m (high variance)
Result                  : null — prior correctly SUPPRESSED on edge boundary ✓
================================================================
```

