/**
 * Occupancy mesher — 'smooth' surface-nets mode (F2, 2026-06-30).
 *
 * Why these tests matter: the cube meshers snap geometry to the cell lattice and
 * throw away the per-cell measured centroid (`getCellPoint()`), giving the
 * "smooth grid, blocky mesh" the user saw. The 'smooth' mode is a minimal
 * surface-nets pass that places ONE welded vertex per occupied surface cell AT
 * its centroid and connects them into a continuous sheet.
 *
 * These drive the design by INVARIANTS (per the F2 plan), NOT a hand-specified
 * vertex formula:
 *  1. centroid is consumed — vertices sit at getCellPoint(), within cellSize/2
 *     of the cell centre (≠ centre);
 *  2. crack-free WELDED manifold — adjacent quads share the same vertex index,
 *     no coincident-but-duplicated vertices, no T-junctions — but explicitly
 *     NOT the cube mesher's closed-surface (even-edge-cover) invariant: a sheet
 *     over a thin feature (the floor) is an OPEN manifold by design;
 *  3. boundary coverage — a full flat patch is tiled with no internal holes;
 *  4. triangle budget — ≤ the per-face cube count for the same input.
 *
 * KNOWN SCOPE (documented, not a bug): this minimal surface nets connects
 * coplanar surface cells. Flat/convex exposed surfaces (the floor — the
 * motivating case) are fully covered; bridging the concave seam where two
 * perpendicular surfaces meet (e.g. wall-meets-floor) is left to the deferred
 * full QEF/dual-contouring solver (F2 "Explicitly still deferred").
 */

import { describe, it, expect } from 'vitest';
import { meshOccupiedCells } from './occupancy-mesher';
import type { GridCell } from './bresenham3d';
import type { Vector3 } from 'gps-plus-slam-js';

const CELL = 0.15;
const half = CELL / 2;

/** A getCellPoint that hugs a known sub-cell offset, so centroids are testable. */
const OFFSET: Vector3 = [0.03, -0.02, 0.018]; // each |·| < half (0.075)
function centroidProvider(cells: Iterable<GridCell>) {
  const occ = new Set<string>();
  for (const [x, y, z] of cells) occ.add(`${x},${y},${z}`);
  return (cell: GridCell): Vector3 | null => {
    if (!occ.has(`${cell[0]},${cell[1]},${cell[2]}`)) return null;
    return [
      cell[0] * CELL + OFFSET[0],
      cell[1] * CELL + OFFSET[1],
      cell[2] * CELL + OFFSET[2],
    ];
  };
}

/** A flat single-cell-thick patch in the X–Z plane (y = 0), w×d cells. */
function flatPatch(w: number, d: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) cells.push([i, 0, k]);
  return cells;
}

/** Reconstruct undirected edge cover counts from a welded index buffer. */
function edgeCover(indices: Uint32Array): Map<string, number> {
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    for (const [a, b] of [
      [tri[0]!, tri[1]!],
      [tri[1]!, tri[2]!],
      [tri[2]!, tri[0]!],
    ] as const) {
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  return edges;
}

describe("occupancy mesher — 'smooth' surface-nets mode", () => {
  it('places one welded vertex per surface cell AT its centroid (consumes getCellPoint)', () => {
    const cells = flatPatch(3, 3); // 9 cells, all on the sheet
    const { positions } = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    // One vertex per cell (all 9 participate in the tiled sheet).
    expect(positions.length / 3).toBe(9);
    // Every vertex equals some cell's centre + OFFSET, within half per axis, ≠ centre.
    for (let v = 0; v < positions.length; v += 3) {
      const p: Vector3 = [positions[v]!, positions[v + 1]!, positions[v + 2]!];
      const cell: GridCell = [
        Math.round(p[0] / CELL),
        Math.round(p[1] / CELL),
        Math.round(p[2] / CELL),
      ];
      for (let a = 0; a < 3; a++) {
        expect(p[a]).toBeCloseTo(cell[a]! * CELL + OFFSET[a]!, 6);
        expect(Math.abs(p[a]! - cell[a]! * CELL)).toBeLessThan(half);
        expect(p[a]).not.toBe(cell[a]! * CELL); // genuinely displaced
      }
    }
  });

  it('falls back to the cell centre when no getCellPoint is supplied (plain surface nets)', () => {
    const cells = flatPatch(2, 2);
    const { positions } = meshOccupiedCells(cells, CELL, { mode: 'smooth' });
    for (let v = 0; v < positions.length; v += 3) {
      // Centre fallback → on the lattice: each coord is an integer multiple of
      // CELL (within Float32 round-trip tolerance, not the f64 epsilon).
      const coord = positions[v]!;
      const nearest = Math.round(coord / CELL) * CELL;
      expect(Math.abs(coord - nearest)).toBeLessThan(1e-5);
    }
  });

  it('is a crack-free WELDED manifold (shared indices, no T-junctions) — not closed', () => {
    const cells = flatPatch(4, 4);
    const { positions, indices } = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    // Welded: no two vertices share a position (each cell contributes one).
    const seen = new Set<string>();
    for (let v = 0; v < positions.length; v += 3) {
      const key = `${positions[v]},${positions[v + 1]},${positions[v + 2]}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    const edges = edgeCover(indices);
    // Crack-free: every edge is covered once (sheet boundary) or twice (interior).
    // No edge covered 3+ times ⇒ no T-junctions / non-manifold seams.
    for (const n of edges.values()) expect(n).toBeLessThanOrEqual(2);
    // OPEN by design: a one-cell-thick sheet has boundary edges (covered once),
    // so it is explicitly NOT closed (even-edge-cover would be unsatisfiable).
    let odd = 0;
    for (const n of edges.values()) if (n % 2 !== 0) odd++;
    expect(odd).toBeGreaterThan(0);
  });

  it('tiles a full flat patch with no internal holes (boundary coverage)', () => {
    const W = 5;
    const D = 4;
    const cells = flatPatch(W, D);
    const { indices } = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    // A full W×D rectangle of cells tiles into (W-1)×(D-1) quads = 2 triangles each.
    expect(indices.length / 3).toBe((W - 1) * (D - 1) * 2);
  });

  it('emits ≤ the per-face cube triangle count for the same input', () => {
    const cells = flatPatch(6, 6);
    const perFace = meshOccupiedCells(cells, CELL);
    const smooth = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    expect(smooth.indices.length / 3).toBeGreaterThan(0);
    expect(smooth.indices.length / 3).toBeLessThanOrEqual(
      perFace.indices.length / 3
    );
  });

  it('still returns one AABB per occupied cell (mode-independent)', () => {
    const cells = flatPatch(3, 2);
    const { aabbs } = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    expect(aabbs.length).toBe(6);
  });

  it("back-compat: greedy:true still maps to the 'greedy' mode", () => {
    const cells = flatPatch(4, 4);
    const greedyBool = meshOccupiedCells(cells, CELL, { greedy: true });
    const greedyMode = meshOccupiedCells(cells, CELL, { mode: 'greedy' });
    expect(greedyMode.indices.length).toBe(greedyBool.indices.length);
    // and it is NOT the smooth output
    const smooth = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    expect(smooth.indices.length).not.toBe(greedyBool.indices.length);
  });
});
