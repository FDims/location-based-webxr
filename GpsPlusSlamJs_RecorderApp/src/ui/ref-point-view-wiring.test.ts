/**
 * Tests for the AR-scoped ref-point view wiring.
 *
 * Why this test matters: round-3 feedback (2026-07-05) — the ref-point view
 * subscribers (3D spheres + map markers) were owned by the RECORDING session,
 * so in the AR_READY phase (after Enter AR, before the first recording) the
 * Redux store filled with imported points and no view reacted. This module
 * moves ownership to the AR scope: wire once at Enter AR against the current
 * store, RE-WIRE on every store swap via the app's `storeRef` (the canonical
 * swap-survival mechanism, see state/store-ref.ts), tear down at reset. The
 * recording handlers lose the concern entirely.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockWireRefPointSubscribers, mockWireRefPointMapMarkers } = vi.hoisted(
  () => ({
    mockWireRefPointSubscribers: vi.fn(),
    mockWireRefPointMapMarkers: vi.fn(),
  })
);

vi.mock('../state/ref-point-subscribers', () => ({
  wireRefPointSubscribers: mockWireRefPointSubscribers,
}));

vi.mock('./ref-point-map-markers', () => ({
  wireRefPointMapMarkers: mockWireRefPointMapMarkers,
}));

import { wireRefPointViews } from './ref-point-view-wiring';
import { createStoreRef } from '../state/store-ref';
import type { RecorderStore } from '../state/recorder-store';

function makeStore(startTime?: number): RecorderStore {
  return {
    getState: () => ({
      recording: {
        sessionMetadata: startTime !== undefined ? { startTime } : null,
      },
      refPoints: { entries: [] },
      scenario: { currentScenarioName: '' },
    }),
    dispatch: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  } as unknown as RecorderStore;
}

const visualizer = { syncRefPoints: vi.fn() } as never;

describe('wireRefPointViews', () => {
  let unsubscribe3d: ReturnType<typeof vi.fn>;
  let mapWirer: {
    refresh: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    unsubscribe3d = vi.fn();
    mapWirer = { refresh: vi.fn(), unsubscribe: vi.fn() };
    mockWireRefPointSubscribers.mockReturnValue(unsubscribe3d);
    mockWireRefPointMapMarkers.mockReturnValue(mapWirer);
  });

  it('wires both views against the current store immediately', () => {
    const store = makeStore();
    const storeRef = createStoreRef(store);
    const getMap = vi.fn(() => null);

    wireRefPointViews(storeRef, { visualizer, getMap });

    expect(mockWireRefPointSubscribers).toHaveBeenCalledWith(store, visualizer);
    expect(mockWireRefPointMapMarkers).toHaveBeenCalledTimes(1);
    const [storeArg, opts] = mockWireRefPointMapMarkers.mock
      .calls[0] as unknown as [
      unknown,
      { getMap: () => unknown; getStartTime: () => number; dotSizePx?: number },
    ];
    expect(storeArg).toBe(store);
    // F5-A: AR maps use the enlarged 20px markers of the shared renderer.
    expect(opts.dotSizePx).toBe(20);
    expect(opts.getMap).toBeDefined();
  });

  it('re-wires both views when the store swaps (recording start), tearing down the old pair', () => {
    const bootStore = makeStore();
    const storeRef = createStoreRef(bootStore);
    wireRefPointViews(storeRef, { visualizer, getMap: () => null });

    const recordingStore = makeStore(1000);
    storeRef.set(recordingStore);

    expect(unsubscribe3d).toHaveBeenCalledTimes(1);
    expect(mapWirer.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockWireRefPointSubscribers).toHaveBeenLastCalledWith(
      recordingStore,
      visualizer
    );
    expect(mockWireRefPointMapMarkers).toHaveBeenCalledTimes(2);
    expect(mockWireRefPointMapMarkers.mock.calls[1]![0]).toBe(recordingStore);
  });

  it('getStartTime reads the CURRENT store lazily: MAX before a session, the session start after', () => {
    const bootStore = makeStore(); // no sessionMetadata → everything prior/green
    const storeRef = createStoreRef(bootStore);
    wireRefPointViews(storeRef, { visualizer, getMap: () => null });

    const opts = mockWireRefPointMapMarkers.mock.calls[0]![1] as {
      getStartTime: () => number;
    };
    expect(opts.getStartTime()).toBe(Number.MAX_SAFE_INTEGER);

    // After the swap the NEW wiring's getStartTime sees the session start.
    storeRef.set(makeStore(4242));
    const opts2 = mockWireRefPointMapMarkers.mock.calls[1]![1] as {
      getStartTime: () => number;
    };
    expect(opts2.getStartTime()).toBe(4242);
  });

  it('refreshMapMarkers delegates to the CURRENT map wirer (lazy overlay creation hook)', () => {
    const storeRef = createStoreRef(makeStore());
    const wiring = wireRefPointViews(storeRef, {
      visualizer,
      getMap: () => null,
    });

    wiring.refreshMapMarkers();

    expect(mapWirer.refresh).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe tears down the active pair and stops following store swaps', () => {
    const storeRef = createStoreRef(makeStore());
    const wiring = wireRefPointViews(storeRef, {
      visualizer,
      getMap: () => null,
    });

    wiring.unsubscribe();

    expect(unsubscribe3d).toHaveBeenCalledTimes(1);
    expect(mapWirer.unsubscribe).toHaveBeenCalledTimes(1);

    // A later swap must not resurrect the wiring.
    storeRef.set(makeStore(1));
    expect(mockWireRefPointSubscribers).toHaveBeenCalledTimes(1);
    expect(mockWireRefPointMapMarkers).toHaveBeenCalledTimes(1);
  });
});
