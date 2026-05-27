/**
 * Tests for wireRefPointSubscribers.
 *
 * Step 4 of 2026-05-27-collapse-refpoint-and-frame-slices-plan.md migrated
 * this subscriber onto the canonical `selectReferencePoints` selector from
 * the library. The wirer must call `visualizer.syncRefPoints` once on
 * attach (initial sync) and exactly once per change of the selector's
 * memoised result, and must not fire when the selector returns the same
 * reference twice in a row.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ReferencePoint } from 'gps-plus-slam-app-framework/core';
import { wireRefPointSubscribers } from './ref-point-subscribers';
import type { RecorderStore } from './recorder-store';

interface MockState {
  // Only the shape the selector reads from. `gpsData` may be null before
  // setZeroPos initialises the library reducer.
  gpsData: { referencePoints: readonly ReferencePoint[] } | null;
}

function makeRefPoint(id: string, timestamp = 0): ReferencePoint {
  return {
    id,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    gpsPoint: {
      id: `gps-${id}`,
      latitude: 50,
      longitude: 8,
      altitude: 245,
      timestamp,
      zeroRef: { lat: 50, lon: 8 },
      coordinates: [0, 0, 0],
      weight: 1,
    },
    timestamp,
  };
}

function makeMockStore(initial: MockState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const store = {
    getState: () => state as unknown as ReturnType<RecorderStore['getState']>,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const setState = (next: MockState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  return { store: store as unknown as RecorderStore, setState };
}

function makeVisualizer() {
  return {
    syncRefPoints: vi.fn(),
  };
}

describe('wireRefPointSubscribers', () => {
  it('performs an initial sync on attach', () => {
    const v = makeVisualizer();
    const a = makeRefPoint('a', 1);
    const { store } = makeMockStore({
      gpsData: { referencePoints: [a] },
    });

    wireRefPointSubscribers(store, v);

    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);
    expect(v.syncRefPoints).toHaveBeenLastCalledWith([a]);
  });

  it('syncs again when the selector result reference changes', () => {
    const v = makeVisualizer();
    const { store, setState } = makeMockStore({
      gpsData: { referencePoints: [] },
    });
    wireRefPointSubscribers(store, v);
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);

    const a = makeRefPoint('a', 1);
    setState({ gpsData: { referencePoints: [a] } });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(2);
    expect(v.syncRefPoints).toHaveBeenLastCalledWith([a]);

    const b = makeRefPoint('b', 2);
    setState({ gpsData: { referencePoints: [a, b] } });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(3);
    expect(v.syncRefPoints).toHaveBeenLastCalledWith([a, b]);
  });

  it('does not sync when the selector returns the same reference', () => {
    const v = makeVisualizer();
    const gpsData = { referencePoints: [makeRefPoint('a', 1)] };
    const { store, setState } = makeMockStore({ gpsData });
    wireRefPointSubscribers(store, v);
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);

    // Top-level state object changes but `gpsData` reference is reused →
    // `selectReferencePoints` (a `createSelector`) returns the same
    // memoised array, so the wirer must not re-dispatch.
    setState({ gpsData });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);

    setState({ gpsData });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when visualizer is null', () => {
    const { store, setState } = makeMockStore({
      gpsData: { referencePoints: [] },
    });
    const unsubscribe = wireRefPointSubscribers(store, null);
    expect(typeof unsubscribe).toBe('function');
    expect(() => {
      setState({
        gpsData: { referencePoints: [makeRefPoint('x', 1)] },
      });
    }).not.toThrow();
    unsubscribe();
  });

  it('returned unsubscribe detaches the store listener', () => {
    const v = makeVisualizer();
    const { store, setState } = makeMockStore({
      gpsData: { referencePoints: [] },
    });
    const unsubscribe = wireRefPointSubscribers(store, v);
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);
    unsubscribe();

    setState({
      gpsData: { referencePoints: [makeRefPoint('p', 1)] },
    });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);
  });
});
