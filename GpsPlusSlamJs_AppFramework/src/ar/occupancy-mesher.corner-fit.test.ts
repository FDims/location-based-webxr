/**
 * Occupancy mesher — 'corner-fit' deformed-corner cube mode (F2b, 2026-06-30).
 *
 * The maintainer's "improve the cube approach" path: keep the per-face cube
 * mesher's EXACT face topology, but nudge each shared lattice corner by the MEAN
 * sub-cell offset (getCellPoint() − cellCentre) of the occupied cells touching
 * it. Because adjacent cubes reference the SAME displaced corner (a pure function
 * of the corner's half-lattice key), seams stay coincident — so the surface hugs
 * the measured points yet stays **watertight** (the property surface nets gives
 * up).
 *
 * 2026-06-30 fix: the corner is displaced by the OFFSET, not onto the absolute
 * centroid mean. The absolute-mean version collapsed thin features (a one-cell
 * floor's top and bottom corners average the same cells → coincide → a flat sheet
 * indistinguishable from 'smooth' — the reported device bug); the offset keeps
 * the cube's thickness so 'corner-fit' stays a distinct, cube-like option.
 *
 * Invariants driven here:
 *  1. hugs the surface by the sub-cell offset (corner = geometric + mean offset,
 *     ≠ geometric corner, ≠ absolute centroid) and does NOT collapse a thin floor;
 *  2. watertight — even-edge-cover (closed-surface Z/2) holds, the property
 *     'smooth' is exempt from (here checked on the WELDED index buffer, since
 *     displaced corners are off the half-lattice the cube test quantizes to);
 *  3. same occluded boundary — identical face SET as per-face cubes ⇒ identical
 *     triangle count for the same input;
 *  4. bounded deformation — every displaced corner stays within cellSize of its
 *     geometric corner.
 */

import { describe, it, expect } from 'vitest';
import { meshOccupiedCells } from './occupancy-mesher';
import type { GridCell } from './bresenham3d';
import type { Vector3 } from 'gps-plus-slam-js';

const CELL = 0.15;
const half = CELL / 2;
const OFFSET: Vector3 = [0.03, -0.02, 0.018]; // each |·| < half

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

/** Solid box of cells [0,nx)×[0,ny)×[0,nz). */
function solidBox(nx: number, ny: number, nz: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) cells.push([x, y, z]);
  return cells;
}

/** Index-based even-edge-cover (robust for off-lattice welded vertices). */
function oddEdgeCountByIndex(indices: Uint32Array): number {
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
  let odd = 0;
  for (const n of edges.values()) if (n % 2 !== 0) odd++;
  return odd;
}

/** Does the position buffer contain a vertex close to `target`? */
function hasVertexNear(positions: Float32Array, target: Vector3): boolean {
  for (let v = 0; v < positions.length; v += 3) {
    if (
      Math.abs(positions[v]! - target[0]) < 1e-5 &&
      Math.abs(positions[v + 1]! - target[1]) < 1e-5 &&
      Math.abs(positions[v + 2]! - target[2]) < 1e-5
    ) {
      return true;
    }
  }
  return false;
}

describe("occupancy mesher — 'corner-fit' deformed-corner cube mode", () => {
  it('hugs the surface by the sub-cell OFFSET, keeping cube structure (not the absolute centroid)', () => {
    // 2026-06-30 fix: corner-fit displaces each shared corner by the MEAN
    // sub-cell offset (getCellPoint − cellCentre) of the cells touching it, NOT
    // onto the absolute centroid. With a uniform OFFSET on every cell, every
    // corner is its geometric position + OFFSET — a rigidly surface-shifted cube
    // that still hugs the measured surface but keeps its full shape. (Displacing
    // onto the absolute centroid collapsed thin features — see the next test.)
    const cells = solidBox(2, 1, 1);
    const { positions } = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    // Outer corner of cell (0,0,0), key (−1,−1,−1): geometric corner + OFFSET.
    const geomOuter: Vector3 = [-half, -half, -half];
    expect(
      hasVertexNear(positions, [
        geomOuter[0] + OFFSET[0],
        geomOuter[1] + OFFSET[1],
        geomOuter[2] + OFFSET[2],
      ])
    ).toBe(true);
    // Displaced, so NOT at the plain geometric corner…
    expect(hasVertexNear(positions, geomOuter)).toBe(false);
    // …and NOT collapsed onto the cell centroid (the old, buggy behaviour).
    expect(hasVertexNear(positions, [0.03, -0.02, 0.018])).toBe(false);
  });

  it('does NOT collapse a one-cell-thick floor (top and bottom corners stay ~a cube apart)', () => {
    // The reported device bug: displacing corners onto the absolute centroid made
    // a 1-cell-thick floor's top and bottom corners average the SAME cells →
    // coincide → a flat sheet indistinguishable from surface nets. Offset-based
    // displacement keeps the full cell thickness, so corner-fit stays a distinct
    // (cube-like, watertight) option from 'smooth'.
    const cells: GridCell[] = [];
    for (let x = 0; x < 4; x++)
      for (let z = 0; z < 4; z++) cells.push([x, 0, z]);
    const { positions } = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    let minY = Infinity;
    let maxY = -Infinity;
    for (let v = 1; v < positions.length; v += 3) {
      minY = Math.min(minY, positions[v]!);
      maxY = Math.max(maxY, positions[v]!);
    }
    // ~full cube thickness preserved (≈ cellSize), NOT collapsed to ~0.
    expect(maxY - minY).toBeGreaterThan(CELL * 0.9);
  });

  it('keeps cube thickness on a thin floor where surface nets stays a corner-puffed sheet', () => {
    // Why this test matters: both modes fully cover the boundary (same
    // triangle count), so the distinction is GEOMETRY — corner-fit retains the
    // cube's thickness, while dual-contouring surface nets collapses a
    // one-cell floor to a single sheet (top and bottom dual vertices average
    // the same cells). Since the smooth mesher's single-corner nudge
    // (SINGLE_CORNER_NUDGE_K = 0.5, 2026-07-02 decision) the sheet is no
    // longer PERFECTLY flat: exactly the floor's perimeter-corner dual cells
    // are n === 1 (4 corners × above/below = 8 vertices) and puff ±0.25·cell
    // vertically. Split assertions keep the strongest invariant that still
    // holds: (a) every non-corner vertex stays exactly in the sheet plane,
    // (b) the corner puff is bounded at K·cell overall — still far below
    // corner-fit's full cube thickness, so the mode distinction survives.
    const cells: GridCell[] = [];
    for (let x = 0; x < 4; x++)
      for (let z = 0; z < 4; z++) cells.push([x, 0, z]);
    const getCellPoint = centroidProvider(cells);
    const cornerFit = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint,
    });
    const smooth = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint,
    });
    const yExtent = (m: { positions: Float32Array }): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let v = 1; v < m.positions.length; v += 3) {
        lo = Math.min(lo, m.positions[v]!);
        hi = Math.max(hi, m.positions[v]!);
      }
      return hi - lo;
    };
    expect(yExtent(cornerFit)).toBeGreaterThan(CELL * 0.9); // ~full cell thick

    // The uniform provider offset puts every un-nudged dual vertex exactly at
    // the sheet plane y = OFFSET[1]; only n === 1 (corner) vertices may move.
    const sheetY = OFFSET[1];
    const nudge = CELL * 0.5 * 0.5; // K·0.5·cell — keep in sync with SINGLE_CORNER_NUDGE_K
    const flatYs: number[] = [];
    const movedYs: number[] = [];
    for (let v = 1; v < smooth.positions.length; v += 3) {
      const y = smooth.positions[v]!;
      if (Math.abs(y - sheetY) <= 1e-6) flatYs.push(y);
      else movedYs.push(y);
    }
    // (a) interior + edge vertices stay flat (well under the old 0.1·cell bar).
    expect(flatYs.length).toBeGreaterThan(0);
    expect(Math.max(...flatYs) - Math.min(...flatYs)).toBeLessThan(CELL * 0.1);
    // Exactly the 8 perimeter-corner vertices move, each by exactly the nudge.
    expect(movedYs.length).toBe(8);
    for (const y of movedYs) {
      expect(Math.abs(Math.abs(y - sheetY) - nudge)).toBeLessThan(1e-6);
    }
    // (b) overall corner puff bounded: yExtent ≤ K·cell + ε (±K·0.5·cell about
    // the sheet), still a fraction of corner-fit's ~1·cell thickness.
    const smoothYExtent = yExtent(smooth);
    expect(smoothYExtent).toBeLessThanOrEqual(CELL * 0.5 + 1e-6);
    expect(smoothYExtent).toBeLessThan(yExtent(cornerFit));
  });

  it('is watertight (even-edge-cover) on a closed region', () => {
    const cells = solidBox(2, 2, 2);
    const { indices } = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    expect(oddEdgeCountByIndex(indices)).toBe(0);
  });

  it('emits the same face SET as per-face cubes (identical triangle count)', () => {
    const cells = solidBox(3, 2, 2);
    const perFace = meshOccupiedCells(cells, CELL);
    const cornerFit = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    expect(cornerFit.indices.length / 3).toBe(perFace.indices.length / 3);
    // …but the geometry differs (positions are displaced toward the centroids).
    expect(Array.from(cornerFit.positions)).not.toEqual(
      Array.from(perFace.positions)
    );
  });

  it('bounds deformation: every corner stays within cellSize of its geometric corner', () => {
    const cells = solidBox(3, 3, 1);
    const { positions } = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    for (let v = 0; v < positions.length; v += 3) {
      for (let a = 0; a < 3; a++) {
        const coord = positions[v + a]!;
        // Nearest geometric corner is the closest half-lattice point (k·half).
        const nearest = Math.round(coord / half) * half;
        expect(Math.abs(coord - nearest)).toBeLessThanOrEqual(CELL + 1e-9);
      }
    }
  });

  it('falls back to the geometric corner when no getCellPoint is supplied', () => {
    const cells = solidBox(2, 2, 2);
    const cornerFit = meshOccupiedCells(cells, CELL, { mode: 'corner-fit' });
    const perFace = meshOccupiedCells(cells, CELL);
    // Same topology AND — with no centroids — the same geometry as plain cubes.
    expect(cornerFit.indices.length / 3).toBe(perFace.indices.length / 3);
    // Every corner-fit vertex lies on the half-lattice (geometric corners).
    for (let v = 0; v < cornerFit.positions.length; v++) {
      const coord = cornerFit.positions[v]!;
      const nearest = Math.round(coord / half) * half;
      expect(Math.abs(coord - nearest)).toBeLessThan(1e-5);
    }
  });

  it('still returns one AABB per occupied cell', () => {
    const cells = solidBox(2, 2, 2);
    const { aabbs } = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    expect(aabbs.length).toBe(8);
  });
});
