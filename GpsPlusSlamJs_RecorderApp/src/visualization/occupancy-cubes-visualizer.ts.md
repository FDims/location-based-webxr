# occupancy-cubes-visualizer.ts

## Purpose

Renders the AR-space occupancy grid as one `THREE.InstancedMesh` of debug cubes — the TS equivalent of the Unity debug cubes in `ArCursorOnDepthSurface.cs` ("cubes randomly picking points every second"). Refreshed at ~1 Hz by `wireOccupancyGridSubscribers`; draws every occupied cell while under the instance cap and a random subset above it. Per-cell **camera RGB color** when the grid carries one (Iter 8 voxel coloring); height-based ramp as the fallback.

Plan: `GpsPlusSlamJs_Docs/docs/2026-06-11-depth-occupancy-grid-port-plan.md` §3/Iter 5; AR-space reparenting + cube size in Iter 7; RGB coloring in Iter 8.

## Public API

- **`new OccupancyCubesVisualizer(arSpaceNode, options?)`** — `arSpaceNode` is the node that receives the alignment matrix (`arWorldGroup` live, `replaySceneState.arWorldGroup` in replay), injected (never `getArWorldGroup()` inside the class). Options: `maxInstances` (default 2000), `minObservations` (default 1, forwarded to `getOccupiedCells` as the noise filter), `cubeSizeM` (rendered cube edge length, default 0.025 — deliberately much smaller than the 0.15 m grid cell so voxels stay readable; field-tuned down from the initial 0.1 after on-device review), `rng` (default `Math.random`; injected for deterministic tests).
- **`refresh(grid: OccupancyGridSource): void`** — redraw from the grid (cubes at `getCellCenter`, scaled to `cubeSizeM`). Over the cap: unbiased partial Fisher–Yates subset.
- **`clear(): void`** — hides all cubes (count 0); the mesh stays for the next refresh (store-swap path).
- **`dispose(): void`** — removes the mesh from its parent and disposes instance buffers, geometry, material. `refresh` after dispose is a safe no-op.
- **`getCount(): number`** — cubes currently drawn.
- **`OccupancyGridSource`** — the read surface required of the grid (`getOccupiedCells`, `getCellCenter`, `getCellColor`); structurally satisfied by the framework's `OccupancyGrid`.

## Invariants & Assumptions

1. One `InstancedMesh` for all cubes — per-refresh cost is O(drawn cells), no per-cell scene objects.
2. **Coordinate chain:** the grid's cells/centers are **raw WebXR** coordinates, but `arSpaceNode`'s local space is AR-odometry **NUE** — so the mesh node itself carries the constant `WEBXR_TO_NUE` basis change as its local matrix (`matrixAutoUpdate = false`), mirroring `webxr-session.ts`'s `basisChangeNode` for the camera. Cube world pose = `alignment × WEBXR_TO_NUE × cellCenter`, the same chain as the camera. Parenting at the scene root (the original Iter 5 mistake) leaves the cubes East/North-swapped and detached from the alignment — see the hit-test-reticle entry in `GpsPlusSlamJs_Docs/docs/lessons-learned.md`.
3. `frustumCulled = false` — instances spread across the room; per-mesh culling would blink them out.
4. Coloring (Iter 8): `grid.getCellColor(cell)` (0–255 averaged camera color, normalized to 0–1 via `setRGB`) when non-null; otherwise the HSL height ramp blue (≤ −1 m) → red (≥ 3 m) over cell height (raw WebXR Y; Up is Y in both frames). The fallback keeps rgb-off recordings and pre-Iter-8 replays rendering exactly as before.
5. Defensive: out-of-range injected `rng` values skip a pick instead of crashing.

## Examples

```ts
const visualizer = new OccupancyCubesVisualizer(arWorldGroup, {
  maxInstances: 2000,
});
visualizer.refresh(grid); // typically via wireOccupancyGridSubscribers
visualizer.dispose(); // on AR session teardown
```

## Tests

- `occupancy-cubes-visualizer.test.ts` — empty mesh parented under the AR-space node on construction, `WEBXR_TO_NUE` as the mesh local matrix, per-cell instance matrices (center + 0.025 m default scale + `cubeSizeM` override), world pose under a **non-trivial** alignment matrix (rides `alignment × WEBXR_TO_NUE`; identity fixtures would hide a missing basis change), `minObservations` forwarding, deterministic over-cap subset via injected rng, per-cell RGB vs height-ramp fallback (Iter 8), height-color ordering, clear-keeps-mesh, dispose releases resources + no-op refresh afterwards.
