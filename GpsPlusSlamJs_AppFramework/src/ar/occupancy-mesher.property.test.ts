/**
 * Occupancy Mesher — property-based tests.
 *
 * Why this test matters:
 * Face culling has a handful of invariants that must hold for ANY occupied set,
 * not just the hand-picked fixtures in the unit test. These are exact, oracle-
 * able properties (so real recordings are unnecessary here — see the plan's §8
 * test strategy): (1) the emitted face count equals the number of empty
 * 6-neighbours summed over cells; (2) the surface is watertight — every edge is
 * covered an even number of times (the boundary of a solid voxel region is a
 * closed Z/2 2-cycle, even across the non-manifold edges that diagonal-touching
 * voxels create); (3) indices are in range and positions finite; (4) the output
 * is permutation-invariant in face count; (5) one AABB per unique cell.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { GridCell } from './bresenham3d';
import { meshOccupiedCells } from './occupancy-mesher';

const CELL_SIZE = 0.15;

/** Arbitrary small set of integer cells within a bounded box (allows overlaps). */
const cellsArb = fc.array(
  fc.tuple(
    fc.integer({ min: -3, max: 3 }),
    fc.integer({ min: -3, max: 3 }),
    fc.integer({ min: -3, max: 3 })
  ),
  { minLength: 0, maxLength: 40 }
);

function dedupeKeys(cells: readonly GridCell[]): Set<string> {
  const set = new Set<string>();
  for (const [x, y, z] of cells) set.add(`${x},${y},${z}`);
  return set;
}

/** Expected exposed-face count: empty 6-neighbours summed over unique cells. */
function expectedFaceCount(cells: readonly GridCell[]): number {
  const set = dedupeKeys(cells);
  const offsets: GridCell[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let faces = 0;
  for (const key of set) {
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    for (const [dx, dy, dz] of offsets) {
      if (!set.has(`${x + dx},${y + dy},${z + dz}`)) faces++;
    }
  }
  return faces;
}

/** Quantize a coordinate to an integer half-cell lattice index (exact). */
function halfIndex(coord: number): number {
  return Math.round(coord / (CELL_SIZE / 2));
}

describe('meshOccupiedCells — properties', () => {
  it('emits exactly one face per empty 6-neighbour', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const { indices } = meshOccupiedCells(cells, CELL_SIZE);
        expect(indices.length / 6).toBe(expectedFaceCount(cells));
      })
    );
  });

  it('produces a watertight surface — every edge is covered an even number of times', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const { positions, indices } = meshOccupiedCells(cells, CELL_SIZE);
        const edgeCounts = new Map<string, number>();
        const vertKey = (i: number): string => {
          const o = i * 3;
          return `${halfIndex(positions[o]!)},${halfIndex(
            positions[o + 1]!
          )},${halfIndex(positions[o + 2]!)}`;
        };
        const addEdge = (a: number, b: number): void => {
          const ka = vertKey(a);
          const kb = vertKey(b);
          const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
        };
        for (let t = 0; t < indices.length; t += 3) {
          const a = indices[t]!;
          const b = indices[t + 1]!;
          const c = indices[t + 2]!;
          addEdge(a, b);
          addEdge(b, c);
          addEdge(c, a);
        }
        for (const count of edgeCounts.values()) {
          expect(count % 2).toBe(0);
        }
      })
    );
  });

  it('emits in-range indices and finite positions', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const { positions, indices } = meshOccupiedCells(cells, CELL_SIZE);
        const vertexCount = positions.length / 3;
        for (const idx of indices) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(vertexCount);
        }
        for (const p of positions) expect(Number.isFinite(p)).toBe(true);
      })
    );
  });

  it('is permutation-invariant in face count and AABB count', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const a = meshOccupiedCells(cells, CELL_SIZE);
        const shuffled = [...cells].reverse();
        const b = meshOccupiedCells(shuffled, CELL_SIZE);
        expect(b.indices.length).toBe(a.indices.length);
        expect(b.aabbs.length).toBe(a.aabbs.length);
      })
    );
  });

  it('emits exactly one AABB per unique cell', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const { aabbs } = meshOccupiedCells(cells, CELL_SIZE);
        expect(aabbs.length).toBe(dedupeKeys(cells).size);
      })
    );
  });
});
