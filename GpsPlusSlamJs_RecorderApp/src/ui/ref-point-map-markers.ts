/**
 * Store→map reference-point marker wirer.
 *
 * The single code path that projects the Redux `refPoints` state onto a
 * Leaflet map (2026-07-05 live-map user feedback: the live AR minimap and the
 * session-summary map must visualize ref points IDENTICALLY, with no
 * duplicated marker code):
 *
 * - the **summary map** renders a one-shot snapshot via the shared
 *   {@link drawRefPointMarkers} renderer, fed by
 *   {@link refPointEntriesToMarkerData};
 * - the **live AR minimap** (and the replay minimap) use
 *   {@link wireRefPointMapMarkers}, which subscribes to the store and renders
 *   through the SAME renderer/mapping whenever the entries or the session
 *   start time change.
 *
 * Lives in the RecorderApp because ref points are a recorder concept — the
 * framework's `leaflet-map-overlay` stays ref-point-agnostic and only hands
 * out its `L.Map` via `getLeafletMap()`.
 */

import type L from 'leaflet';
import {
  drawRefPointMarkers,
  type RefPointMarkerInput,
} from './draw-ref-point-markers';
import {
  selectRefPointEntries,
  type RefPointEntry,
} from '../state/ref-points-slice';
import type { RecorderStore } from '../state/recorder-store';

/**
 * Map `refPoints` entries to the shared renderer's input: fused `gpsPoint`
 * preferred over `rawGpsPoint` (fused-at-mark-time is more accurate), `name`
 * falling back to the H3 `id`, `timestamp` passed through for the
 * prior/current classification. The summary snapshot
 * (`referencePointsForMap`) uses this same mapping so both maps plot
 * identical coordinates and labels.
 */
export function refPointEntriesToMarkerData(
  entries: readonly RefPointEntry[]
): RefPointMarkerInput[] {
  return entries.map((rp) => ({
    lat: rp.gpsPoint?.latitude ?? rp.rawGpsPoint.latitude,
    lng: rp.gpsPoint?.longitude ?? rp.rawGpsPoint.longitude,
    name: rp.name ?? rp.id,
    timestamp: rp.timestamp,
  }));
}

/** Dependencies of {@link wireRefPointMapMarkers}. */
export interface WireRefPointMapMarkersOptions {
  /**
   * Late-binding map accessor: the AR minimap is created lazily on the first
   * map toggle, so this may return null/undefined for a while. The creator
   * should call `refresh()` once the map exists.
   */
  getMap: () => L.Map | null | undefined;
  /**
   * Lazy session start time (epoch ms) for the prior/current classification —
   * read from `sessionMetadata.startTime`. Before a session starts, return
   * `Number.MAX_SAFE_INTEGER` so every entry (imported sidecar points use
   * `timestamp: 0`) classifies as prior/green; the `startSession` dispatch
   * triggers a re-render with the real start so this-session captures turn
   * red — the exact classification the summary map applies.
   */
  getStartTime: () => number;
  /** Marker dot diameter forwarded to the shared renderer (F5-A: AR map 20px). */
  dotSizePx?: number;
}

/** Handle returned by {@link wireRefPointMapMarkers}. */
export interface RefPointMapMarkerWirer {
  /** Force a re-render — call after the lazily-created map appears. */
  refresh(): void;
  /** Stop listening and remove all layers this wirer drew. */
  unsubscribe(): void;
}

/**
 * Subscribe to the store and keep ref-point markers on the given Leaflet map
 * in sync with the `refPoints` state, via the shared renderer.
 *
 * Re-renders are diffed on the memoized entries reference and the start-time
 * value — the store fires on every GPS tick during a recording, and redrawing
 * markers each tick would thrash the map. Rendering is remove-then-redraw of
 * this wirer's own layers only (the trajectory layers drawn by the overlay
 * itself are untouched).
 */
export function wireRefPointMapMarkers(
  store: RecorderStore,
  options: WireRefPointMapMarkersOptions
): RefPointMapMarkerWirer {
  let layers: L.Layer[] = [];
  let renderedEntries: readonly RefPointEntry[] | null = null;
  let renderedStartTime: number | null = null;

  const removeLayers = (): void => {
    for (const layer of layers) {
      layer.remove();
    }
    layers = [];
  };

  const render = (): void => {
    removeLayers();
    const entries = selectRefPointEntries(store.getState().refPoints);
    const startTime = options.getStartTime();
    const map = options.getMap();
    if (!map) {
      // Record rendered state ONLY after an actual draw. Recording it against
      // a null map "poisons" the diff guard: the subscriber would treat the
      // state as already drawn and never render after the lazily-created map
      // appears (2026-07-06 round-4 live-map bug). Reset instead, so the
      // state stays "undrawn" and the next store event with a map draws it.
      renderedEntries = null;
      renderedStartTime = null;
      return;
    }
    renderedEntries = entries;
    renderedStartTime = startTime;
    layers = drawRefPointMarkers(
      map,
      refPointEntriesToMarkerData(entries),
      startTime,
      { dotSizePx: options.dotSizePx }
    );
  };

  render();

  const unsubscribeStore = store.subscribe(() => {
    const entries = selectRefPointEntries(store.getState().refPoints);
    const startTime = options.getStartTime();
    if (entries !== renderedEntries || startTime !== renderedStartTime) {
      render();
    }
  });

  return {
    refresh: render,
    unsubscribe: (): void => {
      unsubscribeStore();
      removeLayers();
    },
  };
}
