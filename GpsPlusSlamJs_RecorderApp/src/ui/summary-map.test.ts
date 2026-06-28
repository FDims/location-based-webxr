/**
 * Summary Map Component - Unit Tests
 *
 * TDD tests for the Leaflet-based 2D map shown in the session summary panel.
 * Tests cover:
 * - Component initialization and cleanup
 * - Rendering GPS path polylines (raw GPS in yellow, fused in cyan)
 * - Rendering reference point markers
 * - Auto-fit bounds to show full path
 *
 * Why this test matters:
 * User feedback (Issue #4, 2026-01-27) requested a post-recording map view
 * showing the walked path to visualize raw GPS vs fused GPS+SLAM output.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Track mock instances for assertions
let lastMapInstance: {
  remove: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  setView: ReturnType<typeof vi.fn>;
  getZoom: ReturnType<typeof vi.fn>;
  invalidateSize: ReturnType<typeof vi.fn>;
};
let polylineCalls: Array<{ latLngs: unknown; options: unknown }> = [];
let markerCalls: Array<{ latLng: unknown; options: unknown }> = [];
let tileLayerCalls: Array<{ url: unknown; options: unknown }> = [];
let bindPopupArgs: unknown[] = [];
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
          getZoom: vi.fn().mockReturnValue(17),
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
      marker: vi.fn((latLng: unknown, options: unknown) => {
        markerCalls.push({ latLng, options });
        const mockMarker = {
          addTo: vi.fn().mockReturnThis(),
          remove: vi.fn(),
          bindPopup: vi.fn((arg: unknown) => {
            bindPopupArgs.push(arg);
            return mockMarker;
          }),
        };
        return mockMarker;
      }),
      latLngBounds: vi.fn(() => ({
        isValid: vi.fn().mockReturnValue(true),
        extend: vi.fn().mockReturnThis(),
      })),
      divIcon: vi.fn(() => ({})),
      circle: vi.fn((latLng: unknown, options: unknown) => {
        circleCalls.push({ latLng, options });
        return {
          addTo: vi.fn().mockReturnThis(),
          remove: vi.fn(),
        };
      }),
    },
  };
});

import {
  createSummaryMap,
  RAW_GPS_COLOR,
  FUSED_PATH_COLOR,
  REF_POINT_COLOR,
  ALIGNMENT_SNAPSHOT_COLOR,
  type SummaryMapData,
} from './summary-map.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestContainer(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'summary-map-container';
  container.style.width = '400px';
  container.style.height = '300px';
  document.body.appendChild(container);
  return container;
}

function createValidMapData(): SummaryMapData {
  return {
    rawGpsPath: [
      { lat: 50.0, lng: 8.0 },
      { lat: 50.001, lng: 8.001 },
      { lat: 50.002, lng: 8.002 },
    ],
    fusedPath: [
      { lat: 50.0001, lng: 8.0001 },
      { lat: 50.0011, lng: 8.0011 },
      { lat: 50.0021, lng: 8.0021 },
    ],
    referencePoints: [
      { lat: 50.001, lng: 8.001, name: 'Entrance', timestamp: 1000 },
      { lat: 50.002, lng: 8.002, name: 'Exit', timestamp: 1000 },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SummaryMap', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createTestContainer();
    // Reset tracking arrays
    polylineCalls = [];
    markerCalls = [];
    tileLayerCalls = [];
    bindPopupArgs = [];
    circleCalls = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    container.remove();
  });

  describe('createSummaryMap', () => {
    it('should create a map instance with valid data', () => {
      const data = createValidMapData();
      const map = createSummaryMap(container, data);

      expect(map).not.toBeNull();
      expect(map!.destroy).toBeInstanceOf(Function);
    });

    it('should return null and not crash when container is null', () => {
      const data = createValidMapData();
      const map = createSummaryMap(null, data);

      expect(map).toBeNull();
    });

    it('should return null when GPS path is empty', () => {
      const data: SummaryMapData = {
        rawGpsPath: [],
        fusedPath: [],
        referencePoints: [],
      };

      const map = createSummaryMap(container, data);
      expect(map).toBeNull();
    });

    it('should handle single-point GPS path gracefully', () => {
      const data: SummaryMapData = {
        rawGpsPath: [{ lat: 50.0, lng: 8.0 }],
        fusedPath: [{ lat: 50.0, lng: 8.0 }],
        referencePoints: [],
      };

      const map = createSummaryMap(container, data);
      // Single point should still create a map (centered on that point)
      expect(map).not.toBeNull();
    });

    it('should add OpenStreetMap tile layer', () => {
      const data = createValidMapData();
      createSummaryMap(container, data);

      expect(tileLayerCalls.length).toBe(1);
      expect(tileLayerCalls[0].url).toContain('openstreetmap.org');
    });
  });

  describe('destroy', () => {
    it('should clean up Leaflet resources when destroyed', () => {
      const data = createValidMapData();
      const map = createSummaryMap(container, data);

      expect(map).not.toBeNull();
      map!.destroy();

      // Verify Leaflet map.remove() was called
      expect(lastMapInstance.remove).toHaveBeenCalled();
    });

    it('should be safe to call destroy multiple times', () => {
      const data = createValidMapData();
      const map = createSummaryMap(container, data);

      expect(map).not.toBeNull();
      map!.destroy();
      // Second call should not throw
      expect(() => map!.destroy()).not.toThrow();
    });

    // Why this test matters: the scheduled map.invalidateSize() timer can
    // fire after destroy(), operating on a removed map. Destroying must
    // cancel the pending timeout so invalidateSize is never called post-removal.
    it('should cancel the resize timeout so invalidateSize is not called after destroy', () => {
      vi.useFakeTimers();
      try {
        const data = createValidMapData();
        const map = createSummaryMap(container, data);
        expect(map).not.toBeNull();

        // Destroy before the 100ms timer fires
        map!.destroy();

        // Advance past the timeout duration
        vi.advanceTimersByTime(200);

        // invalidateSize must NOT have been called after destroy
        expect(lastMapInstance.invalidateSize).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('exported color constants', () => {
    // Why these tests matter:
    // Ensures color constants are exported so consumers (including tests)
    // can reference the canonical values instead of duplicating hex strings.
    // Prevents silent breakage if a color value is changed in the source.

    it('should export RAW_GPS_COLOR as a yellow hex string', () => {
      expect(RAW_GPS_COLOR).toBe('#ffff00');
    });

    it('should export FUSED_PATH_COLOR as a cyan hex string', () => {
      expect(FUSED_PATH_COLOR).toBe('#00ffff');
    });

    it('should export REF_POINT_COLOR as a red hex string', () => {
      expect(REF_POINT_COLOR).toBe('#ff6b6b');
    });
  });

  describe('polyline rendering', () => {
    it('should create yellow polyline for raw GPS path', () => {
      const data = createValidMapData();
      createSummaryMap(container, data);

      // Find the yellow polyline call — uses exported constant
      const yellowPolyline = polylineCalls.find(
        (call) => (call.options as { color?: string })?.color === RAW_GPS_COLOR
      );

      expect(yellowPolyline).toBeDefined();
      expect(yellowPolyline!.latLngs).toHaveLength(3);
    });

    it('should create cyan polyline for fused path', () => {
      const data = createValidMapData();
      createSummaryMap(container, data);

      // Find the cyan polyline call — uses exported constant
      const cyanPolyline = polylineCalls.find(
        (call) =>
          (call.options as { color?: string })?.color === FUSED_PATH_COLOR
      );

      expect(cyanPolyline).toBeDefined();
      expect(cyanPolyline!.latLngs).toHaveLength(3);
    });

    it('should handle missing fused path (only raw GPS)', () => {
      const data: SummaryMapData = {
        rawGpsPath: [
          { lat: 50.0, lng: 8.0 },
          { lat: 50.001, lng: 8.001 },
        ],
        fusedPath: [], // No fused data
        referencePoints: [],
      };

      const map = createSummaryMap(container, data);
      expect(map).not.toBeNull();

      // Should have only yellow polyline, no cyan
      expect(polylineCalls.length).toBe(1);
      expect((polylineCalls[0].options as { color?: string }).color).toBe(
        RAW_GPS_COLOR
      );
    });

    it('should skip polyline if path has zero points', () => {
      const data: SummaryMapData = {
        rawGpsPath: [{ lat: 50.0, lng: 8.0 }],
        fusedPath: [], // Empty
        referencePoints: [],
      };

      createSummaryMap(container, data);

      // Only one polyline (raw GPS)
      expect(polylineCalls.length).toBe(1);
    });
  });

  describe('per-event accuracy circles', () => {
    // Why this suite matters:
    // The polyline alone hides per-event GPS accuracy — accurate fixes and
    // 50-meter-noisy fixes look identical on the line. We add a transparent
    // L.circle (radius = horizontal accuracy in meters) per raw GPS event so
    // users can visually distinguish them on the 2D map.

    it('does not draw any circles when no raw GPS sample has accuracy', () => {
      const data: SummaryMapData = {
        rawGpsPath: [
          { lat: 50.0, lng: 8.0 },
          { lat: 50.001, lng: 8.001 },
        ],
        fusedPath: [],
        referencePoints: [],
      };
      createSummaryMap(container, data);
      expect(circleCalls.length).toBe(0);
    });

    it('draws one transparent yellow circle per raw GPS event with a positive accuracy', () => {
      const data: SummaryMapData = {
        rawGpsPath: [
          { lat: 50.0, lng: 8.0, accuracy: 4 },
          { lat: 50.001, lng: 8.001, accuracy: 30 },
        ],
        fusedPath: [],
        referencePoints: [],
      };
      createSummaryMap(container, data);

      expect(circleCalls.length).toBe(2);
      expect(circleCalls[0].latLng).toEqual([50.0, 8.0]);
      expect(circleCalls[0].options).toMatchObject({
        radius: 4,
        color: RAW_GPS_COLOR,
      });
      expect(circleCalls[1].options).toMatchObject({ radius: 30 });
      // Stroke-only since 2026-06-28 (Finding 1): no fill, so overlapping
      // circles never composite into an opaque interior over the basemap.
      const opts0 = circleCalls[0].options as { fill?: boolean };
      expect(opts0.fill).toBe(false);
    });

    it('skips circles for non-positive / NaN accuracy values', () => {
      const data: SummaryMapData = {
        rawGpsPath: [
          { lat: 50.0, lng: 8.0, accuracy: 0 },
          { lat: 50.001, lng: 8.001, accuracy: -5 },
          { lat: 50.002, lng: 8.002, accuracy: Number.NaN },
          { lat: 50.003, lng: 8.003, accuracy: 12 },
        ],
        fusedPath: [],
        referencePoints: [],
      };
      createSummaryMap(container, data);
      expect(circleCalls.length).toBe(1);
      expect(circleCalls[0].options).toMatchObject({ radius: 12 });
    });
  });

  describe('reference point markers', () => {
    it('should create markers for each reference point', () => {
      const data = createValidMapData();
      createSummaryMap(container, data);

      // Should create 2 markers (one for each ref point)
      expect(markerCalls.length).toBe(2);
    });

    it('should position markers at correct coordinates', () => {
      const data = createValidMapData();
      createSummaryMap(container, data);

      // Check first marker position
      expect(markerCalls[0].latLng).toEqual([50.001, 8.001]);
      expect(markerCalls[1].latLng).toEqual([50.002, 8.002]);
    });

    it('should handle zero reference points', () => {
      const data: SummaryMapData = {
        rawGpsPath: [
          { lat: 50.0, lng: 8.0 },
          { lat: 50.001, lng: 8.001 },
        ],
        fusedPath: [],
        referencePoints: [],
      };

      const map = createSummaryMap(container, data);
      expect(map).not.toBeNull();

      expect(markerCalls.length).toBe(0);
    });

    // Why this test matters: reference point names could contain HTML-like
    // characters (e.g. user-entered "<script>" or accidental angle brackets).
    // Using textContent instead of innerHTML ensures they are safely escaped.
    it('should escape HTML in reference point names via DOM textContent', () => {
      const data: SummaryMapData = {
        rawGpsPath: [
          { lat: 50.0, lng: 8.0 },
          { lat: 50.001, lng: 8.001 },
        ],
        fusedPath: [],
        referencePoints: [
          {
            lat: 50.001,
            lng: 8.001,
            name: '<img src=x onerror=alert(1)>',
            timestamp: 1000,
          },
        ],
      };

      createSummaryMap(container, data);

      // The popup content should be an HTMLElement, not a raw HTML string
      expect(bindPopupArgs[0]).toBeInstanceOf(HTMLElement);
      const el = bindPopupArgs[0] as HTMLElement;
      // textContent safely escapes HTML — the literal angle brackets must appear
      expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
      // innerHTML must NOT contain an unescaped <img> tag
      expect(el.innerHTML).not.toContain('<img');
    });

    // Why this test matters: confirms the popup preserves the bold styling
    // from the original HTML string implementation.
    it('should render popup as a <b> element with pin emoji prefix', () => {
      const data: SummaryMapData = {
        rawGpsPath: [
          { lat: 50.0, lng: 8.0 },
          { lat: 50.001, lng: 8.001 },
        ],
        fusedPath: [],
        referencePoints: [
          { lat: 50.001, lng: 8.001, name: 'Entrance', timestamp: 1000 },
        ],
      };

      createSummaryMap(container, data);

      const el = bindPopupArgs[0] as HTMLElement;
      expect(el.tagName).toBe('B');
      expect(el.textContent).toBe('📍 Entrance');
    });

    // Why this test matters: names with HTML entity-like sequences (e.g. &amp;)
    // or quotes must appear literally, not be interpreted as HTML entities.
    it('should treat HTML entities and quotes in names as literal text', () => {
      const data: SummaryMapData = {
        rawGpsPath: [
          { lat: 50.0, lng: 8.0 },
          { lat: 50.001, lng: 8.001 },
        ],
        fusedPath: [],
        referencePoints: [
          {
            lat: 50.001,
            lng: 8.001,
            name: 'A &amp; B "quoted"',
            timestamp: 1000,
          },
        ],
      };

      createSummaryMap(container, data);

      const el = bindPopupArgs[0] as HTMLElement;
      // textContent must preserve the literal string, not decode &amp; → &
      expect(el.textContent).toContain('A &amp; B "quoted"');
    });

    // Why this test matters: with multiple reference points, each marker must
    // get its own independent DOM element (not a shared reference).
    it('should create separate DOM elements for each reference point popup', () => {
      const data = createValidMapData(); // has 2 reference points
      createSummaryMap(container, data);

      expect(bindPopupArgs).toHaveLength(2);
      const el0 = bindPopupArgs[0] as HTMLElement;
      const el1 = bindPopupArgs[1] as HTMLElement;
      // Distinct element instances
      expect(el0).not.toBe(el1);
      // Correct names
      expect(el0.textContent).toBe('📍 Entrance');
      expect(el1.textContent).toBe('📍 Exit');
    });

    // Why this test matters: an empty name is an edge case that must not
    // produce a broken popup or throw.
    it('should handle empty reference point name gracefully', () => {
      const data: SummaryMapData = {
        rawGpsPath: [
          { lat: 50.0, lng: 8.0 },
          { lat: 50.001, lng: 8.001 },
        ],
        fusedPath: [],
        referencePoints: [
          { lat: 50.001, lng: 8.001, name: '', timestamp: 1000 },
        ],
      };

      createSummaryMap(container, data);

      const el = bindPopupArgs[0] as HTMLElement;
      expect(el).toBeInstanceOf(HTMLElement);
      expect(el.textContent).toBe('📍 ');
    });
  });

  describe('centering', () => {
    // Why this test matters: with prior reference points scattered far apart,
    // fitting bounds over *all* elements zoomed the recording down to a useless
    // dot. The map must instead center on the FINAL user position of the
    // recording (last raw GPS reading) so the walked area stays in view.
    // (User feedback 2026-06-02.)
    it('should center on the final raw GPS position, not fit all elements', () => {
      const data = createValidMapData();
      createSummaryMap(container, data);

      const lastRaw = data.rawGpsPath.at(-1)!;
      expect(lastMapInstance.setView).toHaveBeenCalledWith(
        [lastRaw.lat, lastRaw.lng],
        expect.any(Number)
      );
      // It must NOT fit bounds over all elements (the previous behavior that
      // dragged the view toward far-away ref points).
      expect(lastMapInstance.fitBounds).not.toHaveBeenCalled();
    });

    it('should fall back to the final fused position when no raw GPS exists', () => {
      const data: SummaryMapData = {
        rawGpsPath: [],
        fusedPath: [
          { lat: 50.0001, lng: 8.0001 },
          { lat: 50.0011, lng: 8.0011 },
        ],
        referencePoints: [],
      };
      createSummaryMap(container, data);

      const lastFused = data.fusedPath.at(-1)!;
      expect(lastMapInstance.setView).toHaveBeenCalledWith(
        [lastFused.lat, lastFused.lng],
        expect.any(Number)
      );
    });
  });
});

describe('SummaryMapData type', () => {
  it('should accept valid coordinate format', () => {
    const data: SummaryMapData = {
      rawGpsPath: [{ lat: 50.0, lng: 8.0 }],
      fusedPath: [{ lat: 50.0, lng: 8.0 }],
      referencePoints: [{ lat: 50.0, lng: 8.0, name: 'Test', timestamp: 1000 }],
    };

    // Type check passes if this compiles
    expect(data.rawGpsPath).toHaveLength(1);
    expect(data.referencePoints[0].name).toBe('Test');
  });
});

// ============================================================================
// Fullscreen Toggle Tests (User Feedback Issue #1, 2026-02-06)
// ============================================================================

describe('SummaryMap fullscreen toggle', () => {
  /**
   * Why these tests matter:
   * User feedback (Issue #1, 2026-02-06) reported the 192px summary map
   * is too small to meaningfully explore a recorded path. Users need to
   * expand it to fullscreen and return to inline view.
   */

  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'summary-map-container';
    container.classList.add(
      'w-full',
      'h-48',
      'rounded-lg',
      'overflow-hidden',
      'bg-gray-800'
    );
    container.style.width = '400px';
    container.style.height = '192px';
    document.body.appendChild(container);

    polylineCalls = [];
    markerCalls = [];
    tileLayerCalls = [];
    bindPopupArgs = [];
    circleCalls = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  describe('expand()', () => {
    // Why: Fullscreen mode must cover the viewport so the map is large enough to explore
    it('should add fullscreen CSS classes to the container', () => {
      const instance = createSummaryMap(container, createValidMapData());

      instance!.expand();

      expect(container.classList.contains('fixed')).toBe(true);
      expect(container.classList.contains('inset-0')).toBe(true);
      expect(container.classList.contains('z-[60]')).toBe(true);
    });

    // Why: The inline height constraint must be removed so the map fills the viewport
    it('should remove inline height and rounded classes', () => {
      const instance = createSummaryMap(container, createValidMapData());

      instance!.expand();

      expect(container.classList.contains('h-48')).toBe(false);
      expect(container.classList.contains('rounded-lg')).toBe(false);
    });

    // Why: Leaflet needs invalidateSize to recalculate tile positions after container resize
    it('should call map.invalidateSize() after expanding', () => {
      vi.useFakeTimers();
      const instance = createSummaryMap(container, createValidMapData());
      // Flush the initial 100ms invalidateSize timer
      vi.advanceTimersByTime(200);
      lastMapInstance.invalidateSize.mockClear();

      instance!.expand();
      vi.advanceTimersByTime(350);

      expect(lastMapInstance.invalidateSize).toHaveBeenCalled();
    });

    // Why: Double-expand must be a safe no-op to avoid CSS class corruption
    it('should be idempotent (double expand is no-op)', () => {
      const instance = createSummaryMap(container, createValidMapData());

      instance!.expand();
      instance!.expand();

      expect(container.classList.contains('fixed')).toBe(true);
      expect(instance!.isExpanded()).toBe(true);
    });

    // Why: Must not throw if called after cleanup
    it('should be safe after destroy()', () => {
      const instance = createSummaryMap(container, createValidMapData());

      instance!.destroy();

      expect(() => instance!.expand()).not.toThrow();
    });
  });

  describe('collapse()', () => {
    // Why: Collapse restores the inline view, re-applying original classes
    it('should restore inline CSS classes and remove fullscreen classes', () => {
      const instance = createSummaryMap(container, createValidMapData());

      instance!.expand();
      instance!.collapse();

      expect(container.classList.contains('h-48')).toBe(true);
      expect(container.classList.contains('rounded-lg')).toBe(true);
      expect(container.classList.contains('fixed')).toBe(false);
      expect(container.classList.contains('inset-0')).toBe(false);
      expect(container.classList.contains('z-[60]')).toBe(false);
    });

    // Why: Leaflet needs invalidateSize after returning to inline size
    it('should call map.invalidateSize() after collapsing', () => {
      vi.useFakeTimers();
      const instance = createSummaryMap(container, createValidMapData());
      vi.advanceTimersByTime(200);
      lastMapInstance.invalidateSize.mockClear();

      instance!.expand();
      vi.advanceTimersByTime(350);
      lastMapInstance.invalidateSize.mockClear();

      instance!.collapse();
      vi.advanceTimersByTime(350);

      expect(lastMapInstance.invalidateSize).toHaveBeenCalled();
    });

    // Why: Collapse when already inline must be a safe no-op
    it('should be idempotent (collapse without expand is no-op)', () => {
      const instance = createSummaryMap(container, createValidMapData());

      expect(() => instance!.collapse()).not.toThrow();
      expect(container.classList.contains('h-48')).toBe(true);
      expect(instance!.isExpanded()).toBe(false);
    });

    // Why: Must not throw if called after cleanup
    it('should be safe after destroy()', () => {
      const instance = createSummaryMap(container, createValidMapData());

      instance!.destroy();

      expect(() => instance!.collapse()).not.toThrow();
    });
  });

  describe('isExpanded()', () => {
    // Why: External code (e.g. session-summary) needs to query the current state
    it('should return false initially', () => {
      const instance = createSummaryMap(container, createValidMapData());

      expect(instance!.isExpanded()).toBe(false);
    });

    it('should return true after expand', () => {
      const instance = createSummaryMap(container, createValidMapData());

      instance!.expand();

      expect(instance!.isExpanded()).toBe(true);
    });

    it('should return false after expand then collapse', () => {
      const instance = createSummaryMap(container, createValidMapData());

      instance!.expand();
      instance!.collapse();

      expect(instance!.isExpanded()).toBe(false);
    });
  });

  describe('fullscreen UI buttons', () => {
    // Why: User needs a visible affordance to trigger expand/collapse
    it('should render an expand button inside the container', () => {
      createSummaryMap(container, createValidMapData());

      const expandBtn = container.querySelector(
        '[data-testid="btn-map-expand"]'
      );
      expect(expandBtn).not.toBeNull();
    });

    // Why: Collapse button is only relevant in fullscreen mode
    it('should render a collapse button that is hidden by default', () => {
      createSummaryMap(container, createValidMapData());

      const collapseBtn = container.querySelector(
        '[data-testid="btn-map-collapse"]'
      );
      expect(collapseBtn).not.toBeNull();
      expect((collapseBtn as HTMLElement).classList.contains('hidden')).toBe(
        true
      );
    });

    // Why: Tapping the expand button must trigger fullscreen
    it('clicking expand button should enter fullscreen', () => {
      createSummaryMap(container, createValidMapData());

      const expandBtn = container.querySelector(
        '[data-testid="btn-map-expand"]'
      ) as HTMLElement;
      expandBtn.click();

      expect(container.classList.contains('fixed')).toBe(true);
      expect(container.classList.contains('inset-0')).toBe(true);
    });

    // Why: Tapping the collapse button must exit fullscreen
    it('clicking collapse button should exit fullscreen', () => {
      createSummaryMap(container, createValidMapData());

      const expandBtn = container.querySelector(
        '[data-testid="btn-map-expand"]'
      ) as HTMLElement;
      expandBtn.click();

      const collapseBtn = container.querySelector(
        '[data-testid="btn-map-collapse"]'
      ) as HTMLElement;
      collapseBtn.click();

      expect(container.classList.contains('fixed')).toBe(false);
      expect(container.classList.contains('h-48')).toBe(true);
    });

    // Why: Visual feedback — expand button hides in fullscreen, collapse button shows
    it('should toggle button visibility on expand', () => {
      createSummaryMap(container, createValidMapData());

      const expandBtn = container.querySelector(
        '[data-testid="btn-map-expand"]'
      ) as HTMLElement;
      const collapseBtn = container.querySelector(
        '[data-testid="btn-map-collapse"]'
      ) as HTMLElement;

      expandBtn.click();

      expect(expandBtn.classList.contains('hidden')).toBe(true);
      expect(collapseBtn.classList.contains('hidden')).toBe(false);
    });

    // Why: Button visibility must restore on collapse
    it('should restore button visibility on collapse', () => {
      createSummaryMap(container, createValidMapData());

      const expandBtn = container.querySelector(
        '[data-testid="btn-map-expand"]'
      ) as HTMLElement;
      const collapseBtn = container.querySelector(
        '[data-testid="btn-map-collapse"]'
      ) as HTMLElement;

      expandBtn.click();
      collapseBtn.click();

      expect(expandBtn.classList.contains('hidden')).toBe(false);
      expect(collapseBtn.classList.contains('hidden')).toBe(true);
    });

    // Why: Destroy should clean up buttons to avoid orphaned DOM elements
    it('should remove buttons on destroy()', () => {
      const instance = createSummaryMap(container, createValidMapData());

      instance!.destroy();

      expect(
        container.querySelector('[data-testid="btn-map-expand"]')
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="btn-map-collapse"]')
      ).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Alignment Snapshot Polyline (Issue #1 — feedback session 2026-03-21)
  // ---------------------------------------------------------------------------
  describe('alignment snapshot polyline', () => {
    it('should render alignment snapshots as a polyline when provided', () => {
      // Why: alignment snapshots show the system's GPS estimates at each
      // alignment update — rendered as a connected red polyline for consistency
      // with the raw GPS (yellow) and fused (cyan) polylines.
      const data = createValidMapData();
      data.alignmentSnapshots = [
        { lat: 50.0005, lng: 8.0005 },
        { lat: 50.0015, lng: 8.0015 },
      ];
      polylineCalls = [];
      markerCalls = [];

      createSummaryMap(container, data);

      // 3 polylines: raw GPS + fused + alignment snapshots
      expect(polylineCalls.length).toBe(3);
      // Only 2 markers: ref points (no snapshot markers)
      expect(markerCalls.length).toBe(2);
    });

    it('should not render alignment snapshot polyline when empty', () => {
      // Why: graceful handling of sessions with no alignment snapshots
      const data = createValidMapData();
      data.alignmentSnapshots = [];
      polylineCalls = [];

      createSummaryMap(container, data);

      // Only 2 polylines: raw GPS + fused
      expect(polylineCalls.length).toBe(2);
    });

    it('should not render alignment snapshot polyline when undefined', () => {
      // Why: backward compatibility — old session data won't have this field
      const data = createValidMapData();
      // alignmentSnapshots is undefined by default
      polylineCalls = [];

      createSummaryMap(container, data);

      // Only 2 polylines: raw GPS + fused
      expect(polylineCalls.length).toBe(2);
    });

    it('should export ALIGNMENT_SNAPSHOT_COLOR constant', () => {
      // Why: color constant should be available for the legend (Issue #2)
      expect(ALIGNMENT_SNAPSHOT_COLOR).toBe('#ff0000');
    });
  });
});
