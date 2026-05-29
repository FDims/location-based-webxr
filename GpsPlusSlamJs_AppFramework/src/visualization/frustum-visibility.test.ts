import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  buildCameraFrustum,
  isObjectInCameraFrustum,
  isPointInCameraFrustum,
  isSphereInCameraFrustum,
} from './frustum-visibility.js';

/**
 * Why these tests matter:
 * The `GpsAnchor` `'snap-when-offscreen'` mode (Item 1 of the C# port plan)
 * gates pose commits on whether the anchored object is currently visible to
 * the camera. We want a single tested helper module that exposes three
 * predicates sharing a cached scratch `Frustum`/`Matrix4` so callers doing
 * many checks per frame only rebuild the frustum once. These tests pin
 * down the inside/outside boundary for points, spheres, and objects, plus
 * the documented `frustum?` injection for reusing a cached one.
 */

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  // Camera at origin, looking down -Z (Three.js default).
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld();
  return camera;
}

describe('buildCameraFrustum', () => {
  it('returns a Frustum derived from the camera projection × matrixWorldInverse', () => {
    const camera = makeCamera();
    const frustum = buildCameraFrustum(camera);

    const inside = new THREE.Vector3(0, 0, -5);
    const behind = new THREE.Vector3(0, 0, 5);

    expect(frustum.containsPoint(inside)).toBe(true);
    expect(frustum.containsPoint(behind)).toBe(false);
  });

  it('writes into the caller-provided scratch Frustum when given one', () => {
    const camera = makeCamera();
    const scratch = new THREE.Frustum();
    const returned = buildCameraFrustum(camera, scratch);

    expect(returned).toBe(scratch);
  });
});

describe('isPointInCameraFrustum', () => {
  it('returns true for a point straight ahead inside near/far', () => {
    const camera = makeCamera();
    expect(isPointInCameraFrustum(camera, new THREE.Vector3(0, 0, -5))).toBe(
      true
    );
  });

  it('returns false for a point behind the camera', () => {
    const camera = makeCamera();
    expect(isPointInCameraFrustum(camera, new THREE.Vector3(0, 0, 5))).toBe(
      false
    );
  });

  it('returns false for a point past the far plane', () => {
    const camera = makeCamera();
    expect(isPointInCameraFrustum(camera, new THREE.Vector3(0, 0, -1000))).toBe(
      false
    );
  });

  it('returns false for a point far to the side outside the FOV', () => {
    const camera = makeCamera();
    expect(isPointInCameraFrustum(camera, new THREE.Vector3(100, 0, -5))).toBe(
      false
    );
  });

  it('reuses the provided frustum without rebuilding it', () => {
    const camera = makeCamera();
    const frustum = buildCameraFrustum(camera);
    // Mutate camera so a rebuild would *change* the answer if it happened.
    camera.position.set(0, 0, -1000);
    camera.updateMatrixWorld();
    // Using the stale frustum keeps the original "looking down -Z from origin"
    // result.
    expect(
      isPointInCameraFrustum(camera, new THREE.Vector3(0, 0, -5), frustum)
    ).toBe(true);
  });
});

describe('isSphereInCameraFrustum', () => {
  it('returns true for a sphere entirely inside the frustum', () => {
    const camera = makeCamera();
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, -5), 1);
    expect(isSphereInCameraFrustum(camera, sphere)).toBe(true);
  });

  it('returns true when the sphere overlaps a frustum plane (partially visible)', () => {
    const camera = makeCamera();
    // Centre behind the camera but radius reaches in front.
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.5), 1);
    expect(isSphereInCameraFrustum(camera, sphere)).toBe(true);
  });

  it('returns false for a sphere fully behind the camera', () => {
    const camera = makeCamera();
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 10), 1);
    expect(isSphereInCameraFrustum(camera, sphere)).toBe(false);
  });

  it('accepts an injected frustum for reuse', () => {
    const camera = makeCamera();
    const frustum = buildCameraFrustum(camera);
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, -5), 1);
    expect(isSphereInCameraFrustum(camera, sphere, frustum)).toBe(true);
  });
});

describe('isObjectInCameraFrustum', () => {
  function makeUnitSphereMesh(): THREE.Mesh {
    const geom = new THREE.SphereGeometry(1, 8, 8);
    const mat = new THREE.MeshBasicMaterial();
    return new THREE.Mesh(geom, mat);
  }

  it('returns true for an object positioned in front of the camera', () => {
    const camera = makeCamera();
    const mesh = makeUnitSphereMesh();
    mesh.position.set(0, 0, -5);
    mesh.updateMatrixWorld();
    expect(isObjectInCameraFrustum(camera, mesh)).toBe(true);
  });

  it('returns false for an object positioned behind the camera', () => {
    const camera = makeCamera();
    const mesh = makeUnitSphereMesh();
    mesh.position.set(0, 0, 10);
    mesh.updateMatrixWorld();
    expect(isObjectInCameraFrustum(camera, mesh)).toBe(false);
  });

  it('returns false for an object far outside the FOV', () => {
    const camera = makeCamera();
    const mesh = makeUnitSphereMesh();
    mesh.position.set(1000, 0, -5);
    mesh.updateMatrixWorld();
    expect(isObjectInCameraFrustum(camera, mesh)).toBe(false);
  });

  it('respects parent transforms (uses world bounding sphere)', () => {
    const camera = makeCamera();
    const group = new THREE.Group();
    group.position.set(0, 0, -5);
    const mesh = makeUnitSphereMesh();
    group.add(mesh);
    group.updateMatrixWorld(true);
    expect(isObjectInCameraFrustum(camera, mesh)).toBe(true);
  });

  it('accepts an injected frustum for reuse', () => {
    const camera = makeCamera();
    const frustum = buildCameraFrustum(camera);
    const mesh = makeUnitSphereMesh();
    mesh.position.set(0, 0, -5);
    mesh.updateMatrixWorld();
    expect(isObjectInCameraFrustum(camera, mesh, frustum)).toBe(true);
  });

  // Why this test matters: GpsAnchor passes its `object3D` directly, which is
  // frequently a plain `THREE.Group` container with no `geometry`. Three.js's
  // `Frustum.intersectsObject` does NOT treat such objects as "in frustum" —
  // it unconditionally reads `object.geometry.boundingSphere`, which throws a
  // TypeError for a Group. This test pins the safe default (treat geometry-less
  // objects as visible) and guards against a regression to the crashing path.
  it('treats a geometry-less object (Group) as in-frustum without throwing', () => {
    const camera = makeCamera();
    const group = new THREE.Group();
    // Position is irrelevant: a geometry-less object has no bounding sphere to
    // test, so the safe default applies regardless of where it sits.
    group.position.set(1000, 0, -5);
    group.updateMatrixWorld();
    expect(() => isObjectInCameraFrustum(camera, group)).not.toThrow();
    expect(isObjectInCameraFrustum(camera, group)).toBe(true);
  });
});
