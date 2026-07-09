/**
 * Tests for the store→map ref-point marker wirer.
 *
 * Why this test matters: the 2026-07-05 live-map feedback requires the SAME
 * code module that visualizes the Redux `refPoints` state to be active on
 * BOTH maps (the live AR minimap and the session-summary map) — the wirer is
 * that module for the live map, rendering via the shared
 * `drawRefPointMarkers` renderer whenever the entries (or the session start
 * time) change, tolerating the minimap's lazy creation, and cleaning up its
 * own layers on unsubscribe. Re-rendering must be diffed (entries reference /
 * startTime value), because the store fires on every GPS tick during a
 * recording.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface MarkerLayer {
  addTo: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  bindPopup: ReturnType<typeof vi.fn>;
}

let createdLayers: MarkerLayer[] = [];
let divIconHtml: string[] = [];

vi.mock('leaflet', () => ({
  default: {
    marker: vi.fn(() => {
      const layer: MarkerLayer = {
        addTo: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        bindPopup: vi.fn().mockReturnThis(),
      };
      createdLayers.push(layer);
      return layer;
    }),
    divIcon: vi.fn((options: { html?: unknown }) => {
      divIconHtml.push(String(options.html));
      return { _divIcon: true };
    }),
  },
}));

import {
  refPointEntriesToMarkerData,
  wireRefPointMapMarkers,
} from './ref-point-map-markers';
import type { RefPointEntry } from '../state/ref-points-slice';
import type { RecorderStore } from '../state/recorder-store';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';

const PRIOR_COLOR = VIS_COLORS.PRIOR_REF_POINT.css;
const CURRENT_COLOR = VIS_COLORS.CURRENT_REF_POINT.css;

function entry(
  id: string,
  timestamp: number,
  overrides: Partial<RefPointEntry> = {}
): RefPointEntry {
  return {
    id,
    timestamp,
    rawGpsPoint: {
      id: `gps-${id}`,
      latitude: 49,
      longitude: 8,
      timestamp,
    },
    ...overrides,
  };
}

/**
 * Minimal fake store: real `selectRefPointEntries` memoization semantics are
 * preserved because `setEntries` swaps the entries array reference while
 * `touchUnrelated` keeps the same `refPoints` object (as a GPS tick would).
 */
function createFakeStore(initialEntries: RefPointEntry[]) {
  let state = { refPoints: { entries: initialEntries } };
  const listeners = new Set<() => void>();
  return {
    store: {
      getState: () => state,
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      dispatch: vi.fn(),
    } as unknown as RecorderStore,
    setEntries(entries: RefPointEntry[]) {
      state = { refPoints: { entries } };
      listeners.forEach((fn) => fn());
    },
    touchUnrelated() {
      state = { ...state };
      listeners.forEach((fn) => fn());
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

const mapStub = {} as L.Map;

beforeEach(() => {
  createdLayers = [];
  divIconHtml = [];
});

describe('refPointEntriesToMarkerData', () => {
  it('prefers the fused gpsPoint over rawGpsPoint and falls back to the id as name', () => {
    // Same mapping the summary snapshot used inline before extraction — the
    // summary map and the live map must plot identical coordinates/labels.
    const withFused = entry('cell-a', 5, {
      name: 'Bench',
      gpsPoint: {
        id: 'gps-fused',
        latitude: 50.5,
        longitude: 8.5,
        timestamp: 5,
      },
    });
    const rawOnly = entry('cell-b', 7);

    expect(refPointEntriesToMarkerData([withFused, rawOnly])).toEqual([
      { lat: 50.5, lng: 8.5, name: 'Bench', timestamp: 5 },
      { lat: 49, lng: 8, name: 'cell-b', timestamp: 7 },
    ]);
  });
});

describe('wireRefPointMapMarkers', () => {
  it('renders the current entries immediately when the map already exists', () => {
    const { store } = createFakeStore([entry('cell-a', 0)]);

    wireRefPointMapMarkers(store, {
      getMap: () => mapStub,
      getStartTime: () => 1000,
    });

    expect(createdLayers).toHaveLength(1);
    expect(divIconHtml[0]).toContain(PRIOR_COLOR);
  });

  it('re-renders (remove then redraw) when the entries change', () => {
    const fake = createFakeStore([entry('cell-a', 0)]);
    wireRefPointMapMarkers(fake.store, {
      getMap: () => mapStub,
      getStartTime: () => 1000,
    });
    const firstLayer = createdLayers[0]!;

    fake.setEntries([entry('cell-a', 0), entry('cell-b', 2000)]);

    expect(firstLayer.remove).toHaveBeenCalledTimes(1);
    // 1 initial + 2 redrawn
    expect(createdLayers).toHaveLength(3);
    expect(divIconHtml[2]).toContain(CURRENT_COLOR);
  });

  it('does NOT re-render on unrelated store changes (GPS ticks)', () => {
    const fake = createFakeStore([entry('cell-a', 0)]);
    wireRefPointMapMarkers(fake.store, {
      getMap: () => mapStub,
      getStartTime: () => 1000,
    });

    fake.touchUnrelated();
    fake.touchUnrelated();

    expect(createdLayers).toHaveLength(1);
    expect(createdLayers[0]!.remove).not.toHaveBeenCalled();
  });

  it('re-classifies when the session start time changes (green before start → red after)', () => {
    // Wired before the startSession dispatch: with no session, everything is
    // prior/green. The dispatch changes getStartTime's value; the next store
    // event must re-render with the real start so this-session captures turn
    // red — same classification the summary map applies.
    let startTime = Number.MAX_SAFE_INTEGER;
    const fake = createFakeStore([entry('cell-a', 5000)]);
    wireRefPointMapMarkers(fake.store, {
      getMap: () => mapStub,
      getStartTime: () => startTime,
    });
    expect(divIconHtml[0]).toContain(PRIOR_COLOR);

    startTime = 4000;
    fake.touchUnrelated();

    expect(divIconHtml[1]).toContain(CURRENT_COLOR);
  });

  it('tolerates a missing map and renders once refresh() is called after lazy creation', () => {
    // The AR minimap is created lazily on the first #btn-map toggle — the
    // wirer must not crash beforehand and must render when the creator calls
    // refresh().
    let map: L.Map | null = null;
    const fake = createFakeStore([entry('cell-a', 0)]);
    const wirer = wireRefPointMapMarkers(fake.store, {
      getMap: () => map,
      getStartTime: () => 1000,
    });
    expect(createdLayers).toHaveLength(0);

    map = mapStub;
    wirer.refresh();

    expect(createdLayers).toHaveLength(1);
  });

  it('renders on the next store event after the map appears, even when the last entries change happened while the map was null (poisoned-guard regression)', () => {
    // Reproduces Bug 1 of the 2026-07-06 round-4 feedback: the imported
    // entries were dispatched BEFORE the minimap existed, then
    // handleToggleMap called refresh() against a still-null map. render()
    // used to record renderedEntries/renderedStartTime before the null-map
    // guard, so the subscriber's diff check treated the state as already
    // drawn and the live map stayed empty for the whole recording.
    let map: L.Map | null = null;
    const fake = createFakeStore([entry('cell-a', 0)]);
    const wirer = wireRefPointMapMarkers(fake.store, {
      getMap: () => map,
      getStartTime: () => 1000,
    });
    // The real flow: handleToggleMap refreshes before the map exists.
    wirer.refresh();
    expect(createdLayers).toHaveLength(0);

    map = mapStub;
    // A GPS tick: same memoized entries reference, same start time.
    fake.touchUnrelated();

    expect(createdLayers).toHaveLength(1);
  });

  it('does not record rendered state on null-map renders (repeated events stay cheap no-ops, then a single draw)', () => {
    // Companion to the poisoned-guard regression: while the map is null the
    // wirer must neither crash nor draw, and once the map exists exactly one
    // store event must produce exactly one draw of the current entries.
    let map: L.Map | null = null;
    const fake = createFakeStore([entry('cell-a', 0)]);
    wireRefPointMapMarkers(fake.store, {
      getMap: () => map,
      getStartTime: () => 1000,
    });

    fake.touchUnrelated();
    fake.touchUnrelated();
    fake.setEntries([entry('cell-a', 0), entry('cell-b', 2000)]);
    expect(createdLayers).toHaveLength(0);

    map = mapStub;
    fake.touchUnrelated();

    expect(createdLayers).toHaveLength(2);
  });

  it('forwards dotSizePx to the shared renderer (F5-A AR readability)', () => {
    const { store } = createFakeStore([entry('cell-a', 0)]);
    wireRefPointMapMarkers(store, {
      getMap: () => mapStub,
      getStartTime: () => 1000,
      dotSizePx: 20,
    });
    expect(divIconHtml[0]).toContain('width:20px');
  });

  it('unsubscribe removes its layers and stops reacting to store changes', () => {
    const fake = createFakeStore([entry('cell-a', 0)]);
    const wirer = wireRefPointMapMarkers(fake.store, {
      getMap: () => mapStub,
      getStartTime: () => 1000,
    });

    wirer.unsubscribe();

    expect(createdLayers[0]!.remove).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount).toBe(0);
    fake.setEntries([entry('cell-b', 1)]);
    expect(createdLayers).toHaveLength(1);
  });
});
