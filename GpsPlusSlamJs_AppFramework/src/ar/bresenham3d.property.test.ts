/**
 * 3D Bresenham Property Tests.
 *
 * Why this test matters:
 * The carving guarantees of the occupancy grid reduce to invariants of
 * this line tracer: it must start at the start cell, reach the end cell
 * (when stopDistance = 0), advance every step within unit Chebyshev
 * distance, and with a stop distance it must keep exactly that many
 * dominant-axis steps away from the endpoint.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { bresenham3d, MAX_TRACE_STEPS, type GridCell } from './bresenham3d';

const arbCoord = fc.integer({ min: -50, max: 50 });
const arbCell = fc.tuple(arbCoord, arbCoord, arbCoord);

function chebyshev(a: GridCell, b: GridCell): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2])
  );
}

function trace(start: GridCell, end: GridCell, stopDistance = 0): GridCell[] {
  const visited: GridCell[] = [];
  bresenham3d(
    start,
    end,
    (cell) => {
      visited.push(cell);
      return true;
    },
    stopDistance
  );
  return visited;
}

describe('bresenham3d properties', () => {
  it('visits chebyshev+1 cells from start to end with unit steps (stopDistance 0)', () => {
    fc.assert(
      fc.property(arbCell, arbCell, (start, end) => {
        const visited = trace(start, end);
        const dm = chebyshev(start, end);

        expect(visited).toHaveLength(dm + 1);
        expect(visited[0]).toEqual(start);
        expect(visited[visited.length - 1]).toEqual(end);
        for (let i = 1; i < visited.length; i++) {
          expect(chebyshev(visited[i - 1], visited[i])).toBe(1);
        }
      })
    );
  });

  it('with stopDistance s, visits max(1, dm - s + 1) cells, all at least s dominant-axis steps from the end (except the protected start visit)', () => {
    fc.assert(
      fc.property(
        arbCell,
        arbCell,
        fc.integer({ min: 0, max: 10 }),
        (start, end, stopDistance) => {
          const visited = trace(start, end, stopDistance);
          const dm = chebyshev(start, end);

          expect(visited).toHaveLength(Math.max(1, dm - stopDistance + 1));
          // Every visited cell except the unconditional start visit keeps
          // the stop distance to the endpoint (Unity parity: the start
          // cell is visited even when dm <= stopDistance).
          for (const cell of visited.slice(1)) {
            expect(chebyshev(cell, end)).toBeGreaterThanOrEqual(stopDistance);
          }
        }
      )
    );
  });

  // The safety cap must hold on whichever axis is dominant, in either
  // direction — so the freeze guard cannot be slipped past by routing the
  // huge span through y/z or a negative delta.
  it('throws RangeError for any over-cap span without ever visiting a cell', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }), // dominant axis
        fc.constantFrom(1, -1), // direction
        fc.integer({ min: 1, max: 1_000_000 }), // overshoot beyond the cap
        (axis, sign, overshoot) => {
          const end: [number, number, number] = [0, 0, 0];
          end[axis] = sign * (MAX_TRACE_STEPS + overshoot);
          let visited = 0;
          expect(() =>
            bresenham3d([0, 0, 0], end, () => {
              visited++;
              return true;
            })
          ).toThrow(RangeError);
          expect(visited).toBe(0);
        }
      )
    );
  });
});
