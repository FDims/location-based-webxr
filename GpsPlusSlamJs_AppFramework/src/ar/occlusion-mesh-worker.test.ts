/**
 * Occlusion-mesh worker protocol — pack/run round-trip tests.
 *
 * The whole point of the worker offload is that meshing off-thread produces the
 * SAME geometry as meshing inline. These pin that: `runMeshRequest(packMeshRequest(…))`
 * must equal a direct `meshOccupiedCells` for every mode (centroids carried at
 * f64 so surface-hugging modes match byte-for-byte), and null centroids must
 * degrade to the geometric fallback.
 */

import { describe, it, expect } from 'vitest';
import { packMeshRequest, runMeshRequest } from './occlusion-mesh-worker';
import { meshOccupiedCells, type MeshMode } from './occupancy-mesher';
import type { GridCell } from './bresenham3d';
import type { Vector3 } from 'gps-plus-slam-js';

const CELL = 0.15;
const OFFSET: Vector3 = [0.03, -0.02, 0.018];

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

function solidBox(nx: number, ny: number, nz: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) cells.push([x, y, z]);
  return cells;
}

const MODES: MeshMode[] = ['per-face', 'greedy', 'smooth', 'corner-fit'];

describe('occlusion mesh worker — pack/run round-trip', () => {
  for (const mode of MODES) {
    it(`round-trips '${mode}' identically to a direct mesh`, () => {
      const cells = solidBox(4, 2, 3);
      const getCellPoint = centroidProvider(cells);
      const { request, transfer } = packMeshRequest(
        7,
        cells,
        CELL,
        mode,
        getCellPoint
      );

      expect(request.id).toBe(7);
      expect(request.mode).toBe(mode);
      // Cube modes ship no centroids (1 buffer); surface modes ship 2.
      const surfaceMode = mode === 'smooth' || mode === 'corner-fit';
      expect(transfer.length).toBe(surfaceMode ? 2 : 1);
      expect(request.centroids === null).toBe(!surfaceMode);

      const { response } = runMeshRequest(request);
      const direct = meshOccupiedCells(cells, CELL, { mode, getCellPoint });

      expect(response.id).toBe(7);
      expect(Array.from(response.indices)).toEqual(Array.from(direct.indices));
      expect(Array.from(response.positions)).toEqual(
        Array.from(direct.positions)
      );
    });
  }

  it("handles null getCellPoint (a cell's centroid is null) as the geometric fallback", () => {
    const cells = solidBox(3, 1, 3);
    // Provider that returns null for the x=0 column (e.g. never colour/point-observed).
    const full = centroidProvider(cells);
    const gp = (c: GridCell): Vector3 | null => (c[0] === 0 ? null : full(c));

    const { request } = packMeshRequest(1, cells, CELL, 'smooth', gp);
    const { response } = runMeshRequest(request);
    const direct = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: gp,
    });

    expect(Array.from(response.positions)).toEqual(
      Array.from(direct.positions)
    );
    expect(Array.from(response.indices)).toEqual(Array.from(direct.indices));
  });

  it('transfers the packed buffers (main-thread arrays are detached after posting)', () => {
    const cells = solidBox(2, 2, 2);
    const { request, transfer } = packMeshRequest(
      3,
      cells,
      CELL,
      'smooth',
      centroidProvider(cells)
    );
    // The transfer list is exactly the request's backing buffers.
    expect(transfer).toContain(request.cells.buffer);
    expect(transfer).toContain(request.centroids!.buffer);
  });

  // --- Flat snapshot input (Step 1.3 of the 2026-07-03 long-session fps plan) ---
  // Why these tests matter: the tuple-array input made pack re-flatten a
  // snapshot the grid can now hand over flat (`getOccupiedCellsFlat`). A flat
  // Int32Array must produce a byte-identical request WITHOUT copying, and the
  // centroid fill must still resolve every cell.

  function flatten(cells: readonly GridCell[]): Int32Array {
    const flat = new Int32Array(cells.length * 3);
    cells.forEach((c, i) => {
      flat[i * 3] = c[0];
      flat[i * 3 + 1] = c[1];
      flat[i * 3 + 2] = c[2];
    });
    return flat;
  }

  it('accepts a flat Int32Array snapshot without copying and meshes identically', () => {
    const cells = solidBox(4, 2, 3);
    const flat = flatten(cells);
    const getCellPoint = centroidProvider(cells);

    const fromFlat = packMeshRequest(9, flat, CELL, 'smooth', getCellPoint);
    const fromTuples = packMeshRequest(9, cells, CELL, 'smooth', getCellPoint);

    // Zero-copy: the request carries the caller's flat array itself.
    expect(fromFlat.request.cells).toBe(flat);
    expect(fromFlat.transfer).toContain(flat.buffer);
    // Byte-identical request → byte-identical mesh.
    expect(Array.from(fromFlat.request.cells)).toEqual(
      Array.from(fromTuples.request.cells)
    );
    expect(Array.from(fromFlat.request.centroids!)).toEqual(
      Array.from(fromTuples.request.centroids!)
    );
    const { response } = runMeshRequest(fromFlat.request);
    const direct = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint,
    });
    expect(Array.from(response.positions)).toEqual(
      Array.from(direct.positions)
    );
    expect(Array.from(response.indices)).toEqual(Array.from(direct.indices));
  });

  it('rejects a flat snapshot whose length is not a multiple of 3', () => {
    expect(() =>
      packMeshRequest(1, new Int32Array([1, 2, 3, 4]), CELL, 'greedy')
    ).toThrow(RangeError);
  });
});
