### DESCRIPTION
Sample the recorder's existing depth map along the aimed direction (the crosshair pixel, or the tapped pixel), unproject it to a 3D point on the ray, and attach a confidence weight that decays with distance. Reuse the recorder's depth-sampling and existing unprojection infrastructure rather than adding a parallel one.

#### Scope note — occupancy grid
The GENERAL-DESCRIPTION mentions "depth map / occupancy grid". This component addresses only the **depth map** (`DepthSample.points`). The occupancy grid is a denser, accumulated 3D voxel representation that could provide depth via raycasting when the sparse depth grid has no coverage — but that is a Component 3 (fusion) concern and would require a fundamentally different sampling path. If the depth map returns no usable point, this component cleanly returns `null` and lets the triangulation solver proceed with ray-only estimation.

### GOALS
- Sample the depth map along the aimed direction (the crosshair pixel, or the tapped pixel)
- Unproject it to a 3D point on the ray via bilinear interpolation on the depth grid (consistent with the QR depth resolver's approach)
- Attach a confidence weight that decays with distance
- Reuse the recorder's depth-sampling and the framework's existing `createDepthGridLookup` / `createDepthUnprojector` rather than adding parallel implementations

#### File placement
The implementation (`depth-prior-provider.ts` + `depth-prior-provider.test.ts`) lives in **`src/utils/`** — it is a pure utility with no UI or handler coupling. The future `measurement-point-handlers.ts` (Component 4/5) will import it from there, mirroring how `ref-point-handlers.ts` imports utilities.

#### Viewport Alignment & Coordinates
To prevent skew from aspect ratio differences (e.g. $19.5:9$ phone screen displaying a letterboxed $4:3$ WebXR camera feed), the caller MUST map screen-space inputs (`aimedScreenX`, `aimedScreenY`) to the normalised camera texture coordinate frame $[0,1]$ matching the projection matrix before passing them to the provider.

#### Types

```typescript
// Reuse the canonical depth types from the framework — no parallel hierarchy.
import type { DepthPoint, DepthSample } from 'gps-plus-slam-app-framework/types/ar-types';
import type { Vector3 } from 'gps-plus-slam-js';

// Reuse the framework's bilinear depth-grid lookup and unprojector.
import { createDepthGridLookup } from 'gps-plus-slam-app-framework/ar/depth-grid-lookup';
import { createDepthUnprojector } from 'gps-plus-slam-app-framework/ar/depth-unprojection';

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
```

#### Functions

```typescript
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
 *   - bilinear depth lookup returns non-finite or ≤ 0 at the aimed pixel
 *   - no DepthPoint within maxScreenDist of the aimed pixel (edge check needs neighbours)
 *   - depth standard deviation is too high (edge boundary, weight drops to 0)
 *   - unprojection fails (degenerate projection matrix)
 */
export function sampleDepthPrior(
  sample: DepthSample | null | undefined,
  aimedScreenX: number,
  aimedScreenY: number,
  options: SampleDepthPriorOptions = {}
): DepthPriorObservation | null {
  if (!sample) return null;

  const { projectionMatrix, points, cameraPos, cameraRot } = sample;
  if (!projectionMatrix) return null;

  const maxScreenDist = options.maxScreenDist ?? 0.10;
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
  const localPoints = findDepthPointsInRadius(points, aimedScreenX, aimedScreenY, maxScreenDist);
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

/**
 * Step 2 Helper: Find all depth points within a screen-space radius of the aimed point.
 * Used for edge-variance detection (Step 2), not for depth value selection (Step 1
 * uses bilinear interpolation instead).
 */
export function findDepthPointsInRadius(
  points: readonly DepthPoint[],
  aimedX: number,
  aimedY: number,
  maxDist: number
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
 * Step 2 Helper: Compute edge confidence penalty based on local depth variance.
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
  maxAllowedDepthStdDevM: number
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
 * Step 4 Helper: Quartic confidence weight matching active sensor noise laws.
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
- returns a quadratic gradient factor: `1 − (σ/σ_max)²` for standard deviations between 0 and the max limit
- quadratic: gentle for small variance (natural surface undulation), hard drop near threshold (genuine edges)

#### `sampleDepthPrior` (integration)
- null for null sample
- null for undefined sample
- null when `projectionMatrix` absent
- null when bilinear depth interpolation returns non-finite or ≤ 0
- null when no depth point within `maxScreenDist` of aimed pixel (edge check needs neighbours)
- null if edge penalty drops to 0 due to high standard deviation
- valid observation for flat-grid crosshair at 2 m: weight=0.5 (quartic knee), correct world-space point
- weight is close to 1.0 for very near depth in flat neighbourhood
- weight collapses to near 0 for far target
- uses bilinear interpolation (via createDepthGridLookup) not nearest-point snapping
- unprojection delegates to framework's createDepthUnprojector (top-left origin Y-flip handled correctly)

#### Unprojection / camera-to-world (NOT tested in this module)
These are covered by the framework's own test suites:
- `depth-unprojection.test.ts` — NDC convention, Y-flip, inverse-projection, degenerate guards
- `qr-size-depth-context.test.ts` — bilinear grid lookup, unprojector composition
This module tests only the composition (does `sampleDepthPrior` produce the right world-space point for a known identity-pose scenario?).

### REPLAY DETERMINISM

`sampleDepthPrior` is a **pure function** of its inputs (no RNG, no global state, no time-dependence). The caller attaches the resulting `DepthPriorObservation | null` to the `addMeasurementRay` action payload. On replay:

- The action log replays `addMeasurementRay` with the **already-computed** observation embedded in the payload. The depth-prior provider is NOT re-invoked during replay — the observation was computed once at shoot-time and serialized.
- This means the replayed measurement point is **bit-identical** to the live result, regardless of whether the depth sample is re-dispatched in the correct order or at all.
- The alternative (re-invoking `sampleDepthPrior` from the replayed `latestDepthSample`) would also be deterministic IF the store replays depth samples in order, but it would couple replay correctness to depth-sample ordering — an unnecessary fragility.

### DEMO

The Component 2 demo should show:
1. **Near target** (~1–2 m): aim at a nearby object, print the returned `DepthPriorObservation` — `depthM`, `weight` (should be ~0.5 at 2 m), and `point` as world-space coordinates.
2. **Far target** (~5–10 m): aim at a distant object, show the weight collapsing toward 0.
3. **Edge case**: aim at a depth discontinuity (e.g., the edge of a table against the floor), show the edge penalty zeroing the weight → `null` return.

This can be integrated into the Component 1 demo harness (the ray-triangulation demo) by adding a depth-prior overlay that displays the observation alongside the ray visualization. In replay mode on desktop, the demo reads depth samples from a recorded session.

### INTEGRATION NOTE

#### Component 1 status
The ray-triangulation core (Component 1) has not been integrated into the recorder yet — the standalone `ray-triangulation-demo.html` is a prototype. This means the `DepthPriorObservation` interface defined here establishes the **contract** that Component 1 will need to accept when it is generalized to carry depth priors. The `point` + `weight` shape is designed to slot directly into the closest-point-of-approach solver as a weighted soft prior.

The caller (e.g. a future `measurement-point-handlers.ts` mirroring `ref-point-handlers.ts`) will:
1. Ensure screen tap or aiming inputs (`screenX`, `screenY`) are corrected for aspect-ratio differences between the camera frustum and viewport *before* calling `sampleDepthPrior`. These must be in the normalised camera-texture coordinate frame $[0,1]$ with **top-left origin** (matching `getDepthInMeters` and the depth sampler's output convention).
2. Read `state.recording.latestDepthSample` (the full `DepthSample` object, not a subset) from the store at shoot-time.
3. Pass the `DepthSample` + the aimed pixel into `sampleDepthPrior`.
4. Attach the `DepthPriorObservation | null` to the `addMeasurementRay` Redux action payload (serialized for replay determinism — see above).
5. The triangulation solver (Components 1 & 3) folds `observation.point` and `observation.weight`
   as the depth soft prior — trusted up close and on flat geometry, fading smoothly to zero at occlusion boundaries.
