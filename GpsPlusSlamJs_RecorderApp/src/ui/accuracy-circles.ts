/**
 * Per-event GPS accuracy circles.
 *
 * The canonical implementation now lives in the app-framework
 * (`gps-plus-slam-app-framework/visualization/accuracy-circles`) so it can be
 * shared with the framework's `map-overlay-draw` module (D4 of the
 * unified-map plan). This file re-exports it to preserve the existing
 * `./accuracy-circles` import path used by `preview-map.ts`.
 *
 * The `AccuracyCircleSample` type is intentionally NOT re-exported here: after
 * the Phase 3 map migration `summary-map.ts` draws accuracy circles through the
 * framework's `drawMapData`, so no recorder module imports the type via this
 * shim. Import it directly from the framework if needed.
 */

// `ACCURACY_CIRCLE_FILL_OPACITY` is intentionally NOT re-exported: accuracy
// circles are stroke-only since 2026-06-28 (Finding 1), so the fill-opacity
// constant is deprecated and unused by any recorder module. Import it directly
// from the framework if ever needed.
export {
  ACCURACY_CIRCLE_STROKE_OPACITY,
  ACCURACY_CIRCLE_WEIGHT,
  addAccuracyCircles,
} from 'gps-plus-slam-app-framework/visualization/accuracy-circles';
