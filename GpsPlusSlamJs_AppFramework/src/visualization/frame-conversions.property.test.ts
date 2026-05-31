/**
 * Property-based tests for `nueToArLocal`.
 *
 * Why these matter: the round-trip `alignment · nueToArLocal(alignment, nue)
 * ≈ nue` is the single invariant that defines the helper, and it must hold
 * for *every* rigid alignment and *every* GPS-world point — not just the
 * handful in the example-based suite. Property testing fuzzes both, which is
 * the strongest guard against a frame regression like the original
 * alignment-frame bug
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md)
 * sneaking back in.
 *
 * The alignment arbitrary mirrors the real alignment matrix: a RIGID
 * transform (rotation + translation, unit scale) so it is exactly invertible
 * and distance-preserving.
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import * as THREE from 'three';
import { nueToArLocal } from './frame-conversions.js';

const arbUnit = fc.double({ min: -1, max: 1, noNaN: true });
const arbAngle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const arbComponent = fc.double({ min: -100, max: 100, noNaN: true });

/** A random rigid 4×4 alignment matrix as a column-major 16-array. */
const arbRigidAlignment = fc
  .record({
    ax: arbUnit,
    ay: arbUnit,
    az: arbUnit,
    angle: arbAngle,
    tx: arbComponent,
    ty: arbComponent,
    tz: arbComponent,
  })
  .map(({ ax, ay, az, angle, tx, ty, tz }) => {
    const axis = new THREE.Vector3(ax, ay, az);
    if (axis.lengthSq() < 1e-6) axis.set(1, 2, 3);
    axis.normalize();
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    return new THREE.Matrix4()
      .compose(new THREE.Vector3(tx, ty, tz), quat, new THREE.Vector3(1, 1, 1))
      .toArray();
  });

const arbPoint = fc.tuple(arbComponent, arbComponent, arbComponent);

describe('nueToArLocal — properties', () => {
  it('round-trips for every rigid alignment and every point', () => {
    fc.assert(
      fc.property(arbRigidAlignment, arbPoint, (alignment, nue) => {
        const local = nueToArLocal(alignment, nue);
        const back = local
          .clone()
          .applyMatrix4(new THREE.Matrix4().fromArray(alignment));
        // 1e-6 m (1 µm) tolerance absorbs float error over the ±100 m span.
        expect(back.x).toBeCloseTo(nue[0], 6);
        expect(back.y).toBeCloseTo(nue[1], 6);
        expect(back.z).toBeCloseTo(nue[2], 6);
      })
    );
  });

  it('preserves pairwise distances (rigid ⇒ inverse is rigid)', () => {
    fc.assert(
      fc.property(
        arbRigidAlignment,
        arbPoint,
        arbPoint,
        (alignment, p, q) => {
          const lp = nueToArLocal(alignment, p);
          const lq = nueToArLocal(alignment, q);
          const worldDist = Math.hypot(
            p[0] - q[0],
            p[1] - q[1],
            p[2] - q[2]
          );
          // Relative tolerance scaled by the magnitude of the distance.
          expect(lp.distanceTo(lq)).toBeCloseTo(worldDist, 4);
        }
      )
    );
  });
});
