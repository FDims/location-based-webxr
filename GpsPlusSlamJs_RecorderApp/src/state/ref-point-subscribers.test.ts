/**
 * Tests for wireRefPointSubscribers.
 *
 * Step 5.3 of 2026-05-27-collapse-refpoint-and-frame-slices-plan.md
 * migrated this subscriber from the library's `selectReferencePoints`
 * onto the recorder-side flat `selectRefPointEntries` selector
 * (`state.refPoints.entries`). The wirer must call
 * `visualizer.syncRefPoints` once on attach (initial sync) and exactly
 * once per change of the selector's memoised result, and must not fire
 * when the selector returns the same reference twice in a row.
 */

import { describe, it, expect, vi } from 'vitest';
import { wireRefPointSubscribers } from './ref-point-subscribers';
import type { RecorderStore } from './recorder-store';
import type { RefPointEntry } from './ref-points-slice';

interface MockState {
  // Only the shape the selector reads from.
  refPoints: { entries: readonly RefPointEntry[] };
}

function makeEntry(id: string, timestamp = 0): RefPointEntry {
  return {
    id,
    timestamp,
    rawGpsPoint: {
      id: `gps-${id}`,
      latitude: 50,
      longitude: 8,
      altitude: 245,
      timestamp,
    },
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
    const a = makeEntry('a', 1);
    const { store } = makeMockStore({
      refPoints: { entries: [a] },
    });

    wireRefPointSubscribers(store, v);

    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);
    expect(v.syncRefPoints).toHaveBeenLastCalledWith([a]);
  });

  it('syncs again when the selector result reference changes', () => {
    const v = makeVisualizer();
    const { store, setState } = makeMockStore({
      refPoints: { entries: [] },
    });
    wireRefPointSubscribers(store, v);
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);

    const a = makeEntry('a', 1);
    setState({ refPoints: { entries: [a] } });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(2);
    expect(v.syncRefPoints).toHaveBeenLastCalledWith([a]);

    const b = makeEntry('b', 2);
    setState({ refPoints: { entries: [a, b] } });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(3);
    expect(v.syncRefPoints).toHaveBeenLastCalledWith([a, b]);
  });

  it('does not sync when the selector returns the same reference', () => {
    const v = makeVisualizer();
    const refPoints = { entries: [makeEntry('a', 1)] };
    const { store, setState } = makeMockStore({ refPoints });
    wireRefPointSubscribers(store, v);
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);

    // Top-level state object changes but `refPoints` reference is
    // reused → `selectRefPointEntries` (a `createSelector`) returns the
    // same memoised array, so the wirer must not re-dispatch.
    setState({ refPoints });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);

    setState({ refPoints });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when visualizer is null', () => {
    const { store, setState } = makeMockStore({
      refPoints: { entries: [] },
    });
    const unsubscribe = wireRefPointSubscribers(store, null);
    expect(typeof unsubscribe).toBe('function');
    expect(() => {
      setState({
        refPoints: { entries: [makeEntry('x', 1)] },
      });
    }).not.toThrow();
    unsubscribe();
  });

  it('returned unsubscribe detaches the store listener', () => {
    const v = makeVisualizer();
    const { store, setState } = makeMockStore({
      refPoints: { entries: [] },
    });
    const unsubscribe = wireRefPointSubscribers(store, v);
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);
    unsubscribe();

    setState({
      refPoints: { entries: [makeEntry('p', 1)] },
    });
    expect(v.syncRefPoints).toHaveBeenCalledTimes(1);
  });
});
