/**
 * Recorder-owned reference-point marker helper.
 *
 * Reference points are a RECORDER concept, not a framework one. To keep the
 * live/replay 3D map overlay and the 2D session-summary map identical, BOTH
 * draw their ref-point markers through this single helper rather than through
 * the shared framework overlay module (which is deliberately
 * ref-point-agnostic). See
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-phase3-plan.md
 * § Step 5.
 *
 * Prior vs. current is derived from each marker's OWN `timestamp` relative to
 * the recording `startTime`:
 *   - `timestamp >= startTime` → "current" (red): observed during THIS session.
 *   - `timestamp <  startTime` → "prior" (green): pre-existed this session.
 *
 * Re-observed prior points render as "current": re-confirming a point this
 * session appends a fresh `refPoints` entry whose timestamp is `>= startTime`,
 * so it classifies as current automatically (no per-location aggregation).
 * Imported sidecar points use `timestamp: 0`, so they classify as prior for
 * free.
 */

import L from 'leaflet';
import type { GpsCoord } from 'gps-plus-slam-app-framework/types/geo-types';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';

// ============================================================================
// Types
// ============================================================================

/** A reference point to draw, carrying the capture `timestamp` used to
 * classify it as prior or current. */
export interface RefPointMarkerInput extends GpsCoord {
  /** Human-readable label shown in the popup. */
  readonly name: string;
  /** Capture time (epoch ms). Compared against the recording `startTime`. */
  readonly timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Prior reference-point marker color (green). */
const PRIOR_REF_POINT_COLOR = VIS_COLORS.PRIOR_REF_POINT.css;
/** Current reference-point marker color (red). */
const CURRENT_REF_POINT_COLOR = VIS_COLORS.CURRENT_REF_POINT.css;

// ============================================================================
// Implementation
// ============================================================================

/** Rendering options for {@link drawRefPointMarkers}. */
export interface DrawRefPointMarkerOptions {
  /**
   * Diameter of the marker dot in px (default 12 — the summary-map size).
   * The AR minimap passes 20: F5-A (2026-06-05 feedback) deliberately
   * enlarged in-AR map markers for readability, and the size is a parameter
   * of this SHARED renderer so both maps stay on one code path
   * (2026-07-05 live-map feedback).
   */
  readonly dotSizePx?: number;
}

/**
 * Draw labelled reference-point markers onto an existing Leaflet map.
 *
 * @param map - Target map (already created with a tile layer by the caller).
 * @param refPoints - Reference points with `timestamp` for classification.
 * @param startTime - Recording start time (epoch ms). Points at/after this are
 *   "current"; earlier points are "prior".
 * @param options - Optional rendering tweaks (see {@link DrawRefPointMarkerOptions}).
 * @returns The created marker layers, in input order, for later cleanup.
 */
export function drawRefPointMarkers(
  map: L.Map,
  refPoints: readonly RefPointMarkerInput[],
  startTime: number,
  options: DrawRefPointMarkerOptions = {}
): L.Layer[] {
  const layers: L.Layer[] = [];
  const dotSizePx = options.dotSizePx ?? 12;
  // Icon box = dot + the 2px white border on each side.
  const iconSizePx = dotSizePx + 4;

  for (const refPoint of refPoints) {
    const isPrior = refPoint.timestamp < startTime;
    const color = isPrior ? PRIOR_REF_POINT_COLOR : CURRENT_REF_POINT_COLOR;
    const opacity = isPrior ? 'opacity:0.8;' : '';

    const icon = L.divIcon({
      className: 'map-ref-point',
      html: `<div style="background:${color};width:${dotSizePx}px;height:${dotSizePx}px;border-radius:50%;border:2px solid white;${opacity}"></div>`,
      iconSize: [iconSizePx, iconSizePx],
      iconAnchor: [iconSizePx / 2, iconSizePx / 2],
    });

    // Build popup content via the DOM API (no innerHTML) so a malicious
    // reference-point name cannot inject markup.
    const popupContent = document.createElement('b');
    popupContent.textContent = isPrior
      ? `📌 ${refPoint.name} (prior)`
      : `📍 ${refPoint.name}`;

    const marker = L.marker([refPoint.lat, refPoint.lng], { icon })
      .bindPopup(popupContent)
      .addTo(map);
    layers.push(marker);
  }

  return layers;
}
