/**
 * Tests for the recorder-owned reference-point marker helper.
 *
 * Why this test matters: reference points are a RECORDER concept (not a
 * framework one). To keep the live overlay and the session-summary map
 * identical, BOTH call this single helper. The defining behaviour is the
 * prior/current classification: a marker whose own `timestamp` is at or after
 * the recording `startTime` was (re-)observed during THIS session and renders
 * as "current" (red); anything earlier — including imported sidecar points
 * with `timestamp: 0` — renders as "prior" (green). See
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-phase3-plan.md
 * § Step 5 (re-observed-prior rule).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface MarkerCall {
  latLng: unknown;
  options: Record<string, unknown>;
  popup?: unknown;
}
interface DivIconCall {
  options: Record<string, unknown>;
}

let markerCalls: MarkerCall[] = [];
let divIconCalls: DivIconCall[] = [];

vi.mock('leaflet', () => {
  return {
    default: {
      marker: vi.fn((latLng: unknown, options: Record<string, unknown>) => {
        const layer = {
          addTo: vi.fn().mockReturnThis(),
          remove: vi.fn(),
          bindPopup: vi.fn(function (this: unknown, popup: unknown) {
            markerCalls[markerCalls.length - 1]!.popup = popup;
            return this;
          }),
        };
        markerCalls.push({ latLng, options });
        return layer;
      }),
      divIcon: vi.fn((options: Record<string, unknown>) => {
        divIconCalls.push({ options });
        return { _divIcon: true, options };
      }),
    },
  };
});

import {
  drawRefPointMarkers,
  type RefPointMarkerInput,
} from './draw-ref-point-markers';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';

const mapStub = {} as L.Map;

const PRIOR_COLOR = VIS_COLORS.PRIOR_REF_POINT.css;
const CURRENT_COLOR = VIS_COLORS.CURRENT_REF_POINT.css;

beforeEach(() => {
  markerCalls = [];
  divIconCalls = [];
});

describe('drawRefPointMarkers', () => {
  const START = 1000;

  it('draws one marker per reference point at its coordinates', () => {
    const refs: RefPointMarkerInput[] = [
      { lat: 1, lng: 2, name: 'A', timestamp: START + 1 },
      { lat: 3, lng: 4, name: 'B', timestamp: START + 2 },
    ];
    const layers = drawRefPointMarkers(mapStub, refs, START);

    expect(markerCalls).toHaveLength(2);
    expect(markerCalls[0]!.latLng).toEqual([1, 2]);
    expect(markerCalls[1]!.latLng).toEqual([3, 4]);
    expect(layers).toHaveLength(2);
  });

  it('classifies a marker observed at/after startTime as CURRENT (red)', () => {
    drawRefPointMarkers(
      mapStub,
      [{ lat: 1, lng: 2, name: 'Now', timestamp: START }],
      START
    );
    expect(String(divIconCalls[0]!.options.html)).toContain(CURRENT_COLOR);
    const popup = markerCalls[0]!.popup as HTMLElement;
    expect(popup.textContent).toContain('Now');
    expect(popup.textContent).not.toContain('prior');
  });

  it('classifies a marker observed before startTime as PRIOR (green)', () => {
    drawRefPointMarkers(
      mapStub,
      [{ lat: 1, lng: 2, name: 'Old', timestamp: START - 1 }],
      START
    );
    expect(String(divIconCalls[0]!.options.html)).toContain(PRIOR_COLOR);
    const popup = markerCalls[0]!.popup as HTMLElement;
    expect(popup.textContent).toContain('Old');
    expect(popup.textContent).toContain('prior');
  });

  it('treats imported sidecar points (timestamp 0) as PRIOR', () => {
    drawRefPointMarkers(
      mapStub,
      [{ lat: 1, lng: 2, name: 'Imported', timestamp: 0 }],
      START
    );
    expect(String(divIconCalls[0]!.options.html)).toContain(PRIOR_COLOR);
  });

  it('renders a RE-OBSERVED prior point as CURRENT (re-confirmed this session)', () => {
    // A prior point (captured before this recording) plus a later same-location
    // re-observation appended during the recording. Because the flat refPoints
    // slice appends a fresh entry on re-confirmation, the re-observed entry's
    // own timestamp is >= startTime and must classify as current — proving the
    // rule is per-entry timestamp, not per-location aggregation.
    drawRefPointMarkers(
      mapStub,
      [
        { lat: 1, lng: 2, name: 'Bench', timestamp: 0 },
        { lat: 1, lng: 2, name: 'Bench', timestamp: START + 5 },
      ],
      START
    );

    expect(markerCalls).toHaveLength(2);
    expect(String(divIconCalls[0]!.options.html)).toContain(PRIOR_COLOR);
    expect(String(divIconCalls[1]!.options.html)).toContain(CURRENT_COLOR);
  });

  it('builds the popup via the DOM (textContent), never innerHTML', () => {
    // A malicious name must not be interpreted as markup — pin that the popup
    // is a DOM element whose textContent is the literal name.
    const evil = '<img src=x onerror=alert(1)>';
    drawRefPointMarkers(
      mapStub,
      [{ lat: 1, lng: 2, name: evil, timestamp: START }],
      START
    );
    const popup = markerCalls[0]!.popup as HTMLElement;
    expect(popup instanceof HTMLElement).toBe(true);
    expect(popup.textContent).toContain(evil);
  });

  it('returns an empty array for no reference points', () => {
    const layers = drawRefPointMarkers(mapStub, [], START);
    expect(layers).toHaveLength(0);
    expect(markerCalls).toHaveLength(0);
  });

  it('defaults to a 12px dot and honours a custom dotSizePx (F5-A: AR minimap uses 20px)', () => {
    // Why this test matters: the live AR minimap and the summary map share
    // this renderer (2026-07-05 live-map feedback), but F5-A deliberately
    // enlarged AR-map markers for readability — the size must be a parameter
    // of the SAME code path, not a duplicated marker implementation.
    drawRefPointMarkers(
      mapStub,
      [{ lat: 1, lng: 2, name: 'Default', timestamp: START }],
      START
    );
    expect(String(divIconCalls[0]!.options.html)).toContain('width:12px');
    expect(divIconCalls[0]!.options.iconSize).toEqual([16, 16]);

    drawRefPointMarkers(
      mapStub,
      [{ lat: 1, lng: 2, name: 'Big', timestamp: START }],
      START,
      { dotSizePx: 20 }
    );
    expect(String(divIconCalls[1]!.options.html)).toContain('width:20px');
    expect(divIconCalls[1]!.options.iconSize).toEqual([24, 24]);
    expect(divIconCalls[1]!.options.iconAnchor).toEqual([12, 12]);
  });
});
