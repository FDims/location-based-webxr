### DESCRIPTION
Combining the ray triangulation and depth prior provider into one estimation number: depth as a distance-weighted soft prior strong up close, fading with range, and progressively out-voted by triangulation as the baseline grows with mandated robust outlier rejection. The single-ray-plus-depth case (a candidate first iteration) should fall out of this as the degenerate case. 

To address the challenges of AR tracking and varying ranges, the robust estimation uses MSAC (M-Estimator Sample Consensus) with range-adaptive thresholds, dual-mode hypothesis generation, and baseline gatekeeping to guarantee bulletproof points.

### GOALS
- Combine the result of the two methods (triangulation and depth prior provider) to get the best estimation of the 3D point.
- Create MeasurementPoint entity to be persisted.
- Robust estimation: Outliers must be rejected gracefully without breaking at extreme ranges.

### USE CASES
- Estimation of the aimed point location for points that cannot be physically reached (short range and long range).

### DESIGN DECISIONS

#### Unified vector type — use the framework's `Vector3` everywhere
The framework defines `Vector3 = readonly [number, number, number]` (a tuple).
`ray-triangulation-core.ts` currently defines a local `Vec3` as `{x, y, z}` (an object).
These are incompatible. Instead of writing adapter functions, **refactor both
`ray-triangulation-core.ts` and `depth-prior-provider.ts` to use the framework's
`Vector3` tuple directly.**

#### Decoupled MSAC Scoring (Weights vs. Thresholds)
If MSAC scoring simply compares a `weight × distanceError` against a static threshold, terrible observations with low weights (e.g. decayed AR tracking or distant depth priors) will artificially appear to have low errors and be falsely classified as inliers.
Therefore, the MSAC logic must decouple pure geometry from confidence scoring:
- **Inlier Classification:** Pure geometric distance. `rayDistance < threshold` AND `depthDistance < threshold`.
- **MSAC Score:** `Σ ( rayWeight × min(rayDistance², thresh²) + depthWeight × min(depthDistance², thresh²) )`.
This ensures bad observations are rejected, while maintaining a smooth optimization landscape.

#### Strategy B Degeneracy Prevention
When Strategy B (pure triangulation hypothesis) randomly selects two rays, they might originate from almost the exact same location (nearly parallel). Intersecting nearly parallel rays produces volatile, wildly inaccurate hypothesis points (often behind the camera).
To prevent wasting iterations and poisoning the MSAC loop, the generator must check the angle (or cross-product magnitude) between the two selected rays. If the angle is too small (e.g., < 1 degree), it must discard the pair instantly and pick another.

#### Tri-state Baseline Gatekeeping
Blocking the user from saving a point if the baseline is insufficient breaks the "short-range tap-to-measure" use case (which has a baseline of 0). The `hasSufficientBaseline` flag drives a tri-state UI warning system, not a hard blocker:
- **Green (Good):** `hasSufficientBaseline == true`. Safe to save.
- **Yellow (Warning):** `hasSufficientBaseline == false` AND `depthWeight > threshold`. Safe to save, but relying entirely on the depth sensor.
- **Red (Blocker):** `hasSufficientBaseline == false` AND `depthWeight == 0`. Block save. Pure triangulation requires parallax.

#### Coordinate Frame Alignment
`ray-triangulation-core.ts` assumes all inputs are in a single, rigid coordinate frame. The recorder's "AR-local" frame is the required space. During integration, `sampleDepthPrior` must be fed the `arPose` (AR-local), ensuring the resulting `DepthPriorObservation` perfectly aligns with `rayOrigin` and `rayDirection` before entering the solver. GPS-world conversion happens *after* triangulation.

#### Export reusable computations — no duplication
Any computation already implemented in `ray-triangulation-core.ts` or `depth-prior-provider.ts` must be exported and reused. Specifically, `ray-triangulation-core.ts` must export `perpendicularDistanceToRay`.

#### Along-ray depth error metric
The solver constrains depth along the ray only (the `d·dᵀ` projector). The MSAC scoring function must use the same convention: depth error = `|dot(P − depthPoint, d)|` (the along-ray component), NOT the full Euclidean distance.

#### Seeded PRNG for replay determinism
Using `Math.random()` breaks replay guarantees. The solver must use a deterministic seeded PRNG (e.g., xorshift32).

#### Early-exit for trivial observation counts
- **1 observation with depth:** Call `solveClosestPointOfApproach` directly. `hasSufficientBaseline = false`.
- **2 observations:** Solve directly. Compute baseline, no MSAC needed.
- **≥ 3 observations:** Run full MSAC.

### ARCHITECTURE
- **The estimator interface**: A pure function from a set of observations (`Vector3`) to a result, all in one consistent AR-local coordinate frame and with no Three.js, no DOM, no WebXR. 
- **Dual-Mode Hypothesis Generation (MSAC)**: To handle both short-range depth and long-range parallax, generating hypotheses using two distinct strategies: Strategy A picks exactly 1 ray with a strong depth prior, and Strategy B picks exactly 2 well-angled rays for pure triangulation.
- **Range-Adaptive Threshold & Decoupled MSAC Scoring**: Employs a continuous MSAC scoring function scaling the acceptable distance threshold linearly with range.
- **The MeasurementPoint entity**: Modeled on the recorder's existing RefPointDefinition / RefPointObservation. Stores inlier/outlier provenance per-observation.
- **The Redux action model**: Mirror the Phase 1 shape on top of the recorder's existing store.

### INTERFACES

```typescript
import type { Vector3 } from 'gps-plus-slam-app-framework/core';

// ── Refactored types in ray-triangulation-core.ts ──────────────────────────

export interface Ray {
  origin: Vector3;
  direction: Vector3;
}

export interface Observation {
  ray: Ray;
  rayWeight: number;
  depthPoint?: Vector3;
  depthWeight?: number;
}

export interface TriangulationResult {
  point: Vector3;
  uncertainty: number;
  rmsError: number;
}

// ── Types for the fusion module (robust-triangulation.ts) ──────────────────

export interface MeasurementRayObservation {
  id: string;
  timestamp: number;
  rayOrigin: Vector3;
  rayDirection: Vector3;
  rayWeight: number;
  depthPoint?: Vector3;
  depthWeight?: number;
}

export interface MeasurementPointEntity {
  id: string;
  createdAt: number;
  updatedAt: number;
  observations: MeasurementRayObservation[];
  inlierIds: string[];
  outlierIds: string[];
  arPosition: Vector3;
  gpsPosition: Vector3;
  uncertainty: number;
  rmsError: number;
}

export interface RobustTriangulationResult {
  point: Vector3;
  uncertainty: number;
  rmsError: number;
  msacScore: number;
  inlierIds: string[];
  outlierIds: string[];
  hasSufficientBaseline: boolean;
}

export interface RobustTriangulationOptions {
  baseDistanceThreshold?: number;
  angularThresholdRadians?: number;
  iterations?: number;
  seed?: number;
  minBaselineM?: number;
}
```

### FUNCTIONS

#### Modifications to `ray-triangulation-core.ts`

```typescript
// Replace all local Vec3 {x,y,z} with Vector3 = readonly [number, number, number]
// from 'gps-plus-slam-app-framework/core'.

/**
 * Compute the perpendicular distance from a point P to a ray.
 * Extracted from computeRMSError for standalone MSAC scoring.
 */
export function perpendicularDistanceToRay(
  point: Vector3,
  rayOrigin: Vector3,
  rayDirection: Vector3
): number;
```

#### New functions in `robust-triangulation.ts`

```typescript
import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import { solveClosestPointOfApproach, perpendicularDistanceToRay, type Observation } from './ray-triangulation-core';

/**
 * Calculates pure geometric error and weighted MSAC score for an observation.
 * @returns { isInlier: boolean, msacScore: number }
 */
export function evaluateObservation(
  point: Vector3,
  obs: Observation,
  threshold: number
): { isInlier: boolean; msacScore: number };

export function computeAdaptiveThreshold(
  hypothesisPoint: Vector3,
  cameraOrigins: Vector3[],
  baseTolerance: number,
  angularThresholdRadians: number
): number;

/**
 * Main robust estimation function using MSAC.
 */
export function solveRobustTriangulation(
  observations: MeasurementRayObservation[],
  options?: RobustTriangulationOptions
): RobustTriangulationResult | null;

export function createSeededRng(seed: number): () => number;
```

### INTEGRATION

1. **Mapping Redux State to Triangulation Inputs:**
   When called by the UI, `MeasurementRayObservation` objects are converted into the `Observation` format. Both use `Vector3` tuples, requiring no type conversion.
   
2. **Depth Prior Integration (AR-Local Frame):**
   At the moment a ray is recorded, `sampleDepthPrior` is called using the `arPose` (AR-local coordinates) to ensure the `DepthPriorObservation` perfectly aligns with the AR-local `rayOrigin` and `rayDirection`.
   
3. **Robust Solving:**
   `solveRobustTriangulation` repeatedly selects subsets (avoiding degenerate parallel pairs) to pass to `solveClosestPointOfApproach`. It evaluates hypotheses using `evaluateObservation` and returns the optimal result. The UI uses `hasSufficientBaseline` and the presence of depth priors to drive the Green/Yellow/Red warning state.

### IMPLEMENTATION
- Refactor `ray-triangulation-core.ts` to use `Vector3`. Update all `v[0]/v[1]/v[2]` access. Export `perpendicularDistanceToRay`.
- Create `src/utils/robust-triangulation.ts` implementing the MSAC loop, decoupled scoring, and early exits.
- Create MeasurementPoint entity. Decide whether these live in `refPoints/` or a sibling `measurementPoints/` directory.
- Update Redux store to support `addMeasurementRay` and the tri-state persistence flow.
- Convert final AR-local point to GPS-world space via alignment matrix.

### TEST
Unit-test on synthetic scenes with a known answer. Determinism required — seed any sampling.

File: `src/utils/robust-triangulation.test.ts`
- Tests for `perpendicularDistanceToRay`, `evaluateObservation`, `computeAdaptiveThreshold`, `createSeededRng`.
- **solveRobustTriangulation**: 
  - Degenerate pair avoidance (Strategy B discards parallel rays).
  - Tri-state baseline output matches geometry.
  - Decoupled scoring rejects low-weight garbage correctly.
  - Range-adaptive threshold validates angular misses.

### DEMO
`robust-triangulation-demo.html` — a standalone page visualising MSAC fusion.
- Scrub from 1 → N rays.
- Live outlier injection testing.
- Tri-state warning banner (Green/Yellow/Red) based on baseline and depth priors.
- Determinism indicator hash.