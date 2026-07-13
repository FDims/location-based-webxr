/** Lightweight 3D vector — no Three.js dependency. */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A 3D ray. Direction need not be pre-normalized; the solver normalizes internally. */
interface Ray {
  origin: Vec3;
  direction: Vec3;
}

/**
 * One "measurement shot". Ray + optional depth reading are grouped so
 * outlier-rejection (e.g. RANSAC) can atomically discard both.
 */
export interface Observation {
  ray: Ray;
  /** Confidence in the ray direction. Typically 1.0; lower if tracking was unstable. */
  rayWeight: number;
  /** 3D point derived from the depth map along this ray. */
  depthPoint?: Vec3;
  /** Confidence in the depth reading. Decays with distance. */
  depthWeight?: number;
}

/** Result of triangulating N observations. */
export interface TriangulationResult {
  point: Vec3;
  /**
   * trace(A⁻¹) — high when rays are nearly parallel (small baseline).
   * Drives the "move sideways" coaching prompt.
   */
  uncertainty: number;
  /** Average perpendicular distance (metres) from the solved point to each ray. */
  rmsError: number;
}

/**
 * Least-squares closest-point-of-approach solver for N weighted rays.
 *
 * Ray term:   A += w·(I − d·dᵀ),   B += w·(I − d·dᵀ)·o
 * Depth term: A += w·(d·dᵀ),       B += w·(d·p)·d
 *
 * The two terms are orthogonal complements, so ray and depth constraints
 * never fight each other. Returns null when A is singular.
 */
export function solveClosestPointOfApproach(
  observations: Observation[]
): TriangulationResult | null {
  if (observations.length === 0) return null;

  const A: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const B: [number, number, number] = [0, 0, 0];

  for (const obs of observations) {
    const len = Math.sqrt(
      obs.ray.direction.x ** 2 +
        obs.ray.direction.y ** 2 +
        obs.ray.direction.z ** 2
    );
    if (len < 1e-10) continue;
    const dx = obs.ray.direction.x / len;
    const dy = obs.ray.direction.y / len;
    const dz = obs.ray.direction.z / len;

    if (obs.rayWeight > 0) {
      const { x: ox, y: oy, z: oz } = obs.ray.origin;
      const w = obs.rayWeight;
      // M = I − d·dᵀ
      const M: [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ] = [
        1 - dx * dx,
        -dx * dy,
        -dx * dz,
        -dy * dx,
        1 - dy * dy,
        -dy * dz,
        -dz * dx,
        -dz * dy,
        1 - dz * dz,
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

    if (obs.depthPoint && obs.depthWeight != null && obs.depthWeight > 0) {
      const { x: px, y: py, z: pz } = obs.depthPoint;
      const w = obs.depthWeight;
      // D = d·dᵀ (along-ray projector — orthogonal complement of M)
      A[0] += dx * dx * w;
      A[1] += dx * dy * w;
      A[2] += dx * dz * w;
      A[3] += dy * dx * w;
      A[4] += dy * dy * w;
      A[5] += dy * dz * w;
      A[6] += dz * dx * w;
      A[7] += dz * dy * w;
      A[8] += dz * dz * w;
      const dDotP = dx * px + dy * py + dz * pz;
      B[0] += dx * dDotP * w;
      B[1] += dy * dDotP * w;
      B[2] += dz * dDotP * w;
    }
  }

  const A_inv = invertMatrix3x3(A);
  if (!A_inv) return null;

  const P: Vec3 = {
    x: A_inv[0] * B[0] + A_inv[1] * B[1] + A_inv[2] * B[2],
    y: A_inv[3] * B[0] + A_inv[4] * B[1] + A_inv[5] * B[2],
    z: A_inv[6] * B[0] + A_inv[7] * B[1] + A_inv[8] * B[2],
  };

  const rmsError = computeRMSError(observations, P);
  const uncertainty = A_inv[0] + A_inv[4] + A_inv[8];

  return { point: P, uncertainty, rmsError };
}

/** Computes the Root Mean Square perpendicular distance from point P to all valid rays. */
function computeRMSError(observations: Observation[], P: Vec3): number {
  let sumSq = 0;
  let validRays = 0;
  for (const obs of observations) {
    if (obs.rayWeight <= 0) continue;
    const len2 = Math.sqrt(
      obs.ray.direction.x ** 2 +
        obs.ray.direction.y ** 2 +
        obs.ray.direction.z ** 2
    );
    if (len2 < 1e-10) continue;
    const dx = obs.ray.direction.x / len2;
    const dy = obs.ray.direction.y / len2;
    const dz = obs.ray.direction.z / len2;
    const { x: ox, y: oy, z: oz } = obs.ray.origin;
    const pox = P.x - ox;
    const poy = P.y - oy;
    const poz = P.z - oz;
    sumSq +=
      (poy * dz - poz * dy) ** 2 +
      (poz * dx - pox * dz) ** 2 +
      (pox * dy - poy * dx) ** 2;
    validRays++;
  }
  return validRays > 0 ? Math.sqrt(sumSq / validRays) : 0;
}

/** Inverts a 3×3 row-major matrix. Returns null when det < 1e-8 (singular). */
function invertMatrix3x3(
  m: [number, number, number, number, number, number, number, number, number]
):
  | [number, number, number, number, number, number, number, number, number]
  | null {
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
