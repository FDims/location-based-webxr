### DESCRIPTION
The closest-point-of-approach solver: given N weighted rays in one frame, compute the best-fit point and a meaningful uncertainty / convergence metric.

### USE CASE
1. Triangulating points from multiple rays and calculate the closest-point-of-approach to determine the final point.

### GOALS
1. Able to calculate the closest-point-of-approach of N rays.
2. Able to calculate the uncertainty / convergence metric of the final point.
3. Able to fuse depth information with the ray triangulation.

### DESIGN DECISIONS

#### Direction normalization
`M = I − d·dᵀ` is only the correct perpendicular-projector when `|d| = 1`. Rather
than requiring callers to pre-normalize (a silent correctness hazard), the solver
defensively normalizes every direction internally. If a zero-length direction is
supplied the observation is skipped (weight treated as 0).

#### Depth prior formulation — along-ray only
A depth-map sample gives reliable information *along* the ray (range) but tells us
nothing about transverse position. The correct term is therefore the along-ray
projector `d·dᵀ`, not the isotropic identity `I`:

```
A += w · d·dᵀ          (constrains along-ray position)
B += w · (d·dᵀ) · p    (i.e., w · (d·p) · d)
```

This is the exact complement of the ray term (`I − d·dᵀ`), so ray and depth
contributions are always orthogonal — they cannot fight each other. An isotropic
prior (`w·I`) would drag the solved point off the ray when the depth point has any
floating-point off-ray error, which it always does in practice.

### TEST
Unit-test against known geometry:
 - two exactly intersecting perpendicular rays return the intersection with ~zero error
 - skew rays return the midpoint of the shortest connecting segment, rmsError = 0.5 m
 - weights bias the result towards the heavier ray
 - a zero-weight ray is fully ignored
 - single ray with strong depth prior returns approximately the depth point
 - strong triangulation baseline out-votes weak depth priors
 - near-parallel rays (tiny baseline) produce higher uncertainty than wide-baseline rays
 - un-normalized input directions are silently handled (normalization inside solver)

### IMPLEMENTATION
 1. Implement the closest-point-of-approach solver in a new file `src/utils/ray-triangulation-core.ts`

 ```typescript
 /**
  * Represents a lightweight 3D Vector to avoid Three.js dependencies.
  */
 export interface Vec3 {
   x: number;
   y: number;
   z: number;
 }

 /**
  * Represents a 3D Ray shot by the user.
  */
 export interface Ray {
   origin: Vec3;
   /**
    * The aimed direction. Need not be pre-normalized — the solver
    * normalizes every direction internally before use.
    */
   direction: Vec3;
 }

 /**
  * An Observation represents a single "measurement shot" taken by the user.
  * It always contains a ray, and may optionally contain a depth reading.
  * We group them together so that outlier-rejection algorithms (like RANSAC)
  * can reject a bad shot (both ray and depth) entirely.
  */
 export interface Observation {
   ray: Ray;

   /**
    * How much we trust the ray direction.
    * Typically 1.0. Lower it if the device tracking was unstable.
    */
   rayWeight: number;

   /** Optional 3D point derived from the depth map along this ray. */
   depthPoint?: Vec3;

   /**
    * How much we trust the depth reading.
    * Should decay with distance (e.g., high for 1 m away, near 0 for 50 m away).
    */
   depthWeight?: number;
 }

 /**
  * The computed result of triangulating multiple observations.
  */
 export interface TriangulationResult {
   /** The final computed best-fit point */
   point: Vec3;

   /**
    * Convergence confidence metric — the trace of the covariance matrix (A⁻¹).
    * High values mean the rays were nearly parallel (small baseline) and the
    * user needs to move sideways. Drives the "move sideways" coaching prompt.
    */
   uncertainty: number;

   /**
    * Root Mean Square Error — the average orthogonal distance (in metres)
    * from the computed point to each ray. Measures how tightly the rays
    * intersect at the solved point.
    */
   rmsError: number;
 }

 /**
  * Computes the point that minimises the weighted sum of squared distances
  * to all provided rays and depth points.
  *
  * Uses a Linear Least Squares approach. It handles any number of rays (N >= 1)
  * by accumulating their constraints into a single 3×3 matrix.
  *
  * ### Ray term
  * For each ray with (normalized) direction d and origin o:
  *   A += w · (I − d·dᵀ)        B += w · (I − d·dᵀ) · o
  *
  * ### Depth prior term (along-ray only)
  * A depth sample is reliable along the ray but unknown transversely:
  *   A += w · (d·dᵀ)             B += w · (d·dᵀ) · p
  * This is the exact orthogonal complement of the ray term.
  *
  * @param observations - An array of 1 to N observations.
  * @returns TriangulationResult or null if the math is uninvertible
  *          (e.g., 1 ray with no depth prior, or all zero-weight observations).
  */
 export function solveClosestPointOfApproach(
   observations: Observation[],
 ): TriangulationResult | null {
   if (observations.length === 0) return null;

   // A (3×3, stored row-major) and B (3×1): the normal equation A·p = B
   const A: [number, number, number, number, number, number, number, number, number] =
     [0, 0, 0, 0, 0, 0, 0, 0, 0];
   const B: [number, number, number] = [0, 0, 0];

   for (const obs of observations) {
     // --- Normalize direction defensively ---
     const rawLen = Math.sqrt(
       obs.ray.direction.x ** 2 +
       obs.ray.direction.y ** 2 +
       obs.ray.direction.z ** 2,
     );
     if (rawLen < 1e-10) continue; // zero-length direction — skip this observation
     const dx = obs.ray.direction.x / rawLen;
     const dy = obs.ray.direction.y / rawLen;
     const dz = obs.ray.direction.z / rawLen;

     // --- Ray contribution ---
     // M = I − d·dᵀ  (projects out the component along the ray direction)
     // Accumulate: A += w·M,  B += w·M·o
     if (obs.rayWeight > 0) {
       const { x: ox, y: oy, z: oz } = obs.ray.origin;
       const w = obs.rayWeight;

       const M: [number, number, number, number, number, number, number, number, number] = [
         1 - dx * dx, -dx * dy, -dx * dz,
         -dy * dx, 1 - dy * dy, -dy * dz,
         -dz * dx, -dz * dy, 1 - dz * dz,
       ];

       A[0] += M[0] * w;
       A[1] += M[1] * w;
       A[2] += M[2] * w;
       A[3] += M[3] * w;
       A[4] += M[4] * w;
       A[5] += M[5] * w;
       A[6] += M[6] * w;
       A[7] += M[7] * w;
       A[8] += M[8] * w;

       B[0] += (M[0] * ox + M[1] * oy + M[2] * oz) * w;
       B[1] += (M[3] * ox + M[4] * oy + M[5] * oz) * w;
       B[2] += (M[6] * ox + M[7] * oy + M[8] * oz) * w;
     }

     // --- Depth point contribution (along-ray prior) ---
     // D = d·dᵀ  (projects onto the ray direction — orthogonal complement of M)
     // This constrains the along-ray position only, matching depth-sensor uncertainty.
     // Accumulate: A += w·D,  B += w·D·p_depth
     if (obs.depthPoint && obs.depthWeight != null && obs.depthWeight > 0) {
       const { x: px, y: py, z: pz } = obs.depthPoint;
       const w = obs.depthWeight;
       // D = d·dᵀ (outer product)
       A[0] += dx * dx * w;
       A[1] += dx * dy * w;
       A[2] += dx * dz * w;
       A[3] += dy * dx * w;
       A[4] += dy * dy * w;
       A[5] += dy * dz * w;
       A[6] += dz * dx * w;
       A[7] += dz * dy * w;
       A[8] += dz * dz * w;
       // D·p = (d·p)·d
       const dDotP = dx * px + dy * py + dz * pz;
       B[0] += dx * dDotP * w;
       B[1] += dy * dDotP * w;
       B[2] += dz * dDotP * w;
     }
   }

   // Solve: p = A⁻¹ · B
   const A_inv = invertMatrix3x3(A);
   if (!A_inv) return null; // Singular — e.g., one ray with no depth prior

   const P: Vec3 = {
     x: A_inv[0] * B[0] + A_inv[1] * B[1] + A_inv[2] * B[2],
     y: A_inv[3] * B[0] + A_inv[4] * B[1] + A_inv[5] * B[2],
     z: A_inv[6] * B[0] + A_inv[7] * B[1] + A_inv[8] * B[2],
   };

   // Calculate rmsError (physical perpendicular distance from point to each ray)
   // Uses the cross-product identity: ||(P - o) × d̂|| = perpendicular distance
   let sumSq = 0;
   let validRays = 0;
   for (const obs of observations) {
     if (obs.rayWeight <= 0) continue;
     const rawLen2 = Math.sqrt(
       obs.ray.direction.x ** 2 + obs.ray.direction.y ** 2 + obs.ray.direction.z ** 2,
     );
     if (rawLen2 < 1e-10) continue;
     const dx2 = obs.ray.direction.x / rawLen2;
     const dy2 = obs.ray.direction.y / rawLen2;
     const dz2 = obs.ray.direction.z / rawLen2;
     const { x: ox, y: oy, z: oz } = obs.ray.origin;
     const pox = P.x - ox;
     const poy = P.y - oy;
     const poz = P.z - oz;
     const cx = poy * dz2 - poz * dy2;
     const cy = poz * dx2 - pox * dz2;
     const cz = pox * dy2 - poy * dx2;
     sumSq += cx * cx + cy * cy + cz * cz;
     validRays++;
   }
   const rmsError = validRays > 0 ? Math.sqrt(sumSq / validRays) : 0;

   // Uncertainty = trace of the covariance matrix A⁻¹
   // Small trace → rays converge tightly → confident result.
   // Large trace → rays nearly parallel (small baseline) → user needs to move sideways.
   const uncertainty = A_inv[0] + A_inv[4] + A_inv[8];

   return { point: P, uncertainty, rmsError };
 }

 function invertMatrix3x3(
   m: [number, number, number, number, number, number, number, number, number],
 ): [number, number, number, number, number, number, number, number, number] | null {
   const det =
     m[0] * (m[4] * m[8] - m[5] * m[7]) -
     m[1] * (m[3] * m[8] - m[5] * m[6]) +
     m[2] * (m[3] * m[7] - m[4] * m[6]);
   if (Math.abs(det) < 1e-8) return null;
   const inv = 1.0 / det;
   return [
     (m[4] * m[8] - m[7] * m[5]) * inv,
     (m[2] * m[7] - m[1] * m[8]) * inv,
     (m[1] * m[5] - m[2] * m[4]) * inv,
     (m[5] * m[6] - m[3] * m[8]) * inv,
     (m[0] * m[8] - m[2] * m[6]) * inv,
     (m[3] * m[2] - m[0] * m[5]) * inv,
     (m[3] * m[7] - m[6] * m[4]) * inv,
     (m[6] * m[1] - m[0] * m[7]) * inv,
     (m[0] * m[4] - m[3] * m[1]) * inv,
   ];
 }
 ```

 2. Unit Tests

 ```typescript
 import { describe, expect, test } from 'vitest';
 import { solveClosestPointOfApproach, type Observation } from './ray-triangulation-core';

 const INV_SQRT2 = 1 / Math.sqrt(2);

 describe('solveClosestPointOfApproach', () => {

   // ── Edge cases ────────────────────────────────────────────────────────────

   test('returns null for empty observation array', () => {
     expect(solveClosestPointOfApproach([])).toBeNull();
   });

   test('returns null for a single ray with no depth prior (under-determined)', () => {
     const obs: Observation[] = [
       { ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 1 },
     ];
     expect(solveClosestPointOfApproach(obs)).toBeNull();
   });

   // ── Two-ray intersection ──────────────────────────────────────────────────

   test('two exactly intersecting perpendicular rays return the intersection with ~zero rmsError', () => {
     // Ray 1 travels along +X from (-1, 0, 0).
     // Ray 2 travels along +Y from ( 0,-1, 0).
     // They meet at the origin (0, 0, 0).
     const obs: Observation[] = [
       { ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 1 },
       { ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1 },
     ];
     const result = solveClosestPointOfApproach(obs);
     expect(result).not.toBeNull();
     expect(result!.point.x).toBeCloseTo(0, 5);
     expect(result!.point.y).toBeCloseTo(0, 5);
     expect(result!.point.z).toBeCloseTo(0, 5);
     expect(result!.rmsError).toBeCloseTo(0, 5);
   });

   test('skew rays return the midpoint of the shortest connecting segment, rmsError = 0.5 m', () => {
     // Ray 1: along +X at z=0  → closest point on ray: (0, 0, 0)
     // Ray 2: along +Y at z=1  → closest point on ray: (0, 0, 1)
     // Midpoint is (0, 0, 0.5). Perpendicular distance from midpoint to each ray = 0.5 m.
     const obs: Observation[] = [
       { ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 1 },
       { ray: { origin: { x: 0, y: 0, z: 1 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1 },
     ];
     const result = solveClosestPointOfApproach(obs);
     expect(result).not.toBeNull();
     expect(result!.point.x).toBeCloseTo(0, 5);
     expect(result!.point.y).toBeCloseTo(0, 5);
     expect(result!.point.z).toBeCloseTo(0.5, 5);
     expect(result!.rmsError).toBeCloseTo(0.5, 5);
   });

   // ── Weights ────────────────────────────────────────────────────────────────

   test('weights bias the result towards the heavier ray', () => {
     // Ray 1 (z=0 plane) has weight 9; Ray 2 (z=1) has weight 1.
     // Weighted result should be pulled well below z=0.5.
     const obs: Observation[] = [
       { ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 9 },
       { ray: { origin: { x: 0, y: 0, z: 1 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1 },
     ];
     const result = solveClosestPointOfApproach(obs);
     expect(result).not.toBeNull();
     expect(result!.point.z).toBeLessThan(0.5);
   });

   test('a zero-weight ray is fully ignored', () => {
     // The zero-weight ray points in a completely wrong direction.
     // Result should still converge to the intersection of the two valid rays at origin.
     const obs: Observation[] = [
       { ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 1 },
       { ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1 },
       { ray: { origin: { x: 5, y: 5, z: 5 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 0 },
     ];
     const result = solveClosestPointOfApproach(obs);
     expect(result).not.toBeNull();
     expect(result!.point.x).toBeCloseTo(0, 5);
     expect(result!.point.y).toBeCloseTo(0, 5);
     expect(result!.point.z).toBeCloseTo(0, 5);
   });

   // ── Depth prior ────────────────────────────────────────────────────────────

   test('single ray with a strong depth prior returns approximately the depth point', () => {
     // With only 1 ray, the geometry is under-determined without depth.
     // A strong along-ray depth prior pins the answer on the ray at the given distance.
     const obs: Observation[] = [
       {
         ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
         rayWeight: 1,
         depthPoint: { x: 5, y: 0, z: 0 },
         depthWeight: 10,
       },
     ];
     const result = solveClosestPointOfApproach(obs);
     expect(result).not.toBeNull();
     expect(result!.point.x).toBeCloseTo(5, 2);
     expect(result!.point.y).toBeCloseTo(0, 2);
     expect(result!.point.z).toBeCloseTo(0, 2);
   });

   test('strong triangulation baseline out-votes weak depth priors', () => {
     // Three rays converge at the origin (0, 0, 0) — directions are normalized.
     // Each carries a weak depth prior pointing toward z=1 — deliberately wrong.
     // The triangulation should win and pull the result near origin.
     const obs: Observation[] = [
       {
         ray: { origin: { x: -1, y: 1, z: 0 }, direction: { x: INV_SQRT2, y: -INV_SQRT2, z: 0 } },
         rayWeight: 1,
         depthPoint: { x: 0, y: 0, z: 1 },
         depthWeight: 0.1,
       },
       {
         ray: { origin: { x: 1, y: 1, z: 0 }, direction: { x: -INV_SQRT2, y: -INV_SQRT2, z: 0 } },
         rayWeight: 1,
         depthPoint: { x: 0, y: 0, z: 1 },
         depthWeight: 0.1,
       },
       {
         ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
         rayWeight: 1,
         depthPoint: { x: 0, y: 0, z: 1 },
         depthWeight: 0.1,
       },
     ];
     const result = solveClosestPointOfApproach(obs);
     expect(result).not.toBeNull();
     expect(result!.point.z).toBeLessThan(0.5); // Should be much closer to 0 than to 1
   });

   // ── Uncertainty metric ─────────────────────────────────────────────────────

   test('adding more consistent rays lowers the uncertainty', () => {
     const twoRays: Observation[] = [
       { ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 1 },
       { ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1 },
     ];
     const threeRays: Observation[] = [
       ...twoRays,
       { ray: { origin: { x: 0, y: 0, z: -1 }, direction: { x: 0, y: 0, z: 1 } }, rayWeight: 1 },
     ];
     const r2 = solveClosestPointOfApproach(twoRays)!;
     const r3 = solveClosestPointOfApproach(threeRays)!;
     expect(r3.uncertainty).toBeLessThan(r2.uncertainty);
   });

   test('near-parallel rays (tiny baseline) produce higher uncertainty than wide-baseline rays', () => {
     // Wide-baseline: rays 1 m apart laterally, aiming at the same target.
     const wideBaseline: Observation[] = [
       { ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 1 },
       { ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1 },
     ];
     // Near-parallel: both rays originate just 1 mm apart, nearly the same direction.
     const narrowBaseline: Observation[] = [
       { ray: { origin: { x: -0.001, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 1 },
       { ray: { origin: { x:  0.001, y: 0, z: 0 }, direction: { x: 1, y: 0.001, z: 0 } }, rayWeight: 1 },
     ];
     const rWide = solveClosestPointOfApproach(wideBaseline)!;
     const rNarrow = solveClosestPointOfApproach(narrowBaseline)!;
     expect(rNarrow.uncertainty).toBeGreaterThan(rWide.uncertainty);
   });

   // ── Normalization robustness ───────────────────────────────────────────────

   test('un-normalized input directions produce the same result as pre-normalized ones', () => {
     // Exact same geometry as the intersecting-perpendicular test but with direction
     // vectors scaled by 2 — solver must normalize internally and get the same answer.
     const unnormalized: Observation[] = [
       { ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 2, y: 0, z: 0 } }, rayWeight: 1 },
       { ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 2, z: 0 } }, rayWeight: 1 },
     ];
     const result = solveClosestPointOfApproach(unnormalized);
     expect(result).not.toBeNull();
     expect(result!.point.x).toBeCloseTo(0, 5);
     expect(result!.point.y).toBeCloseTo(0, 5);
     expect(result!.point.z).toBeCloseTo(0, 5);
     expect(result!.rmsError).toBeCloseTo(0, 5);
   });
 });
 ```