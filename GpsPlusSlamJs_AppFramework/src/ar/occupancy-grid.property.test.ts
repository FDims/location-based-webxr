/**
 * Occupancy Grid Property Tests.
 *
 * Why this test matters (port plan Iter 3):
 * - Quantization must be stable at cell boundaries and getCellCenter must
 *   stay within cellSizeM/2 of the original position per axis — this is
 *   the guard against porting Unity's half-cell CellToWorldPos offset.
 * - Carving must never remove the observed endpoint cell (or its
 *   carve-stop neighborhood), including the degenerate camera==point cell
 *   case, while cells far enough in FRONT of a later, deeper observation
 *   on the same ray must be carved.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mat4 } from 'gl-matrix';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';
import type { DepthSample } from '../types/ar-types';
import { OccupancyGrid } from './occupancy-grid';

const PROJECTION: Matrix4 = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

function makeSample(cameraPos: Vector3, depths: number[]): DepthSample {
  return {
    timestamp: 0,
    cameraPos,
    cameraRot: [0, 0, 0, 1],
    points: depths.map((depthM) => ({ screenX: 0.5, screenY: 0.5, depthM })),
    projectionMatrix: PROJECTION,
  };
}

describe('OccupancyGrid properties', () => {
  /**
   * Why this property matters (Iter 8): the cell color must be the true
   * per-channel rounded mean of exactly the COLORED observations — mixing
   * in color-less observations (old recordings, rgb option off) or losing
   * precision over many accumulations would drift every voxel's color.
   */
  it('cell color equals the rounded per-channel mean of the colored observations only', () => {
    const rgbArb = fc.tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 })
    );
    fc.assert(
      fc.property(
        fc.array(rgbArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 10 }),
        (colors, colorlessObservations) => {
          const grid = new OccupancyGrid({ cellSizeM: 1 });
          for (const rgb of colors) {
            grid.addSample({
              ...makeSample([0, 0, 0], []),
              points: [{ screenX: 0.5, screenY: 0.5, depthM: 5, rgb }],
            });
          }
          for (let i = 0; i < colorlessObservations; i++) {
            grid.addSample(makeSample([0, 0, 0], [5]));
          }
          const expected = [0, 1, 2].map((channel) =>
            Math.round(
              colors.reduce((sum, rgb) => sum + rgb[channel]!, 0) /
                colors.length
            )
          );
          expect(grid.getCellColor([0, 0, -5])).toEqual(expected);
        }
      )
    );
  });

  it('getCellCenter(cellForPosition(p)) stays within cellSizeM/2 of p per axis', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 2, noNaN: true }),
        fc.tuple(
          fc.double({ min: -100, max: 100, noNaN: true }),
          fc.double({ min: -100, max: 100, noNaN: true }),
          fc.double({ min: -100, max: 100, noNaN: true })
        ),
        (cellSizeM, pos) => {
          const grid = new OccupancyGrid({ cellSizeM });
          const center = grid.getCellCenter(grid.cellForPosition(pos));
          for (let axis = 0; axis < 3; axis++) {
            // +1e-9 tolerates float rounding exactly at the boundary
            expect(Math.abs(center[axis] - pos[axis])).toBeLessThanOrEqual(
              cellSizeM / 2 + 1e-9
            );
          }
        }
      )
    );
  });

  it('an observed cell survives any number of repeat observations from any camera distance (incl. same-cell case)', () => {
    fc.assert(
      fc.property(
        // Depth in whole cells; 0 cells = camera and point share a cell
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (depthCells, observations, carveStopCells) => {
          const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells });
          // Depth 0 is an invalid read; use a small positive in-cell depth
          const depthM = depthCells === 0 ? 0.2 : depthCells;
          for (let i = 0; i < observations; i++) {
            grid.addSample(makeSample([0, 0, 0], [depthM]));
          }
          // The observed cell exists with the full observation count —
          // carving never reset it. (`+ 0` normalizes -0 for depthCells=0,
          // matching the grid's normalized cell coordinates.)
          expect(grid.getOccupiedCells(observations)).toContainEqual([
            0,
            0,
            -depthCells + 0,
          ]);
        }
      )
    );
  });

  it('a nearer cell on the ray is carved iff it is at least carveStopCells in front of a deeper observation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 0, max: 4 }),
        (nearCells, extraCells, carveStopCells) => {
          const farCells = nearCells + extraCells;
          const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells });
          grid.addSample(makeSample([0, 0, 0], [nearCells]));
          grid.addSample(makeSample([0, 0, 0], [farCells]));

          const nearSurvives = grid
            .getOccupiedCells()
            .some((c) => c[0] === 0 && c[1] === 0 && c[2] === -nearCells);
          // Carve ray to -farCells stops carveStopCells dominant-axis
          // steps before the endpoint: the near cell is removed exactly
          // when its distance to the endpoint is >= carveStopCells.
          const shouldSurvive = extraCells < carveStopCells;
          expect(nearSurvives).toBe(shouldSurvive);
          // The deeper observation itself is always present.
          expect(grid.getOccupiedCells()).toContainEqual([0, 0, -farCells]);
        }
      )
    );
  });
});
