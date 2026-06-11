# 3D Bresenham Line Tracer

## Purpose

Walks integer grid cells from a start to an end cell, invoking a visitor per cell. Direct port of the Unity occupancy-grid helper (`PointCloudHelpers.BresenhamsLineAlgorithm`); used by `occupancy-grid.ts` for free-space carving and raycasting.

## Public API

- **`GridCell`** — `readonly [number, number, number]`, integer cell coordinates.
- **`bresenham3d(start, end, visitCell, stopDistance = 0): void`**
  - `visitCell(cell) => boolean` — return `false` to stop the trace early.
  - `stopDistance` — dominant-axis (Chebyshev) steps before `end` at which the trace stops.
  - Throws `TypeError` for non-integer coordinates (programmer error — quantize first).

## Invariants & Assumptions (Unity parity, pinned by tests)

1. The visitor runs on the **start cell before the stop-distance check** — even when `stopDistance ≥` line length, the start cell is visited.
2. With `stopDistance = 0` the trace visits exactly `chebyshev(start, end) + 1` cells, starting at `start`, ending at `end`, every step within unit Chebyshev distance.
3. With `stopDistance = s` it visits `max(1, dm − s + 1)` cells; all but the unconditional start visit keep at least `s` dominant-axis steps from `end`.
4. Error offsets use integer arithmetic (`floor(dm/2)`), so traces are bit-identical to the C# original.

## Examples

```ts
bresenham3d([0, 0, 0], [4, 2, 1], (cell) => {
  console.log(cell); // [0,0,0] [1,0,0] [2,1,0] [3,1,1] [4,2,1]
  return true; // continue
});
```

## Tests

- `bresenham3d.test.ts` — known traces (axes, diagonal, negative, mixed slope vs. hand-stepped Unity arithmetic), stop-distance semantics, early visitor exit, integer validation.
- `bresenham3d.property.test.ts` — fast-check invariants 2 and 3 above over random cells.
