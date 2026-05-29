# `frustum-visibility.ts`

## Purpose

Camera-frustum visibility predicates used by GPS-anchored components (Item 1
of [2026-05-07-csharp-features-not-yet-ported.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md))
and any other caller that needs to know whether a world-space point, sphere,
or `Object3D` is currently visible to a camera. The eventual primary
consumer is `GpsAnchor`'s `'snap-when-offscreen'` mode, which only commits
a new local pose while the anchored object is outside the frustum.

## Public API

- `buildCameraFrustum(camera, out?) → Frustum` — refreshes a Three.js
  `Frustum` from `camera.projectionMatrix × camera.matrixWorldInverse`.
  When `out` is provided, the frustum is written into it; otherwise the
  module-level scratch frustum is reused.
- `isPointInCameraFrustum(camera, point, frustum?) → boolean` — strict
  inside-all-planes check; uses `Frustum.containsPoint`.
- `isSphereInCameraFrustum(camera, sphere, frustum?) → boolean` —
  partial-overlap check; uses `Frustum.intersectsSphere`.
- `isObjectInCameraFrustum(camera, object, frustum?) → boolean` —
  partial-overlap check using the object's world bounding sphere
  (geometry's local bounding sphere × `matrixWorld`). Objects without
  geometry (e.g. plain `Group` anchor containers) have no bounding sphere
  to test and are treated as visible (`true`). It deliberately does NOT
  call `Frustum.intersectsObject`, which unconditionally dereferences
  `object.geometry.boundingSphere` and therefore throws a `TypeError` for
  geometry-less objects.

## Invariants & assumptions

- Three.js convention: `containsPoint` is strict, `intersectsSphere` /
  `intersectsObject` accept partial overlap. We follow that.
- Caller MUST have run `camera.updateMatrixWorld()` (and the equivalent on
  the object) before calling — normally already the case via
  `renderer.render`.
- The module-level scratch `Frustum`/`Matrix4` are not thread-safe (none
  of Three.js is). Callers doing many checks per frame should call
  `buildCameraFrustum` once and pass the returned `Frustum` to subsequent
  predicates via the optional `frustum` parameter.
- No allocations on the hot path: bounding-sphere computation lazily
  caches into `geometry.boundingSphere` on first use; the per-call
  world-space sphere is a single reused scratch.

## Examples

```ts
import {
  buildCameraFrustum,
  isObjectInCameraFrustum,
} from 'gps-plus-slam-app-framework/visualization';

// Cheapest pattern when checking many objects in one frame:
const frustum = buildCameraFrustum(camera);
for (const anchor of anchors) {
  if (!isObjectInCameraFrustum(camera, anchor.object3D, frustum)) {
    anchor.commitPendingPose();
  }
}
```

## Tests

- [frustum-visibility.test.ts](frustum-visibility.test.ts) — covers all
  three predicates, the inside/outside boundary, the
  injected-frustum-is-reused path (mutates camera, asserts stale frustum
  is honoured), the parent-transform case for `isObjectInCameraFrustum`,
  and the geometry-less `Group` case (asserts it does not throw and is
  treated as in-frustum).
