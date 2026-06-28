/**
 * Preview Map Component — Unit Tests
 *
 * TDD tests for the lightweight Leaflet preview map shown in the replay
 * setup screen. When the user selects a recording session, this map
 * displays the raw GPS path as a yellow polyline so they can see where
 * the recording took place before starting replay.
 *
 * Why this test matters:
 * User feedback (Issue #1, 2026-03-23) requested a 2D map preview of
 * the raw GPS path on the replay setup screen.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Track mock instances for assertions
let lastMapInstance: {
  remove: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  setView: ReturnType<typeof vi.fn>;
  invalidateSize: ReturnType<typeof vi.fn>;
};
let polylineCalls: Array<{ latLngs: unknown; options: unknown }> = [];
let tileLayerCalls: Array<{ url: unknown; options: unknown }> = [];
let circleCalls: Array<{ latLng: unknown; options: unknown }> = [];

// Mock Leaflet before importing the module under test
vi.mock('leaflet', () => {
  return {
    default: {
      map: vi.fn(() => {
        lastMapInstance = {
          remove: vi.fn(),
          fitBounds: vi.fn(),
          setView: vi.fn().mockReturnThis(),
          invalidateSize: vi.fn(),
        };
        return lastMapInstance;
      }),
      tileLayer: vi.fn((url: unknown, options: unknown) => {
        tileLayerCalls.push({ url, options });
        return {
          addTo: vi.fn().mockReturnThis(),
          remove: vi.fn(),
        };
      }),
      polyline: vi.fn((latLngs: unknown, options: unknown) => {
        polylineCalls.push({ latLngs, options });
        return {
          addTo: vi.fn().mockReturnThis(),
          remove: vi.fn(),
        };
      }),
      circle: vi.fn((latLng: unknown, options: unknown) => {
        circleCalls.push({ latLng, options });
        return {
          addTo: vi.fn().mockReturnThis(),
          remove: vi.fn(),
        };
      }),
      latLngBounds: vi.fn(() => ({
        isValid: vi.fn().mockReturnValue(true),
        extend: vi.fn().mockReturnThis(),
      })),
    },
  };
});

import { createPreviewMap } from './preview-map.js';
import type { GpsPathCoord } from 'gps-plus-slam-app-framework/storage/zip-reader';

// ============================================================================
// Test Fixtures
// ============================================================================

const SAMPLE_PATH: GpsPathCoord[] = [
  { lat: 50.0, lng: 8.0 },
  { lat: 50.001, lng: 8.001 },
  { lat: 50.002, lng: 8.002 },
];

function createTestContainer(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'preview-map-container';
  container.style.width = '400px';
  container.style.height = '200px';
  document.body.appendChild(container);
  return container;
}

// ============================================================================
// Tests
// ============================================================================

describe('PreviewMap', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createTestContainer();
    polylineCalls = [];
    tileLayerCalls = [];
    circleCalls = [];
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  // --- Creation / null guard ---

  it('returns null when container is null', () => {
    // Why: guard against missing DOM element
    const result = createPreviewMap(null, SAMPLE_PATH);
    expect(result).toBeNull();
  });

  it('returns null when gpsPath is empty', () => {
    // Why: nothing to display — avoid creating an empty map
    const result = createPreviewMap(container, []);
    expect(result).toBeNull();
  });

  it('creates a Leaflet map centered on the first GPS point', async () => {
    // Why: map must initialize with a sensible view
    const L = vi.mocked((await import('leaflet')).default);
    createPreviewMap(container, SAMPLE_PATH);

    expect(L.map).toHaveBeenCalledWith(container);
    expect(lastMapInstance.setView).toHaveBeenCalledWith(
      [SAMPLE_PATH[0].lat, SAMPLE_PATH[0].lng],
      15
    );
  });

  it('adds an OSM tile layer', () => {
    // Why: the map needs tiles to be visually useful
    createPreviewMap(container, SAMPLE_PATH);
    expect(tileLayerCalls.length).toBe(1);
    expect(tileLayerCalls[0].url).toContain('openstreetmap.org');
  });

  // --- Polyline rendering ---

  it('draws a yellow polyline with the GPS path', () => {
    // Why: raw GPS path is the core visual element of the preview
    createPreviewMap(container, SAMPLE_PATH);

    expect(polylineCalls.length).toBe(1);
    expect(polylineCalls[0].latLngs).toEqual([
      [50.0, 8.0],
      [50.001, 8.001],
      [50.002, 8.002],
    ]);
    expect(polylineCalls[0].options).toMatchObject({
      color: '#ffff00',
      weight: 3,
      opacity: 0.8,
    });
  });

  it('fits bounds to the GPS path', () => {
    // Why: the full path should be visible without manual zoom
    createPreviewMap(container, SAMPLE_PATH);
    expect(lastMapInstance.fitBounds).toHaveBeenCalled();
  });

  // --- Destroy / cleanup ---

  it('destroy() calls map.remove()', () => {
    // Why: prevent Leaflet memory leaks when switching sessions
    const instance = createPreviewMap(container, SAMPLE_PATH)!;
    expect(instance).not.toBeNull();

    instance.destroy();
    expect(lastMapInstance.remove).toHaveBeenCalledOnce();
  });

  it('destroy() is idempotent — second call is a no-op', () => {
    // Why: guard against double-cleanup in UI teardown paths
    const instance = createPreviewMap(container, SAMPLE_PATH)!;
    instance.destroy();
    instance.destroy();
    expect(lastMapInstance.remove).toHaveBeenCalledOnce();
  });

  // --- Invalidate size (deferred resize) ---

  it('invalidates map size after a short delay for container resize', () => {
    // Why: Leaflet may miscalculate tiles if the container was hidden at init
    createPreviewMap(container, SAMPLE_PATH);
    expect(lastMapInstance.invalidateSize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(lastMapInstance.invalidateSize).toHaveBeenCalledOnce();
  });

  // --- Single-point path ---

  it('handles a single-point path without crashing', () => {
    // Why: edge case — recording with only one GPS reading
    const singlePoint: GpsPathCoord[] = [{ lat: 49.0, lng: 7.0 }];
    const instance = createPreviewMap(container, singlePoint);
    expect(instance).not.toBeNull();
    expect(polylineCalls.length).toBe(1);
    expect(polylineCalls[0].latLngs).toEqual([[49.0, 7.0]]);
  });

  // --- Per-event accuracy circles ---

  it('does not draw accuracy circles for points without an accuracy value', () => {
    // Why: pre-accuracy recordings (and points where the browser omitted
    // GeolocationCoordinates.accuracy) must remain renderable — only the
    // polyline should appear.
    createPreviewMap(container, SAMPLE_PATH);
    expect(circleCalls.length).toBe(0);
  });

  it('draws one transparent yellow accuracy circle per point with accuracy', () => {
    // Why: visualizing per-event horizontal accuracy is the whole point of
    // this enhancement — without it, the polyline hides which fixes were
    // accurate vs. noisy.
    const path: GpsPathCoord[] = [
      { lat: 50.0, lng: 8.0, accuracy: 5 },
      { lat: 50.001, lng: 8.001, accuracy: 25 },
    ];
    createPreviewMap(container, path);

    expect(circleCalls.length).toBe(2);
    expect(circleCalls[0].latLng).toEqual([50.0, 8.0]);
    expect(circleCalls[0].options).toMatchObject({
      radius: 5,
      color: '#ffff00',
    });
    expect(circleCalls[1].options).toMatchObject({ radius: 25 });
    // Stroke-only since 2026-06-28 (Finding 1): no fill, so overlapping circles
    // never composite into an opaque interior that hides the basemap.
    const opts0 = circleCalls[0].options as { fill?: boolean };
    expect(opts0.fill).toBe(false);
  });

  it('skips accuracy circles for points with non-positive accuracy', () => {
    // Why: 0 / negative / NaN accuracy values would either be invisible or
    // crash Leaflet's circle radius math — guard them out.
    const path: GpsPathCoord[] = [
      { lat: 50.0, lng: 8.0, accuracy: 0 },
      { lat: 50.001, lng: 8.001, accuracy: -3 },
      { lat: 50.002, lng: 8.002, accuracy: Number.NaN },
      { lat: 50.003, lng: 8.003, accuracy: 7 },
    ];
    createPreviewMap(container, path);
    expect(circleCalls.length).toBe(1);
    expect(circleCalls[0].options).toMatchObject({ radius: 7 });
  });
});
