/**
 * @vitest-environment jsdom
 *
 * Tests for `wireOccupancyGridSubscribers` (2026-06-11 occupancy-grid
 * port plan, Iter 4).
 *
 * Why this test matters:
 * The occupancy grid is derived state fed from the persisted
 * `recording/recordDepthSample` action stream via the framework's
 * `latestDepthSample` observation hook. The wiring must fold every new
 * sample exactly once, throttle visualizer refreshes to ~1 Hz (replay
 * dispatches much faster), clear grid + visualizer on store swap
 * (Start Recording / Replay), and never let a grid/visualizer failure
 * break the store subscription.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import {
  createRecorderStore,
  recordDepthSample,
  recordWriteFailure,
  type DepthSample,
} from '../state/recorder-store';
import { createStoreRef } from '../state/store-ref';
import {
  wireOccupancyGridSubscribers,
  type OccupancyGridSink,
} from './wire-occupancy-grid-subscribers';

function makeSample(timestamp = 1000): DepthSample {
  return {
    timestamp,
    cameraPos: [0, 0, 0],
    cameraRot: [0, 0, 0, 1],
    points: [{ screenX: 0.5, screenY: 0.5, depthM: 2 }],
  };
}

function makeGridSpy() {
  return {
    addSample: vi.fn<(sample: DepthSample) => number>(() => 1),
    clear: vi.fn<() => void>(),
  };
}

function makeVisualizerSpy() {
  return {
    refresh: vi.fn<(grid: OccupancyGridSink) => void>(),
    clear: vi.fn<() => void>(),
  };
}

function makeStore() {
  return createRecorderStore({ storageBackend: new NullStorageBackend() });
}

describe('wireOccupancyGridSubscribers', () => {
  let storeRef: ReturnType<typeof createStoreRef<ReturnType<typeof makeStore>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    storeRef = createStoreRef(makeStore());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('folds each dispatched depth sample into the grid exactly once', () => {
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
    });

    const sample = makeSample();
    storeRef.get().dispatch(recordDepthSample(sample));
    expect(grid.addSample).toHaveBeenCalledTimes(1);
    expect(grid.addSample).toHaveBeenCalledWith(sample);

    // Unrelated dispatches (same latestDepthSample reference) add nothing
    storeRef.get().dispatch(recordWriteFailure('disk full'));
    expect(grid.addSample).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('seeds a sample that was dispatched before wiring', () => {
    const grid = makeGridSpy();
    const sample = makeSample();
    storeRef.get().dispatch(recordDepthSample(sample));

    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer: makeVisualizerSpy(),
    });
    expect(grid.addSample).toHaveBeenCalledWith(sample);
    dispose();
  });

  it('throttles visualizer refreshes: leading edge + one trailing refresh per burst', () => {
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      refreshIntervalMs: 1000,
    });

    // First sample: immediate (leading-edge) refresh with the grid
    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);
    expect(visualizer.refresh).toHaveBeenCalledWith(grid);

    // Burst within the interval: no synchronous refresh...
    storeRef.get().dispatch(recordDepthSample(makeSample(2)));
    storeRef.get().dispatch(recordDepthSample(makeSample(3)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);
    expect(grid.addSample).toHaveBeenCalledTimes(3); // samples are never throttled

    // ...but exactly one trailing refresh when the interval elapses
    vi.advanceTimersByTime(1000);
    expect(visualizer.refresh).toHaveBeenCalledTimes(2);

    // Quiet period over: next sample refreshes immediately again
    vi.advanceTimersByTime(2000);
    storeRef.get().dispatch(recordDepthSample(makeSample(4)));
    expect(visualizer.refresh).toHaveBeenCalledTimes(3);

    dispose();
  });

  it('clears grid and visualizer on store swap and re-attaches to the new store', () => {
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
    });

    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(grid.addSample).toHaveBeenCalledTimes(1);

    const newStore = makeStore();
    storeRef.set(newStore);
    expect(grid.clear).toHaveBeenCalledTimes(1);
    expect(visualizer.clear).toHaveBeenCalledTimes(1);

    // Old store no longer feeds the grid…
    storeRef.get(); // (newStore)
    newStore.dispatch(recordDepthSample(makeSample(2)));
    expect(grid.addSample).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('still clears the visualizer when grid.clear() throws on swap', () => {
    // Why this matters: grid and visualizer clears are independent
    // best-effort. A throwing grid.clear() must not skip visualizer.clear(),
    // otherwise the cube view keeps rendering the now-stale grid after a swap.
    const grid = makeGridSpy();
    grid.clear.mockImplementationOnce(() => {
      throw new Error('clear boom');
    });
    const visualizer = makeVisualizerSpy();
    const onError = vi.fn();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      onError,
    });

    storeRef.set(makeStore());
    expect(grid.clear).toHaveBeenCalledTimes(1);
    expect(visualizer.clear).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('stops processing after dispose', () => {
    const grid = makeGridSpy();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer: makeVisualizerSpy(),
    });
    dispose();

    storeRef.get().dispatch(recordDepthSample(makeSample()));
    expect(grid.addSample).not.toHaveBeenCalled();
  });

  it('reports grid failures via onError and keeps the subscription alive', () => {
    const grid = makeGridSpy();
    grid.addSample.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const visualizer = makeVisualizerSpy();
    const onError = vi.fn();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      onError,
    });

    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(visualizer.refresh).not.toHaveBeenCalled(); // failed sample → no refresh

    // Next sample still flows
    storeRef.get().dispatch(recordDepthSample(makeSample(2)));
    expect(grid.addSample).toHaveBeenCalledTimes(2);
    expect(visualizer.refresh).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('reports visualizer refresh failures via onError without breaking sample flow', () => {
    const grid = makeGridSpy();
    const visualizer = makeVisualizerSpy();
    visualizer.refresh.mockImplementation(() => {
      throw new Error('render boom');
    });
    const onError = vi.fn();
    const dispose = wireOccupancyGridSubscribers({
      storeRef,
      grid,
      visualizer,
      onError,
    });

    storeRef.get().dispatch(recordDepthSample(makeSample(1)));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(grid.addSample).toHaveBeenCalledTimes(1);

    dispose();
  });
});
