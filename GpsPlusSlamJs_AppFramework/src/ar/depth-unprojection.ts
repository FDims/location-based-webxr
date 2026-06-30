/**
 * Depth Unprojection
 *
 * Pure math: turn a persisted depth read (normalized view coordinates +
 * depth in meters) back into a 3D point in raw WebXR (local-floor) space
 * using the capturing view's projection matrix.
 *
 * Convention (single source of truth for NDC flips, see the 2026-06-11
 * occupancy-grid port plan §6):
 * - screenX/screenY are normalized view coordinates with a TOP-LEFT origin
 *   (screenY grows downward), exactly as fed to `getDepthInMeters`.
 * - NDC: x = 2·sx − 1, y = 1 − 2·sy (flip Y to bottom-up).
 * - View space is the WebXR camera frame: +x right, +y up, −z forward;
 *   `depthM` is the z-depth (distance along −z), not euclidean distance.
 *
 * @see depth-unprojection.ts.md for detailed documentation
 */

import { mat4 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import type { DepthPoint } from '../types/ar-types';

/**
 * A sample-scoped unprojector: the camera pose and (inverse) projection are
 * computed once, then reused for every point in the same `DepthSample`. See
 * {@link createDepthUnprojector}.
 */
export interface DepthUnprojector {
  /**
   * Unproject one point into raw WebXR space, or `null` when the input is not
   * usable (non-positive/non-finite depth, out-of-range screen coordinates,
   * degenerate ray).
   */
  unproject(point: DepthPoint): Vector3 | null;
}

/**
 * Build a {@link DepthUnprojector} for one depth sample. The projection
 * inverse and camera quaternion/position are sample-invariant, so they are
 * computed once here instead of per point (the per-point hot path then only
 * does the cheap NDC→view→world transform). Callers that fold many points
 * from the same sample — e.g. `OccupancyGrid.addSample` — should build the
 * unprojector once and reuse it for all points.
 *
 * @param cameraPos - camera position, raw WebXR (`DepthSample.cameraPos`)
 * @param cameraRot - camera quaternion [x,y,z,w], raw WebXR (`DepthSample.cameraRot`)
 * @param projectionMatrix - column-major projection matrix of the capturing
 *   view (`DepthSample.projectionMatrix`). `undefined` for recordings made
 *   before intrinsics capture — those points cannot be unprojected.
 * @returns an unprojector, or `null` when the sample cannot be unprojected at
 *   all (missing or singular projection matrix).
 */
export function createDepthUnprojector(
  cameraPos: Vector3,
  cameraRot: Quaternion,
  projectionMatrix: Matrix4 | undefined
): DepthUnprojector | null {
  if (!projectionMatrix || projectionMatrix.length !== 16) {
    return null;
  }
  // `Matrix4` is structurally a ReadonlyMat4, so it can be passed straight to
  // `invert` (which only reads its source) — no copy or cast needed.
  const invProj = mat4.invert(mat4.create(), projectionMatrix);
  if (!invProj) {
    return null; // singular matrix
  }

  // Capture the inverse-projection columns and the camera pose as plain scalars
  // ONCE, so the per-point hot path (called once per depth point — millions on a
  // long replay) is pure arithmetic: no gl-matrix calls, no Float32Array
  // indexing, and no temporary-vector allocations. (The math mirrors
  // `vec4.transformMat4` → perspective divide → rescale → `vec3.transformQuat` +
  // translate; keeping f64 intermediates makes it marginally more accurate than
  // the previous Float32Array path, which is harmless — the grid quantizes the
  // result to 15 cm cells.)
  const m0 = invProj[0];
  const m1 = invProj[1];
  const m2 = invProj[2];
  const m3 = invProj[3];
  const m4 = invProj[4];
  const m5 = invProj[5];
  const m6 = invProj[6];
  const m7 = invProj[7];
  const m8 = invProj[8];
  const m9 = invProj[9];
  const m10 = invProj[10];
  const m11 = invProj[11];
  const m12 = invProj[12];
  const m13 = invProj[13];
  const m14 = invProj[14];
  const m15 = invProj[15];
  const qx = cameraRot[0];
  const qy = cameraRot[1];
  const qz = cameraRot[2];
  const qw = cameraRot[3];
  const px = cameraPos[0];
  const py = cameraPos[1];
  const pz = cameraPos[2];

  return {
    unproject(point: DepthPoint): Vector3 | null {
      if (!isUsablePoint(point)) {
        return null;
      }
      const { screenX, screenY, depthM } = point;

      // Inverse-project a point on the pixel's ray (NDC = [nx, ny, −1, 1]):
      // view = invProj · ndc (column-major).
      const nx = 2 * screenX - 1;
      const ny = 1 - 2 * screenY;
      const viewW = m3 * nx + m7 * ny - m11 + m15;
      if (viewW === 0) {
        return null;
      }
      const viewZ = m2 * nx + m6 * ny - m10 + m14;
      const rayZ = viewZ / viewW;
      if (rayZ >= 0) {
        return null; // ray does not point into the view frustum (−z forward)
      }
      const viewX = m0 * nx + m4 * ny - m8 + m12;
      const viewY = m1 * nx + m5 * ny - m9 + m13;
      // Rescale so the view-space point's z-depth is depthM.
      const scale = -depthM / rayZ;
      const vx = (viewX / viewW) * scale;
      const vy = (viewY / viewW) * scale;
      const vz = -depthM;

      // world = cameraQuat · viewPoint + cameraPos (vec3.transformQuat inlined:
      // a + 2w·(q×a) + 2·(q×(q×a))).
      let uvx = qy * vz - qz * vy;
      let uvy = qz * vx - qx * vz;
      let uvz = qx * vy - qy * vx;
      const uuvx = qy * uvz - qz * uvy;
      const uuvy = qz * uvx - qx * uvz;
      const uuvz = qx * uvy - qy * uvx;
      const w2 = qw * 2;
      uvx *= w2;
      uvy *= w2;
      uvz *= w2;
      const worldX = vx + uvx + uuvx * 2 + px;
      const worldY = vy + uvy + uuvy * 2 + py;
      const worldZ = vz + uvz + uuvz * 2 + pz;

      if (
        !Number.isFinite(worldX) ||
        !Number.isFinite(worldY) ||
        !Number.isFinite(worldZ)
      ) {
        return null;
      }
      return [worldX, worldY, worldZ];
    },
  };
}

/**
 * Unproject a single depth point into raw WebXR space. Convenience wrapper
 * over {@link createDepthUnprojector} for one-off callers; when unprojecting
 * many points from the same sample, build the unprojector once instead.
 *
 * @param point - normalized view coordinates + depth in meters
 * @param cameraPos - camera position, raw WebXR (`DepthSample.cameraPos`)
 * @param cameraRot - camera quaternion [x,y,z,w], raw WebXR (`DepthSample.cameraRot`)
 * @param projectionMatrix - column-major projection matrix of the capturing
 *   view (`DepthSample.projectionMatrix`). `undefined` for recordings made
 *   before intrinsics capture — those points cannot be unprojected.
 * @returns the 3D point in raw WebXR space, or `null` when the input is not
 *   usable (missing/singular matrix, non-positive or non-finite depth,
 *   out-of-range screen coordinates).
 */
export function unprojectDepthPoint(
  point: DepthPoint,
  cameraPos: Vector3,
  cameraRot: Quaternion,
  projectionMatrix: Matrix4 | undefined
): Vector3 | null {
  const unprojector = createDepthUnprojector(
    cameraPos,
    cameraRot,
    projectionMatrix
  );
  return unprojector ? unprojector.unproject(point) : null;
}

function isUsablePoint(point: DepthPoint): boolean {
  return (
    Number.isFinite(point.depthM) &&
    point.depthM > 0 &&
    isInUnitRange(point.screenX) &&
    isInUnitRange(point.screenY)
  );
}

function isInUnitRange(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= 1;
}
