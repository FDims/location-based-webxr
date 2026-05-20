# gps-accuracy-ellipsoid.spec.js

## Purpose

End-to-end verification of §3c from the rec31 altitude-drop investigation
(see [../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-19-investigate-rec31-altitude-drop.md](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-19-investigate-rec31-altitude-drop.md)).

Confirms the accuracy-aware raw-GPS marker actually renders at the expected
world-space size in a real browser: a `latLongAccuracy = 40 m` event must
produce a bounding box roughly 8× larger than a `latLongAccuracy = 5 m`
event when both are placed at the same world position.

## What is asserted

- The new test hooks (`addGpsEventForTest`, `getRawGpsMarkerWorldSizes`) are exposed in dev mode.
- High-accuracy event → bbox ≈ 80 m × 80 m × 80 m (tolerance 70–90 m).
- Low-accuracy event → bbox ≈ 10 m × 10 m × 10 m (tolerance 8–12 m).
- Ratio between the two ≈ 8 (tolerance 6–10) on every axis — the actual user-visible diagnostic.
- Missing accuracy → legacy fixed 8 cm sphere (bbox ≈ 16 cm, tolerance 0.1–0.2 m).
- Asymmetric `{ horizontal: 3, vertical: 30 }` → tall narrow ellipsoid (y/x ratio ≈ 10).

## Why bounding boxes, not pixel diffs

Pixel comparisons are brittle across renderers, CI agents, and hardware. The
`THREE.Box3.setFromObject` math is the invariant the visualizer actually
guarantees, and it stays stable across environments.

## Related files

- [../src/visualization/gps-event-markers.ts](../../../GpsPlusSlamJs_AppFramework/src/visualization/gps-event-markers.ts) — `addGpsEvent`, `getRawMarkerWorldSizes`
- [../src/state/store-subscribers.ts](../../../GpsPlusSlamJs_AppFramework/src/state/store-subscribers.ts) — `showAccuracySpheres` flag
- [../src/main.ts](../src/main.ts) — `window.testHooks.addGpsEventForTest` / `getRawGpsMarkerWorldSizes`
