# wire-occupancy-grid-subscribers.ts

## Purpose

Wires the AR-space occupancy grid (framework `OccupancyGrid`) to the recorder store: observes `state.recording.latestDepthSample` by reference comparison, folds each new depth sample into the injected grid, and refreshes the injected cube visualizer at a throttled ~1 Hz. Follows `wire-frame-tile-subscribers.ts` (action stream = persisted source of truth, grid = derived state outside Redux) and the F1 `StoreRef` store-swap pattern.

Plan: `GpsPlusSlamJs_Docs/docs/2026-06-11-depth-occupancy-grid-port-plan.md` §3/Iter 4.

## Public API

- **`wireOccupancyGridSubscribers(options): () => void`** — attaches; returns a dispose function (detaches store subscription, swap listener, pending refresh timer).
  - `storeRef: StoreRef<RecorderStore>` — re-attaches on store swap (Start Recording / Replay); on swap both grid and visualizer are cleared and the throttle resets.
  - `grid: TGrid extends OccupancyGridSink` — `{ addSample(sample), clear() }`.
  - `visualizer: { refresh(grid: TGrid), clear() }` — injected, typically `OccupancyCubesVisualizer`.
  - `refreshIntervalMs?` — default 1000.
  - `onError?(err)` — receives grid/visualizer failures; the subscription itself never breaks.
- **`OccupancyGridSink`** — the grid surface this wirer needs.

## Invariants & Assumptions

1. **Every sample folds exactly once** — reference comparison on `latestDepthSample`; unrelated dispatches are no-ops. A sample already present at attach time is seeded once.
2. **Samples are never throttled — only refreshes are.** Leading-edge + trailing-edge throttle: first sample after a quiet period refreshes immediately; bursts (replay re-dispatches much faster than 1 Hz) coalesce into one trailing refresh per interval, so the final state always renders.
3. **Best-effort:** `addSample`/`refresh`/`clear` failures go to `onError`; a failed `addSample` skips that refresh but later samples still flow. On swap, `grid.clear()` and `visualizer.clear()` are **independent** best-effort calls — a throwing `grid.clear()` still runs `visualizer.clear()`, so the cube view never keeps rendering a stale grid.
4. Uses `Date.now()` + `setTimeout` (fake-timer friendly).

## Examples

```ts
const grid = new OccupancyGrid();
// arWorldGroup, NOT the scene root — the cells are raw-WebXR coordinates
// that must ride the alignment matrix (port plan Iter 7).
const visualizer = new OccupancyCubesVisualizer(arWorldGroup);
const dispose = wireOccupancyGridSubscribers({
  storeRef,
  grid,
  visualizer,
  onError: (err) => log.warn('occupancy grid error', err),
});
```

## Tests

- `wire-occupancy-grid-subscribers.test.ts` — exact-once folding, pre-wiring seed, leading+trailing throttle behavior (fake timers), store-swap clearing + re-attach, dispose, and both error paths.
