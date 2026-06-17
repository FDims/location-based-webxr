/**
 * Tests for createDepthGridLookup — bilinear depth over the sampler grid (WS-A).
 *
 * Why this matters: the QR size measurer samples depth at arbitrary interior
 * points across a (possibly sub-grid-cell) QR. Nearest-neighbour snapping made
 * every point collapse onto one node; bilinear interpolation must reproduce node
 * values exactly, interpolate smoothly between them, refuse to extrapolate
 * outside the grid, and refuse to interpolate across a hole.
 */

import { describe, it, expect } from 'vitest';
import { createDepthGridLookup } from './depth-grid-lookup';
import type { DepthPoint } from '../types/ar-types';

/** Build a g×g grid (row-major) whose depth is `f(col,row)` at each node. */
function grid(
  g: number,
  f: (col: number, row: number) => number
): DepthPoint[] {
  const pts: DepthPoint[] = [];
  for (let row = 0; row < g; row++) {
    for (let col = 0; col < g; col++) {
      pts.push({
        screenX: (col + 1) / (g + 1),
        screenY: (row + 1) / (g + 1),
        depthM: f(col, row),
      });
    }
  }
  return pts;
}

const nodeScreen = (i: number, g: number): number => (i + 1) / (g + 1);

describe('createDepthGridLookup', () => {
  it('reproduces a node value exactly at the node position', () => {
    const g = 4;
    const lut = createDepthGridLookup(grid(g, (c, r) => 1 + 0.1 * c + 0.2 * r));
    const d = lut.depthAt(nodeScreen(2, g), nodeScreen(1, g));
    expect(d).toBeCloseTo(1 + 0.1 * 2 + 0.2 * 1, 9);
  });

  it('interpolates linearly between nodes (planar gradient is exact)', () => {
    // A plane depth = 1 + 0.1·col + 0.2·row is reproduced exactly by bilinear
    // interpolation at any interior point, since bilinear is exact for planes.
    const g = 5;
    const f = (c: number, r: number): number => 1 + 0.1 * c + 0.2 * r;
    const lut = createDepthGridLookup(grid(g, f));
    // Halfway between nodes (col 1↔2, row 2↔3): expected = f(1.5, 2.5).
    const sx = (nodeScreen(1, g) + nodeScreen(2, g)) / 2;
    const sy = (nodeScreen(2, g) + nodeScreen(3, g)) / 2;
    expect(lut.depthAt(sx, sy)).toBeCloseTo(1 + 0.1 * 1.5 + 0.2 * 2.5, 9);
  });

  it('infers gridSize from points.length when omitted', () => {
    const g = 3;
    const lut = createDepthGridLookup(grid(g, () => 2)); // no gridSize arg
    expect(lut.depthAt(0.5, 0.5)).toBeCloseTo(2, 9);
  });

  it('returns null outside the node bounding box (no extrapolation)', () => {
    const lut = createDepthGridLookup(grid(4, () => 1));
    expect(lut.depthAt(0.01, 0.5)).toBeNull(); // left of the first node column
    expect(lut.depthAt(0.99, 0.5)).toBeNull(); // right of the last node column
  });

  it('returns null when a surrounding node is a hole (depth ≤ 0 / non-finite)', () => {
    const g = 4;
    const pts = grid(g, () => 1);
    // Punch a hole at node (col 2, row 1).
    pts[1 * g + 2] = { ...pts[1 * g + 2]!, depthM: 0 };
    const lut = createDepthGridLookup(pts);
    // A query whose interpolation cell includes that node must be null…
    const sx = (nodeScreen(1, g) + nodeScreen(2, g)) / 2;
    const sy = (nodeScreen(1, g) + nodeScreen(2, g)) / 2;
    expect(lut.depthAt(sx, sy)).toBeNull();
    // …while a cell that avoids the hole still interpolates.
    const sx2 = (nodeScreen(0, g) + nodeScreen(1, g)) / 2;
    const sy2 = (nodeScreen(2, g) + nodeScreen(3, g)) / 2;
    expect(lut.depthAt(sx2, sy2)).toBeCloseTo(1, 9);
  });
});
