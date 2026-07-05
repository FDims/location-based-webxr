# `draw-ref-point-markers.ts`

## Purpose

Recorder-owned helper that draws reference-point markers onto a Leaflet map.
Reference points are a **recorder** concept; the shared framework overlay
module ([map-overlay-draw.ts](../../../GpsPlusSlamJs_AppFramework/src/visualization/map-overlay-draw.ts))
is deliberately ref-point-agnostic. The 2D session-summary map
([summary-map.ts](summary-map.ts)) calls this helper directly, and the
live/replay AR minimaps render through it via the store-driven
[ref-point-map-markers.ts](ref-point-map-markers.ts) wirer — one renderer,
so the maps cannot diverge (2026-07-05 live-map feedback closed the gap where
only the summary map actually used it). See the
[Phase 3 plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-phase3-plan.md)
§ Step 5.

## Public API

- `drawRefPointMarkers(map, refPoints, startTime, options?): L.Layer[]` —
  draws one labelled marker per ref point and returns the layers (input
  order) for cleanup.
- `interface RefPointMarkerInput` — `{ lat, lng, name, timestamp }`.
- `interface DrawRefPointMarkerOptions` — `{ dotSizePx?: number }` (default
  12, the summary-map size). The live/replay AR minimap passes 20: F5-A
  (2026-06-05 feedback) enlarged in-AR map markers for readability, and the
  size is a parameter of this SHARED renderer rather than a duplicated
  marker implementation (2026-07-05 live-map feedback).

The prior (green) / current (red) marker colors are module-private constants
sourced from the framework's `vis-colors.ts` (`VIS_COLORS.PRIOR_REF_POINT` /
`VIS_COLORS.CURRENT_REF_POINT`).

## Invariants & assumptions

- **Prior/current classification is per-marker, by timestamp:**
  `timestamp >= startTime` → **current** (red, `📍 name`);
  `timestamp < startTime` → **prior** (green, `📌 name (prior)`).
- **Re-observed prior points render as current.** Re-confirming a point this
  session appends a fresh `refPoints` entry whose `timestamp >= startTime`, so
  it classifies as current automatically — no per-location aggregation.
- **Imported sidecar points** use `timestamp: 0`, so they classify as prior.
- Popups are built with the DOM API (`textContent`), never `innerHTML`, so a
  malicious ref-point name cannot inject markup.
- The helper does **not** create/fit the map or manage bounds — the caller owns
  those (the summary map extends its own bounds with the ref coordinates).

## Examples

```ts
const layers = drawRefPointMarkers(
  map,
  entries.map((e) => ({
    lat: e.rawGpsPoint.latitude,
    lng: e.rawGpsPoint.longitude,
    name: e.name ?? e.id,
    timestamp: e.timestamp,
  })),
  sessionStartTime
);
// later: layers.forEach((l) => l.remove());
```

## Tests

- [draw-ref-point-markers.test.ts](draw-ref-point-markers.test.ts) — marker per
  point, prior/current classification (incl. the boundary at `startTime`),
  imported `timestamp: 0` ⇒ prior, the re-observed-prior ⇒ current rule, the
  DOM-built (non-`innerHTML`) popup, and the empty-input case.
