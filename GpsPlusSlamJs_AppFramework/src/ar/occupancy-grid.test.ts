/**
 * Occupancy Grid Tests.
 *
 * Why this test matters:
 * OccupancyGrid is the TS port of the Unity PointCloudData voxel grid —
 * the persisted depth-sample stream is folded into occupied 15 cm cells
 * with free-space carving. These tests pin the port's deliberate
 * deviations from Unity: per-cell observation counts (instead of render
 * buffer indices), skipping carving when camera and point share a cell
 * (instead of Unity's carve-then-re-add), and the round-consistent
 * getCellCenter formula (NOT Unity's +half-cell offset).
 */

import { describe, it, expect } from 'vitest';
import { mat4 } from 'gl-matrix';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';
import type { DepthSample } from '../types/ar-types';
import { OccupancyGrid } from './occupancy-grid';

const PROJECTION: Matrix4 = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

/**
 * Build a DepthSample with an identity-rotation camera, so a center-screen
 * point at depth d unprojects to cameraPos + (0, 0, -d).
 */
function makeSample(
  cameraPos: Vector3,
  depths: number[],
  options?: { withMatrix?: boolean }
): DepthSample {
  const withMatrix = options?.withMatrix ?? true;
  return {
    timestamp: 0,
    cameraPos,
    cameraRot: [0, 0, 0, 1],
    points: depths.map((depthM) => ({ screenX: 0.5, screenY: 0.5, depthM })),
    ...(withMatrix ? { projectionMatrix: PROJECTION } : {}),
  };
}

/**
 * Build a single-cell sample (center-screen point) carrying an optional
 * per-point color — the Iter-8 RGB voxel-coloring shape.
 */
function makeColoredSample(
  cameraPos: Vector3,
  depthM: number,
  rgb?: readonly [number, number, number]
): DepthSample {
  return {
    timestamp: 0,
    cameraPos,
    cameraRot: [0, 0, 0, 1],
    points: [{ screenX: 0.5, screenY: 0.5, depthM, ...(rgb ? { rgb } : {}) }],
    projectionMatrix: PROJECTION,
  };
}

describe('OccupancyGrid', () => {
  describe('construction', () => {
    it('defaults to 15 cm cells and carve stop distance 2 (Unity parity)', () => {
      const grid = new OccupancyGrid();
      expect(grid.cellSizeM).toBeCloseTo(0.15);
      expect(grid.carveStopCells).toBe(2);
      expect(grid.size).toBe(0);
    });

    it('rejects invalid configuration', () => {
      expect(() => new OccupancyGrid({ cellSizeM: 0 })).toThrow(RangeError);
      expect(() => new OccupancyGrid({ cellSizeM: NaN })).toThrow(RangeError);
      expect(() => new OccupancyGrid({ carveStopCells: -1 })).toThrow(
        RangeError
      );
      expect(() => new OccupancyGrid({ carveStopCells: 1.5 })).toThrow(
        RangeError
      );
    });
  });

  describe('cell colors (Iter 8 RGB voxel coloring)', () => {
    /**
     * Why these tests matter:
     * The per-cell running-average color is what the cube visualizer
     * renders; the contract has two subtle parts a naive implementation
     * gets wrong: (1) color-less observations (rgb option off, old
     * recordings) must increment the OBSERVATION count without diluting
     * the color average toward black; (2) the average must be a true
     * per-channel mean of however many colored observations arrived.
     */
    it('returns null for unknown cells and for cells observed without color', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
      grid.addSample(makeColoredSample([0, 0, 0], 5)); // no rgb
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
    });

    it('stores a single colored observation verbatim', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [120, 45, 200]));
      expect(grid.getCellColor([0, 0, -5])).toEqual([120, 45, 200]);
    });

    it('averages repeated colored observations per channel (rounded)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [100, 0, 10]));
      grid.addSample(makeColoredSample([0, 0, 0], 5, [200, 100, 15]));
      expect(grid.getCellColor([0, 0, -5])).toEqual([150, 50, 13]); // 12.5 → 13
    });

    it('color-less observations do not dilute the average', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [100, 100, 100]));
      grid.addSample(makeColoredSample([0, 0, 0], 5)); // observed, no rgb
      expect(grid.getCellColor([0, 0, -5])).toEqual([100, 100, 100]);
      // …while the observation count still advanced to 2
      expect(grid.getOccupiedCells(2)).toContainEqual([0, 0, -5]);
    });

    it('ignores non-finite color channels defensively (bad persisted data)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(
        makeColoredSample([0, 0, 0], 5, [NaN, 10, 10] as unknown as readonly [
          number,
          number,
          number,
        ])
      );
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
    });

    it('clear() drops colors with the cells', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [1, 2, 3]));
      grid.clear();
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
    });
  });

  describe('addSample', () => {
    it('adds an occupied cell per unprojected point and returns the count', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // Two points on diverging rays (different screen positions), landing
      // in two distinct cells. (Same-ray points within a sample no longer
      // carve each other — see the point-order-independence test below.)
      const sample: DepthSample = {
        timestamp: 0,
        cameraPos: [0, 0, 0],
        cameraRot: [0, 0, 0, 1],
        points: [
          { screenX: 0.5, screenY: 0.5, depthM: 5 },
          { screenX: 0.9, screenY: 0.5, depthM: 8 },
        ],
        projectionMatrix: PROJECTION,
      };
      const added = grid.addSample(sample);
      expect(added).toBe(2);
      expect(grid.size).toBe(2);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -5]);
    });

    it('skips all points of samples without a projectionMatrix (old recordings)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      const added = grid.addSample(
        makeSample([0, 0, 0], [5], { withMatrix: false })
      );
      expect(added).toBe(0);
      expect(grid.size).toBe(0);
    });

    it('skips invalid depth points (zero, negative, non-finite)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      const added = grid.addSample(makeSample([0, 0, 0], [0, -2, NaN, 4]));
      expect(added).toBe(1);
      expect(grid.getOccupiedCells()).toEqual([[0, 0, -4]]);
    });

    it('skips samples with a non-finite camera position', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      const added = grid.addSample(makeSample([NaN, 0, 0], [5]));
      expect(added).toBe(0);
      expect(grid.size).toBe(0);
    });

    it('counts repeated observations of the same cell', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.size).toBe(1);
      expect(grid.getOccupiedCells(2)).toEqual([[0, 0, -5]]);
    });

    it('does not carve the observed cell on re-observation (carve stop distance)', () => {
      // Unity parity: the carve ray stops carveStopCells dominant-axis
      // steps before the endpoint, so the endpoint's count accumulates
      // instead of being reset by carve-then-re-add.
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.getOccupiedCells(2)).toHaveLength(1);
    });

    it('keeps the cell when camera and point share it (deliberate Unity deviation)', () => {
      // Unity would carve the shared cell and immediately re-add it,
      // resetting per-cell state; the TS port skips carving instead (§2
      // edge case in the port plan).
      const grid = new OccupancyGrid({ cellSizeM: 10 });
      grid.addSample(makeSample([0, 0, 0], [2]));
      grid.addSample(makeSample([0, 0, 0], [2]));
      expect(grid.size).toBe(1);
      expect(grid.getOccupiedCells(2)).toHaveLength(1);
    });

    it('carves a previously observed cell when the scene is later seen through', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      // Surface at 5 m, then the surface disappears and a wall at 10 m
      // becomes visible along the same ray: the 5 m cell must be carved.
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -5]);
      grid.addSample(makeSample([0, 0, 0], [10]));
      expect(grid.getOccupiedCells()).not.toContainEqual([0, 0, -5]);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -10]);
    });

    it('is independent of point order within a sample (endpoints survive same-sample carving)', () => {
      // Two points on the SAME center-screen ray at 5 and 10 cells, in one
      // sample. With a single carve+increment pass the outcome depends on
      // iteration order: if the near point is incremented before the far
      // point's ray is carved, the far ray erases the near endpoint.
      // Carving runs as a first pass so neither order can erase the other's
      // endpoint — both survive. (Deeper-carves-nearer still applies ACROSS
      // samples, see the test above.)
      const near: Vector3 = [0, 0, -5];
      const far: Vector3 = [0, 0, -10];

      const nearFirst = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      nearFirst.addSample(makeSample([0, 0, 0], [5, 10]));

      const farFirst = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      farFirst.addSample(makeSample([0, 0, 0], [10, 5]));

      for (const grid of [nearFirst, farFirst]) {
        expect(grid.getOccupiedCells()).toContainEqual(near);
        expect(grid.getOccupiedCells()).toContainEqual(far);
      }
    });
  });

  describe('getOccupiedCells / getCellCenter', () => {
    it('filters by minimum observation count', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      // Second cell from a sideways-shifted camera (separate ray)
      grid.addSample(makeSample([10, 0, 0], [8]));
      expect(grid.getOccupiedCells()).toHaveLength(2);
      expect(grid.getOccupiedCells(2)).toEqual([[0, 0, -5]]);
    });

    it('returns the round-consistent cell center (cell · cellSizeM)', () => {
      // Deliberately NOT Unity's CellToWorldPos (+cellSize/2), which is
      // off by half a cell under round-quantization (§2 of the port plan).
      const grid = new OccupancyGrid({ cellSizeM: 0.5 });
      expect(grid.getCellCenter([2, -4, 0])).toEqual([1, -2, 0]);
    });
  });

  describe('raycast', () => {
    // A large carve stop keeps carving out of the way: these tests need
    // two occupied cells on one straight test ray, which depth samples on
    // that same ray would otherwise carve away.
    function gridWithCellsAt5And8(): OccupancyGrid {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 10 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [8]));
      return grid;
    }

    it('returns the center of the first occupied cell along the ray', () => {
      const hit = gridWithCellsAt5And8().raycast([0, 0, 0], [0, 0, -20]);
      expect(hit).toEqual([0, 0, -5]);
    });

    it('returns null when no occupied cell is on the ray', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.raycast([10, 10, 10], [10, 10, -20])).toBeNull();
      expect(grid.raycast([0, 0, 0], [NaN, 0, -20])).toBeNull();
    });

    it('respects a minimum observation count', () => {
      const grid = gridWithCellsAt5And8();
      grid.addSample(makeSample([0, 0, 0], [8]));
      expect(grid.raycast([0, 0, 0], [0, 0, -20], 2)).toEqual([0, 0, -8]);
    });
  });

  describe('clear', () => {
    it('empties the grid', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.size).toBe(1);
      grid.clear();
      expect(grid.size).toBe(0);
      expect(grid.getOccupiedCells()).toEqual([]);
    });
  });
});
