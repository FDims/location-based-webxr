/**
 * Depth Unprojection Property Tests — projection round-trip.
 *
 * Why this test matters:
 * The unprojection must be the exact inverse of the perspective projection
 * for any plausible camera intrinsics. We derive the expected view-space
 * point ANALYTICALLY from the perspective parameters (vx = ndcX·d/P00,
 * vy = ndcY·d/P11, vz = −d — valid for axis-aligned frustums without skew),
 * so the expectation does not share the implementation's inverse-matrix
 * code path. A second property checks the rigid camera-pose transform.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mat4, quat, vec3 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import { unprojectDepthPoint } from './depth-unprojection';

const IDENTITY_ROT: Quaternion = [0, 0, 0, 1];
const ORIGIN: Vector3 = [0, 0, 0];

const arbFovy = fc.double({
  min: Math.PI / 6,
  max: (Math.PI * 2) / 3,
  noNaN: true,
});
const arbAspect = fc.double({ min: 0.4, max: 2.5, noNaN: true });
const arbDepth = fc.double({ min: 0.2, max: 40, noNaN: true });
const arbScreen = fc.double({ min: 0.01, max: 0.99, noNaN: true });

describe('unprojectDepthPoint properties', () => {
  it('recovers the analytic view-space point for any frustum and pixel', () => {
    fc.assert(
      fc.property(
        arbFovy,
        arbAspect,
        arbDepth,
        arbScreen,
        arbScreen,
        (fovy, aspect, depthM, screenX, screenY) => {
          const p = Array.from(
            mat4.perspective(mat4.create(), fovy, aspect, 0.1, 1000)
          ) as unknown as Matrix4;

          const result = unprojectDepthPoint(
            { screenX, screenY, depthM },
            ORIGIN,
            IDENTITY_ROT,
            p
          );
          expect(result).not.toBeNull();

          // Analytic expectation (column-major: P00 = p[0], P11 = p[5])
          const ndcX = 2 * screenX - 1;
          const ndcY = 1 - 2 * screenY;
          const expected = [
            (ndcX * depthM) / p[0],
            (ndcY * depthM) / p[5],
            -depthM,
          ];

          const tolerance = 1e-6 * Math.max(1, depthM);
          for (let i = 0; i < 3; i++) {
            expect(Math.abs(result![i] - expected[i])).toBeLessThan(tolerance);
          }
        }
      )
    );
  });

  it('applies the camera pose as a rigid transform of the view-space point', () => {
    const arbCoord = fc.double({ min: -100, max: 100, noNaN: true });
    const arbAxisComponent = fc.double({ min: -1, max: 1, noNaN: true });
    const arbAngle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });

    fc.assert(
      fc.property(
        arbDepth,
        arbScreen,
        arbScreen,
        fc.tuple(arbCoord, arbCoord, arbCoord),
        fc.tuple(arbAxisComponent, arbAxisComponent, arbAxisComponent),
        arbAngle,
        (depthM, screenX, screenY, camPos, axis, angle) => {
          // Skip near-zero axes that cannot be normalized into a rotation
          fc.pre(Math.hypot(...axis) > 1e-3);

          const p = Array.from(
            mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
          ) as unknown as Matrix4;

          const q = quat.setAxisAngle(
            quat.create(),
            vec3.normalize(vec3.create(), vec3.fromValues(...axis)),
            angle
          );
          const camRot = [q[0], q[1], q[2], q[3]] as unknown as Quaternion;

          // Reference: unproject with identity pose, then rigid-transform
          const local = unprojectDepthPoint(
            { screenX, screenY, depthM },
            ORIGIN,
            IDENTITY_ROT,
            p
          );
          expect(local).not.toBeNull();
          const expected = vec3.add(
            vec3.create(),
            vec3.transformQuat(
              vec3.create(),
              vec3.fromValues(local![0], local![1], local![2]),
              q
            ),
            vec3.fromValues(...camPos)
          );

          const result = unprojectDepthPoint(
            { screenX, screenY, depthM },
            camPos,
            camRot,
            p
          );
          expect(result).not.toBeNull();

          const tolerance = 1e-5 * Math.max(1, depthM);
          for (let i = 0; i < 3; i++) {
            expect(Math.abs(result![i] - expected[i])).toBeLessThan(tolerance);
          }
        }
      )
    );
  });
});
