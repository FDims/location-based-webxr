/**
 * Depth Unprojection Tests — edge cases and conventions.
 *
 * Why this test matters:
 * unprojectDepthPoint turns a persisted (screenX, screenY, depthM) depth
 * read back into a 3D point in raw WebXR space — the core math the AR-space
 * occupancy grid is built on (2026-06-11 port plan §3). Sign/axis errors
 * here put every voxel in the wrong place, and old recordings without a
 * projectionMatrix must be skipped (null), never crash.
 */

import { describe, it, expect } from 'vitest';
import { mat4 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import {
  unprojectDepthPoint,
  createDepthUnprojector,
} from './depth-unprojection';

const IDENTITY_ROT: Quaternion = [0, 0, 0, 1];
const ORIGIN: Vector3 = [0, 0, 0];

function perspective(fovyRad: number, aspect: number): Matrix4 {
  const m = mat4.perspective(mat4.create(), fovyRad, aspect, 0.1, 100);
  return Array.from(m) as unknown as Matrix4;
}

describe('unprojectDepthPoint', () => {
  it('returns null when projectionMatrix is missing (old recordings)', () => {
    const result = unprojectDepthPoint(
      { screenX: 0.5, screenY: 0.5, depthM: 2 },
      ORIGIN,
      IDENTITY_ROT,
      undefined
    );
    expect(result).toBeNull();
  });

  it('returns null for non-positive or non-finite depth', () => {
    const p = perspective(Math.PI / 3, 16 / 9);
    for (const depthM of [0, -1, NaN, Infinity]) {
      expect(
        unprojectDepthPoint(
          { screenX: 0.5, screenY: 0.5, depthM },
          ORIGIN,
          IDENTITY_ROT,
          p
        )
      ).toBeNull();
    }
  });

  it('returns null for out-of-range or non-finite screen coordinates', () => {
    const p = perspective(Math.PI / 3, 16 / 9);
    const bad = [
      { screenX: -0.1, screenY: 0.5 },
      { screenX: 1.1, screenY: 0.5 },
      { screenX: 0.5, screenY: NaN },
    ];
    for (const { screenX, screenY } of bad) {
      expect(
        unprojectDepthPoint(
          { screenX, screenY, depthM: 2 },
          ORIGIN,
          IDENTITY_ROT,
          p
        )
      ).toBeNull();
    }
  });

  it('returns null for a singular (non-invertible) matrix', () => {
    const zeros = new Array(16).fill(0) as unknown as Matrix4;
    expect(
      unprojectDepthPoint(
        { screenX: 0.5, screenY: 0.5, depthM: 2 },
        ORIGIN,
        IDENTITY_ROT,
        zeros
      )
    ).toBeNull();
  });

  /**
   * Convention anchor: the screen center at depth d must land exactly d
   * meters straight ahead of an identity-pose camera, i.e. at (0, 0, -d)
   * in raw WebXR space (camera looks down -Z).
   */
  it('maps the screen center to (0, 0, -depth) for an identity camera', () => {
    const p = perspective(Math.PI / 3, 16 / 9);
    const result = unprojectDepthPoint(
      { screenX: 0.5, screenY: 0.5, depthM: 3 },
      ORIGIN,
      IDENTITY_ROT,
      p
    );
    expect(result).not.toBeNull();
    expect(result![0]).toBeCloseTo(0, 6);
    expect(result![1]).toBeCloseTo(0, 6);
    expect(result![2]).toBeCloseTo(-3, 6);
  });

  /**
   * Convention anchor: screenY grows downward (top-left origin), so a
   * point in the upper half of the screen (screenY < 0.5) must land
   * ABOVE the camera axis (world +Y for an identity pose).
   */
  it('maps upper-screen points to +Y and right-screen points to +X', () => {
    const p = perspective(Math.PI / 3, 16 / 9);
    const upper = unprojectDepthPoint(
      { screenX: 0.5, screenY: 0.25, depthM: 2 },
      ORIGIN,
      IDENTITY_ROT,
      p
    );
    const right = unprojectDepthPoint(
      { screenX: 0.75, screenY: 0.5, depthM: 2 },
      ORIGIN,
      IDENTITY_ROT,
      p
    );
    expect(upper![1]).toBeGreaterThan(0);
    expect(right![0]).toBeGreaterThan(0);
  });

  it('applies camera position as a translation', () => {
    const p = perspective(Math.PI / 3, 1);
    const camPos: Vector3 = [10, -2, 5];
    const result = unprojectDepthPoint(
      { screenX: 0.5, screenY: 0.5, depthM: 4 },
      camPos,
      IDENTITY_ROT,
      p
    );
    expect(result![0]).toBeCloseTo(10, 6);
    expect(result![1]).toBeCloseTo(-2, 6);
    expect(result![2]).toBeCloseTo(5 - 4, 6);
  });

  it('applies camera rotation (90° yaw turns -Z forward into -X)', () => {
    const p = perspective(Math.PI / 3, 1);
    // 90° rotation around +Y: forward (-Z) becomes -X
    const halfAngle = Math.PI / 4;
    const yaw90: Quaternion = [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)];
    const result = unprojectDepthPoint(
      { screenX: 0.5, screenY: 0.5, depthM: 2 },
      ORIGIN,
      yaw90,
      p
    );
    expect(result![0]).toBeCloseTo(-2, 6);
    expect(result![1]).toBeCloseTo(0, 6);
    expect(result![2]).toBeCloseTo(0, 6);
  });
});

describe('createDepthUnprojector', () => {
  // Why this test matters: the sample-scoped unprojector reuses pre-allocated
  // vec3/vec4/mat4/quat temporaries across every point to avoid per-point
  // allocation. This guards that the reuse is correct — a reused unprojector
  // must return byte-identical results to independent one-off calls, with no
  // bleed from one point's intermediate state into the next.
  it('returns null for a missing or singular projection matrix', () => {
    expect(createDepthUnprojector(ORIGIN, IDENTITY_ROT, undefined)).toBeNull();
    const singular = Array.from(mat4.create()).map(
      () => 0
    ) as unknown as Matrix4;
    expect(createDepthUnprojector(ORIGIN, IDENTITY_ROT, singular)).toBeNull();
  });

  it('reused over many points matches independent unprojectDepthPoint calls', () => {
    const p = perspective(Math.PI / 3, 16 / 9);
    const camPos: Vector3 = [3, -1, 7];
    const halfAngle = Math.PI / 5;
    const rot: Quaternion = [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)];
    const points = [
      { screenX: 0.5, screenY: 0.5, depthM: 2 },
      { screenX: 0.1, screenY: 0.9, depthM: 5.5 },
      { screenX: 0.8, screenY: 0.2, depthM: 0.4 },
      { screenX: 1.2, screenY: 0.5, depthM: 2 }, // out of range → null
      { screenX: 0.5, screenY: 0.5, depthM: 2 }, // repeat first: must re-yield
    ];

    const unprojector = createDepthUnprojector(camPos, rot, p)!;
    expect(unprojector).not.toBeNull();
    // Reused results must be deeply equal to the one-off path for every point
    // (identical Float32 math) — and `toEqual` covers the null case uniformly,
    // so no per-point branching (which would trip no-conditional-expect).
    const reused = points.map((point) => unprojector.unproject(point));
    const oneOff = points.map((point) =>
      unprojectDepthPoint(point, camPos, rot, p)
    );
    expect(reused).toEqual(oneOff);
    // Sanity: the batch actually exercises both a null and several non-null
    // outcomes, so the equality above is not vacuously comparing all-nulls.
    expect(reused.filter((r) => r === null)).toHaveLength(1);
    expect(reused.filter((r) => r !== null).length).toBeGreaterThan(1);
  });
});
