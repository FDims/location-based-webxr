# `accuracy-circles.ts`

## Purpose

Thin **re-export** of the canonical accuracy-circles helper, which now lives
in the app-framework
(`gps-plus-slam-app-framework/visualization/accuracy-circles`). The
implementation moved there (D4 of the unified-map plan) so it can be shared
with the framework's `map-overlay-draw` module. This file preserves the
existing `./accuracy-circles` import path used by [preview-map.ts](preview-map.ts).
(After the Phase 3 map migration, `summary-map.ts` draws accuracy circles via the
framework's `drawMapData` and no longer imports through this shim.)

## Public API

Re-exports verbatim from the framework module:

- `addAccuracyCircles(map, samples, color): L.Circle[]` — **stroke-only** (no
  fill) since 2026-06-28 (Finding 1).
- `ACCURACY_CIRCLE_STROKE_OPACITY` / `ACCURACY_CIRCLE_WEIGHT`
- `ACCURACY_CIRCLE_FILL_OPACITY` is **not** re-exported here (deprecated +
  unused by any recorder module since circles went stroke-only). It still exists
  on the framework module if ever needed — import it from there directly.

The `AccuracyCircleSample` type is **not** re-exported here (no recorder module
consumes it via this shim); import it directly from the framework if needed.

See the framework sidecar for the full contract and invariants.

## Tests

- [accuracy-circles.test.ts](accuracy-circles.test.ts) — exercises the helper
  through this re-export (integration check that the wiring resolves) plus the
  filtering/style contract.
- The canonical unit tests live next to the implementation in the framework
  (`visualization/accuracy-circles.test.ts`).
