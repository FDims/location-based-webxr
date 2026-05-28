# `ref-point-visualizer.ts`

## Purpose

Recorder-side `RefPointVisualizer` that adapts the recorder's `RefPointMark`
domain type onto the pure-function `syncGpsAnchoredMeshes` reconciler
(prior=green, current=red). Holds one `Map<id, THREE.Mesh>` per colour
between calls plus a single `zeroRef` field; no other state.

## Public API

- `class RefPointVisualizer`
  - `setZeroRef(zero)` / `getZeroRef()`
  - **`syncRefPoints(entries: readonly RefPointEntry[])`** — unified
    entry point for the recorder's flat `selectRefPointEntries`
    selector (Step 5.3 of the 2026-05-27 slice-collapse plan). Reads
    `id` plus `gpsPoint ?? rawGpsPoint` (latitude/longitude/altitude)
    per entry; the fused snapshot is preferred when present, otherwise
    the raw GPS sample is used. Renders all entries in a single colour
    (`VIS_COLORS.CURRENT_REF_POINT`) with mesh name `ref-point-${id}`
    and animates newly-inserted ids with a brief scale-up
    (0.2 → 1.0 over `INSERT_ANIMATION_DURATION_SEC` via
    `registerFrameUpdate`). The per-mesh tick is exposed at
    `mesh.userData.refPointInsertAnimation` so tests can detect that
    the animation was scheduled.
  - `getRefPointCount(): number` — number of meshes managed by
    `syncRefPoints`.
  - `displayPriorRefPoints(marks)` — *legacy*; replaces the prior group;
    marks without `gpsPosition` are skipped. Removed in Step 5 along
    with the recorder `refPoints` slice.
  - `addCurrentRefPoint(mark)` — *legacy*; appends to the current group.
    Removed in Step 5.
  - `clearPriorRefPoints()` / `clearCurrentRefPoints()` / `clearAll()` —
    `clearAll` also clears the unified `syncRefPoints` handles and resets
    the zero ref.
  - `getCounts(): { prior, current }` — *legacy*; counts for the
    prior/current pipelines only. Use `getRefPointCount()` for the
    unified pipeline.
- `const refPointVisualizer` — singleton consumed by
  `recording-session-handlers` and `replay-mode`.

## Invariants & assumptions

- Mesh name format: `ref-point-${id}` (unified) and `prior-ref-${id}` /
  `current-ref-${id}` (legacy, removed in Step 5).
- The insert animation fires **exactly once per id** — a re-render with
  the same id leaves the existing mesh untouched.
- Shared geometry/material lifecycle is owned by the module-level cache
  inside `syncGpsAnchoredMeshes`; the visualizer never disposes GPU
  resources directly.
- Scene access goes through `getScene()` from
  `gps-plus-slam-app-framework/ar/webxr-session`; the scene is then
  injected explicitly into the reconciler (P3 rule 1).
- Frame-loop access goes through `registerFrameUpdate` from
  `gps-plus-slam-app-framework/ar/frame-loop`; the returned unregister
  is invoked when the animation completes so the registry stays bounded.

## Tests

- See [ref-point-visualizer.test.ts](ref-point-visualizer.test.ts). Behavioural tests preserved verbatim across the manager-to-reconciler refactor so the move is provably semantics-preserving.

## Related docs

- [`sync-gps-anchored-meshes.ts`](sync-gps-anchored-meshes.ts.md) — the pure reconciler this class drives.
- [survey § P2](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md) — the manager-retirement rationale.
- [boundary plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md) — Iter 4.
