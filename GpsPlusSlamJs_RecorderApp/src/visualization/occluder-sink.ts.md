# occluder-sink.ts

## Purpose

The ONE persistent-occluder wiring shared by live AR (`main.ts`) and replay
(`replay/replay-mode.ts`). Extracted 2026-07-04 (code-health plan step 5) from two
structurally identical ~40-line blocks that had to be edited in lockstep — the review log
repeatedly flagged "keep both sites parallel", which was the tell that they should be one
site. Owns the resource trio (depth-only `OcclusionMesh`, off-thread mesh worker, the
grid-facing sink) **and their teardown**: one `dispose()` replaces the old "null two module
variables in every teardown path" pattern that produced several leak-class review findings.

## Public API

- `createOccluderSink(parent, occupancy, deps?) → OccluderSinkHandle` — build the trio for
  one AR/replay session. The caller decides WHETHER (the `occupancy.persistentOcclusion`
  flag); this factory owns HOW, reading `occluderMeshMode`, `occluderDebugStyle`,
  `occluderRadiusM` and `minConfidence` from the validated options group so live and replay
  can never silently diverge.
- `OccluderSinkHandle` — `{ sink, dispose() }`. `dispose()` releases worker + mesh and turns
  the sink callbacks into no-ops; **idempotent**, safe from any teardown path.
- `OccluderSink` — `{ refresh(grid, pose?), clear() }`, the shape
  `wireOccupancyGridSubscribers`' `occluder` option drives.
- `OccluderSinkDeps` — optional injectable constructors (tests only).

## Invariants & assumptions

- **Meshing policy (unchanged from the two originals):** flat `Int32Array` snapshot into the
  transferable pack path (Step 1.3, 2026-07-03 fps plan); camera-local window when
  `occluderRadiusM > 0` and the pose is finite, unbounded fallback otherwise (a
  tracking-glitch pose degrades gracefully, never blanks the occluder); `getCellPoint` read
  only by the surface-hugging modes; same `minConfidence` floor as cubes/COLMAP.
- **Teardown safety by flag, not module variables:** the sink callbacks run asynchronously
  (throttled refreshes, worker responses) and no-op once disposed — including a **late
  worker response**, which must not resurrect the disposed mesh (pinned by test).
- The factory never checks `persistentOcclusion` — callers gate construction on it.

## Examples

```ts
let handle: OccluderSinkHandle | null = null;
let occluderSink: OccluderSink | undefined;
if (options.occupancy.persistentOcclusion) {
  handle = createOccluderSink(arWorldGroup, options.occupancy);
  occluderSink = handle.sink;
}
wireOccupancyGridSubscribers({ /* … */ occluder: occluderSink });
// teardown (any path):
handle?.dispose();
handle = null;
```

## Tests

- `occluder-sink.test.ts` — construction knobs (mode/debug style/parent), unbounded vs
  windowed snapshot selection, non-finite-pose degradation, geometry application + clear,
  and the dispose contract (idempotent; post-dispose refresh/clear/late-response no-ops).
- The live/replay integration stays covered by `main.occupancy-cubes-wiring.test.ts`
  (mocks `OcclusionMesh` + the worker client by module specifier, which the factory imports
  through the same specifiers).

## Related

- [occluder-mesh-worker-client.ts.md](occluder-mesh-worker-client.ts.md) — the worker the
  sink drives; [wire-occupancy-grid-subscribers.ts.md](wire-occupancy-grid-subscribers.ts.md)
  — the throttled driver of `refresh`; the framework's
  [occlusion-mesh.ts.md](../../../GpsPlusSlamJs_AppFramework/src/visualization/occlusion-mesh.ts.md).
