import * as THREE from 'three';

/**
 * Frustum-visibility predicates used by GPS-anchored components and any other
 * caller that needs to know whether a world-space point/sphere/object is
 * currently visible to a camera. Three.js's `Frustum` has the primitives we
 * need; this module wraps them so:
 *
 *  - All three predicates share a module-level scratch `Frustum`/`Matrix4`
 *    so a single frame's worth of checks pays the matrix multiply once.
 *  - Each predicate accepts an optional `frustum` parameter for callers that
 *    already have one built (e.g. via `buildCameraFrustum`) and want to
 *    keep doing many checks against it without rebuilding.
 *
 * The Three.js convention here is that `Frustum.containsPoint` is strict
 * (point must be inside all six planes) while `intersectsSphere`/
 * `intersectsObject` accept overlap with any plane, which is the right
 * notion for "is this object at least partially on screen".
 */

const scratchMatrix = new THREE.Matrix4();
const scratchFrustum = new THREE.Frustum();

/**
 * Build (or refresh) a Three.js `Frustum` from `camera`'s current world
 * transform and projection matrix. If `out` is provided, the frustum is
 * written into it and returned; otherwise the module-level scratch frustum
 * is used. Callers MUST treat the returned frustum as immutable until they
 * next call this function or use one of the predicates without an injected
 * frustum (both reuse the same scratch).
 */
export function buildCameraFrustum(
  camera: THREE.Camera,
  out?: THREE.Frustum
): THREE.Frustum {
  scratchMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  const target = out ?? scratchFrustum;
  target.setFromProjectionMatrix(scratchMatrix);
  return target;
}

/**
 * Strictly check whether a single world-space point lies inside all six
 * frustum planes. Useful for HUD/follow logic where the caller already has
 * the target world position and wants the cheapest possible check.
 */
export function isPointInCameraFrustum(
  camera: THREE.Camera,
  point: THREE.Vector3,
  frustum?: THREE.Frustum
): boolean {
  const f = frustum ?? buildCameraFrustum(camera);
  return f.containsPoint(point);
}

/**
 * Check whether a world-space bounding sphere intersects the camera frustum
 * (returns true even for partial overlap). Useful for callers that maintain
 * a precomputed bounding sphere (LOD systems, instanced meshes, future
 * `ArPowerSaver`).
 */
export function isSphereInCameraFrustum(
  camera: THREE.Camera,
  sphere: THREE.Sphere,
  frustum?: THREE.Frustum
): boolean {
  const f = frustum ?? buildCameraFrustum(camera);
  return f.intersectsSphere(sphere);
}

const objectScratchSphere = new THREE.Sphere();

/**
 * Check whether an `Object3D` is currently (at least partially) inside the
 * camera frustum. Computes the object's world bounding sphere by taking the
 * geometry's local bounding sphere and applying `matrixWorld`. For objects
 * without geometry (e.g. plain `Group`s used as anchor containers) there is no
 * bounding sphere to test, so they are treated as "in frustum" (`true`). This
 * is the conservative default for visibility gating and deliberately avoids
 * `Frustum.intersectsObject`, which unconditionally dereferences
 * `object.geometry.boundingSphere` and therefore throws for geometry-less
 * objects.
 *
 * Callers should ensure `object.updateMatrixWorld()` has already run this
 * frame (it normally has, via `renderer.render`).
 */
export function isObjectInCameraFrustum(
  camera: THREE.Camera,
  object: THREE.Object3D,
  frustum?: THREE.Frustum
): boolean {
  const f = frustum ?? buildCameraFrustum(camera);
  // Prefer the mesh's own bounding sphere (cheap, deterministic) when present.
  const mesh = object as THREE.Mesh;
  const geometry = mesh.geometry;
  if (geometry) {
    if (!geometry.boundingSphere) {
      geometry.computeBoundingSphere();
    }
    const bs = geometry.boundingSphere;
    if (bs) {
      objectScratchSphere.copy(bs).applyMatrix4(object.matrixWorld);
      return f.intersectsSphere(objectScratchSphere);
    }
  }
  // Geometry-less object (e.g. Group): no bounding sphere to test. Treat as
  // visible rather than calling Frustum.intersectsObject, which would throw.
  return true;
}
