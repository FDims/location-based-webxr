# AR-Space Occupancy Grid

## Purpose

TS port of the Unity voxel grid (`PointCloudData.cs` in GpsPlusSlamUnity): folds the persisted depth-sample stream (`recording/recordDepthSample`) into a sparse 3D grid of occupied cells in **raw WebXR space**, with free-space carving along each camera→point ray. Plain in-memory class — no THREE/DOM/Redux. Derived state: fed by store subscribers; the action stream remains the persisted source of truth (same pattern as `wire-frame-tile-subscribers` in the RecorderApp).

Plan: `GpsPlusSlamJs_Docs/docs/2026-06-11-depth-occupancy-grid-port-plan.md`.

## Public API

- **`new OccupancyGrid(options?)`** — `cellSizeM` (default 0.15, Unity parity), `carveStopCells` (default 2). Throws `RangeError` on non-positive/non-finite cell size or negative/non-integer carve stop.
- **`addSample(sample: DepthSample): number`** — unprojects each point (`unprojectDepthPoint`), carves free space, increments the point cell's observation count. Returns the number of points added. Points that cannot be unprojected (old recordings without `projectionMatrix`, invalid depth/coords) are skipped; non-finite camera positions skip the whole sample.
- **`getOccupiedCells(minObservations = 1): GridCell[]`** — cells observed at least that often.
- **`cellForPosition(pos): GridCell`** — round-quantization per axis (−0 normalized).
- **`getCellCenter(cell): Vector3`** — `cell · cellSizeM`.
- **`raycast(startPos, endPos, minObservations = 1): Vector3 | null`** — center of the first sufficiently-observed cell on the Bresenham line (port of Unity `TryRaycast`; hook for future cursor/floor-detection parity). Returns `null` for non-finite input or no hit.
- **`clear(): void`** / **`size: number`**.

## Invariants & Assumptions

1. **Raw WebXR frame everywhere** — `DepthSample.cameraPos`/points are raw WebXR (local-floor); no NUE conversion in this pipeline.
2. **Observation counts instead of Unity's render-buffer indices** — WebXR has no per-pixel confidence; `minObservations` is the noise filter.
3. **Carving** — Bresenham from camera cell to point cell, stopping `carveStopCells` dominant-axis steps before the endpoint (depth-noise tolerance). Deliberate deviations from Unity: carving is skipped when camera and point share a cell, and the endpoint cell is never deleted — Unity's carve-then-re-add resets per-cell state ("§2 edge case" in the plan).
4. **`getCellCenter` is round-consistent** (`cell · cellSizeM`) — deliberately NOT Unity's `CellToWorldPos` (+half cell), which is off by half a cell under round-quantization.
5. **Memory** — unbounded `Map` keyed by `"x,y,z"`; same unboundedness as Unity's dictionary (whose far denser field tests never surfaced problems); carving recycles cells in revisited areas.
6. **Replay throughput** — `addSample` is O(points × ray cells); replay re-dispatches faster than 1 Hz but runs on desktop.

## Examples

```ts
const grid = new OccupancyGrid();
storeRef.get().subscribe(() => {
  const sample = selectLatestDepthSample(store.getState());
  if (sample && sample !== last) grid.addSample(sample);
});
const cells = grid.getOccupiedCells(2); // noise-filtered
const hit = grid.raycast(cameraPos, forwardPoint); // cursor placement
```

## Tests

- `occupancy-grid.test.ts` — construction validation, add/skip paths (old recordings, invalid points, non-finite camera), counts, carve-stop protection, same-cell deviation, scene-change carving, center formula, raycast hit/miss/min-observations, clear.
- `occupancy-grid.property.test.ts` — fast-check: quantization↔center within `cellSizeM/2` per axis (guards against Unity's half-cell offset); observed cells survive any repeat observation count (incl. degenerate same-cell case); a nearer on-ray cell is carved iff it is at least `carveStopCells` in front of a deeper observation.
