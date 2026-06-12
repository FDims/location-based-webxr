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

import { mat4, quat, vec3, vec4 } from 'gl-matrix';
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
  const cameraQuat = quat.fromValues(
    cameraRot[0],
    cameraRot[1],
    cameraRot[2],
    cameraRot[3]
  );
  const cameraPosVec = vec3.fromValues(
    cameraPos[0],
    cameraPos[1],
    cameraPos[2]
  );

  // Reusable temporaries — sample-scoped, never escape `unproject` (the
  // result is always copied into a fresh array before returning).
  const ndc = vec4.create();
  const view = vec4.create();
  const viewPoint = vec3.create();
  const world = vec3.create();

  return {
    unproject(point: DepthPoint): Vector3 | null {
      if (!isUsablePoint(point)) {
        return null;
      }
      const { screenX, screenY, depthM } = point;

      // Inverse-project an arbitrary point on the pixel's ray (NDC z = -1),
      // then rescale the resulting view-space point so its z-depth is depthM.
      vec4.set(ndc, 2 * screenX - 1, 1 - 2 * screenY, -1, 1);
      vec4.transformMat4(view, ndc, invProj);
      if (view[3] === 0) {
        return null;
      }
      const rayX = view[0] / view[3];
      const rayY = view[1] / view[3];
      const rayZ = view[2] / view[3];
      if (rayZ >= 0) {
        return null; // ray does not point into the view frustum (-z forward)
      }
      const scale = -depthM / rayZ;
      vec3.set(viewPoint, rayX * scale, rayY * scale, -depthM);

      // Rigid transform by the camera pose: world = rot · viewPoint + pos
      vec3.transformQuat(world, viewPoint, cameraQuat);
      vec3.add(world, world, cameraPosVec);

      const result: Vector3 = [world[0], world[1], world[2]];
      return result.every((v) => Number.isFinite(v)) ? result : null;
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
