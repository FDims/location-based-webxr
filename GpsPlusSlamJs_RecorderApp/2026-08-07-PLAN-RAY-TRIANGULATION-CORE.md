### DESCRIPTION
The closest-point-of-approach solver: given N weighted rays in one frame, compute the best-fit point and a meaningful uncertainty / convergence metric.

### USE CASE
1. Triangulating points from multiple rays and calculate the closest-point-of-approach to determine the final point.

### GOALS
1. Able to calculate the closest-point-of-approach of N rays.
2. Able to calculate the uncertainty / convergence metric of the final point.
3. Able to fuse depth information with the ray triangulation.

### TEST
 unit-test against known geometry 
 - two exactly intersecting perpendicular rays return the intersection with ~zero error
 - skew rays return the midpoint of the shortest connecting segment
 - weights bias the result towards the heavier ray
 - single ray with strong depth prior returns the depth point
 - strong triangulation baseline out-votes weak depth priors

 ### IMPLEMENTATION
 1. Implement the closest-point-of-approach solver in a new file src/utils/ray-triangulation-core.ts

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
   /** Must be a normalized unit vector */
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
    * Should decay with distance (e.g., high for 1m away, near 0 for 50m away).
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
    * A metric indicating how confident we are in the position.
    * Uses the trace of the covariance matrix. High values mean the rays
    * were nearly parallel (small baseline) and the user needs to move sideways.
    */
   uncertainty: number; 
   
   /** 
    * The Root Mean Square error (average orthogonal distance from the computed
    * point to the rays). Measures how tightly the rays intersect.
    */
   rmsError: number;    
 }

 /**
  * Computes the point that minimizes the weighted sum of squared distances 
  * to all provided rays and depth points.
  * 
  * Uses a Linear Least Squares approach. It handles any number of rays (N >= 1)
  * by accumulating their constraints into a single 3x3 matrix.
  * 
  * @param observations - An array of 1 to N observations. 
  * @returns TriangulationResult or null if the math is uninvertible (e.g., 1 ray and no depth prior).
  */
 export function solveClosestPointOfApproach(observations: Observation[]): TriangulationResult | null {
   if (observations.length === 0) return null;

   let A = [0,0,0, 0,0,0, 0,0,0];
   let B = [0, 0, 0];

   for (const obs of observations) {
     // 1. Ray contribution
     if (obs.rayWeight > 0) {
       const o = obs.ray.origin;
       const d = obs.ray.direction;
       const w = obs.rayWeight;
       
       const M = [
         1 - d.x*d.x,   -d.x*d.y,     -d.x*d.z,
         -d.y*d.x,   1 - d.y*d.y,    -d.y*d.z,
         -d.z*d.x,    -d.z*d.y,    1 - d.z*d.z
       ];

       for (let i = 0; i < 9; i++) A[i] += M[i] * w;

       B[0] += (M[0]*o.x + M[1]*o.y + M[2]*o.z) * w;
       B[1] += (M[3]*o.x + M[4]*o.y + M[5]*o.z) * w;
       B[2] += (M[6]*o.x + M[7]*o.y + M[8]*o.z) * w;
     }

     // 2. Depth point contribution (Prior)
     if (obs.depthPoint && obs.depthWeight !== undefined && obs.depthWeight > 0) {
       const p = obs.depthPoint;
       const w = obs.depthWeight;
       
       A[0] += w; A[4] += w; A[8] += w; // Add weight to diagonal (Identity matrix)
       
       B[0] += p.x * w;
       B[1] += p.y * w;
       B[2] += p.z * w;
     }
   }

   const A_inv = invertMatrix3x3(A);
   if (!A_inv) return null; // e.g., parallel rays with no depth prior

   const P = {
       x: A_inv[0]*B[0] + A_inv[1]*B[1] + A_inv[2]*B[2],
       y: A_inv[3]*B[0] + A_inv[4]*B[1] + A_inv[5]*B[2],
       z: A_inv[6]*B[0] + A_inv[7]*B[1] + A_inv[8]*B[2]
   };

   // Calculate rmsError (physical distance to rays)
   let sumSq = 0;
   let validRays = 0;
   for (const obs of observations) {
       if (obs.rayWeight <= 0) continue;
       const o = obs.ray.origin;
       const d = obs.ray.direction;
       const po = { x: P.x - o.x, y: P.y - o.y, z: P.z - o.z };
       
       const cross = [
           po.y * d.z - po.z * d.y,
           po.z * d.x - po.x * d.z,
           po.x * d.y - po.y * d.x
       ];
       sumSq += (cross[0]**2 + cross[1]**2 + cross[2]**2);
       validRays++;
   }
   const rmsError = validRays > 0 ? Math.sqrt(sumSq / validRays) : 0;

   // Calculate convergence/uncertainty (trace of the inverse matrix)
   const traceAInv = A_inv[0] + A_inv[4] + A_inv[8];

   return { point: P, uncertainty: traceAInv, rmsError };
 }

 function invertMatrix3x3(m: number[]): number[] | null {
    const det = m[0]*(m[4]*m[8]-m[5]*m[7]) - m[1]*(m[3]*m[8]-m[5]*m[6]) + m[2]*(m[3]*m[7]-m[4]*m[6]);
    if (Math.abs(det) < 1e-8) return null;
    const inv = 1.0 / det;
    return [
        (m[4]*m[8] - m[7]*m[5])*inv, (m[2]*m[7] - m[1]*m[8])*inv, (m[1]*m[5] - m[2]*m[4])*inv,
        (m[5]*m[6] - m[3]*m[8])*inv, (m[0]*m[8] - m[2]*m[6])*inv, (m[3]*m[2] - m[0]*m[5])*inv,
        (m[3]*m[7] - m[6]*m[4])*inv, (m[6]*m[1] - m[0]*m[7])*inv, (m[0]*m[4] - m[3]*m[1])*inv
    ];
 }
 ```

 2. Unit Test
 ```typescript
  test('two exactly intersecting perpendicular rays return the intersection with ~zero error', () => {
    // Ray 1: along X axis. Ray 2: along Y axis. Intersect at origin.
    const obs: Observation[] = [
      { ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 1 },
      { ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1 },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result.point.x).toBeCloseTo(0);
    expect(result.point.y).toBeCloseTo(0);
    expect(result.point.z).toBeCloseTo(0);
    expect(result.uncertainty).toBeCloseTo(0); // or a very low value depending on metric
  });

  test('skew rays return the midpoint of the shortest connecting segment', () => {
    // Ray 1: along X axis at z=0. Ray 2: along Y axis at z=1.
    const obs: Observation[] = [
      { ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 1 },
      { ray: { origin: { x: 0, y: 0, z: 1 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1 },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result.point.x).toBeCloseTo(0);
    expect(result.point.y).toBeCloseTo(0);
    expect(result.point.z).toBeCloseTo(0.5);
  });

  test('weights bias the result towards the heavier ray', () => {
    // Same skew rays as above, but Ray 1 has weight 9, Ray 2 has weight 1.
    const obs: Observation[] = [
      { ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, rayWeight: 9 },
      { ray: { origin: { x: 0, y: 0, z: 1 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1 },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result.point.z).toBeLessThan(0.5); // closer to z=0
  });

  test('single ray with strong depth prior returns the depth point', () => {
    const obs: Observation[] = [
      { 
        ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, 
        rayWeight: 1,
        depthPoint: { x: 5, y: 0, z: 0 },
        depthWeight: 10
      }
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result.point.x).toBeCloseTo(5);
  });
  
  test('strong triangulation baseline out-votes weak depth priors', () => {
    // 3 converging rays with slightly off depth points
    const obs: Observation[] = [
      { ray: { origin: { x: -1, y: 1, z: 0 }, direction: { x: 1, y: -1, z: 0 } }, rayWeight: 1, depthPoint: { x: 0, y: 0, z: 1 }, depthWeight: 0.1 },
      { ray: { origin: { x: 1, y: 1, z: 0 }, direction: { x: -1, y: -1, z: 0 } }, rayWeight: 1, depthPoint: { x: 0, y: 0, z: 1 }, depthWeight: 0.1 },
      { ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, rayWeight: 1, depthPoint: { x: 0, y: 0, z: 1 }, depthWeight: 0.1 },
    ];
    // True intersection is at 0,0,0
    const result = solveClosestPointOfApproach(obs);
    expect(result.point.z).toBeLessThan(0.5); // Should be much closer to 0 than 1
  });
 ```