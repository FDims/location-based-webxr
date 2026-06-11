/**
 * AR-Space Occupancy Grid
 *
 * TS port of the Unity voxel grid (`PointCloudData.cs`): folds the
 * persisted depth-sample stream (`recording/recordDepthSample`) into a
 * sparse 3D grid of occupied cells in raw WebXR space, with free-space
 * carving along each camera→point ray. Plain in-memory class — no THREE,
 * no DOM, no Redux; it is fed by store subscribers (the action stream is
 * the persisted source of truth, the grid is derived state).
 *
 * Deliberate deviations from the Unity original (2026-06-11 port plan):
 * - Cells hold an OBSERVATION COUNT (WebXR exposes no per-pixel
 *   confidence; the count is the noise-suppression analogue), not a render
 *   buffer index.
 * - Carving is skipped when camera and point share a cell, and the
 *   endpoint cell itself is never carved — Unity's carve-then-re-add would
 *   reset the count.
 * - `getCellCenter` is `cell · cellSizeM`, the true center under
 *   round-quantization (Unity's `CellToWorldPos` adds a spurious half
 *   cell).
 *
 * @see occupancy-grid.ts.md for detailed documentation
 */

import type { Vector3 } from 'gps-plus-slam-js';
import type { DepthSample } from '../types/ar-types';
import { unprojectDepthPoint } from './depth-unprojection';
import { bresenham3d, type GridCell } from './bresenham3d';

export interface OccupancyGridOptions {
  /** Edge length of a cubic grid cell in meters. Default 0.15 (Unity parity). */
  readonly cellSizeM?: number;
  /**
   * Dominant-axis steps before a ray's endpoint at which free-space
   * carving stops, to respect depth noise. Default 2 (Unity parity).
   */
  readonly carveStopCells?: number;
}

interface CellRecord {
  readonly cell: GridCell;
  /** Number of depth points observed in this cell. */
  count: number;
}

export class OccupancyGrid {
  readonly cellSizeM: number;
  readonly carveStopCells: number;
  private readonly cells = new Map<string, CellRecord>();

  constructor(options?: OccupancyGridOptions) {
    const cellSizeM = options?.cellSizeM ?? 0.15;
    const carveStopCells = options?.carveStopCells ?? 2;
    if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
      throw new RangeError(
        `cellSizeM must be a positive number, got ${cellSizeM}`
      );
    }
    if (!Number.isSafeInteger(carveStopCells) || carveStopCells < 0) {
      throw new RangeError(
        `carveStopCells must be a non-negative integer, got ${carveStopCells}`
      );
    }
    this.cellSizeM = cellSizeM;
    this.carveStopCells = carveStopCells;
  }

  /** Number of occupied cells. */
  get size(): number {
    return this.cells.size;
  }

  /**
   * Fold one depth sample into the grid: unproject each point, carve free
   * space from the camera cell to the point cell, then count the point's
   * cell as occupied. Points that cannot be unprojected (no
   * projectionMatrix on old recordings, invalid depth/coords) are skipped.
   *
   * @returns the number of points actually added.
   */
  addSample(sample: DepthSample): number {
    if (!isFiniteTriple(sample.cameraPos)) {
      return 0;
    }
    const cameraCell = this.cellForPosition(sample.cameraPos);
    let added = 0;
    for (const point of sample.points) {
      const world = unprojectDepthPoint(
        point,
        sample.cameraPos,
        sample.cameraRot,
        sample.projectionMatrix
      );
      if (!world) {
        continue;
      }
      const cell = this.cellForPosition(world);
      if (!cellsEqual(cameraCell, cell)) {
        this.carve(cameraCell, cell);
      }
      this.increment(cell);
      added++;
    }
    return added;
  }

  /** Occupied cells observed at least `minObservations` times (default 1). */
  getOccupiedCells(minObservations = 1): GridCell[] {
    const result: GridCell[] = [];
    for (const record of this.cells.values()) {
      if (record.count >= minObservations) {
        result.push(record.cell);
      }
    }
    return result;
  }

  /** Quantize a raw-WebXR position to its grid cell (round per axis). */
  cellForPosition(pos: Vector3): GridCell {
    // `+ 0` normalizes Math.round's -0 so cell coordinates compare cleanly
    return [
      Math.round(pos[0] / this.cellSizeM) + 0,
      Math.round(pos[1] / this.cellSizeM) + 0,
      Math.round(pos[2] / this.cellSizeM) + 0,
    ];
  }

  /** Center of a cell in raw WebXR space (round-consistent: cell · cellSizeM). */
  getCellCenter(cell: GridCell): Vector3 {
    return [
      cell[0] * this.cellSizeM,
      cell[1] * this.cellSizeM,
      cell[2] * this.cellSizeM,
    ];
  }

  /**
   * Walk the grid from `startPos` to `endPos` and return the center of the
   * first cell occupied at least `minObservations` times, or null.
   * Port of Unity's `TryRaycast` (hook for cursor/floor-detection parity).
   */
  raycast(
    startPos: Vector3,
    endPos: Vector3,
    minObservations = 1
  ): Vector3 | null {
    if (!isFiniteTriple(startPos) || !isFiniteTriple(endPos)) {
      return null;
    }
    let hit: GridCell | null = null;
    bresenham3d(
      this.cellForPosition(startPos),
      this.cellForPosition(endPos),
      (cell) => {
        const record = this.cells.get(cellKey(cell));
        if (record && record.count >= minObservations) {
          hit = cell;
          return false; // ray can stop at the first hit
        }
        return true;
      }
    );
    return hit ? this.getCellCenter(hit) : null;
  }

  /** Remove all occupied cells (e.g. on store swap / new session). */
  clear(): void {
    this.cells.clear();
  }

  /**
   * Delete occupied cells along the camera→point ray (the space was seen
   * through, so it must be free), stopping `carveStopCells` dominant-axis
   * steps before the endpoint. The endpoint cell itself is additionally
   * protected so a current observation is never erased (relevant for
   * carveStopCells = 0 and for the unconditional start-cell visit).
   */
  private carve(cameraCell: GridCell, pointCell: GridCell): void {
    bresenham3d(
      cameraCell,
      pointCell,
      (cell) => {
        if (!cellsEqual(cell, pointCell)) {
          this.cells.delete(cellKey(cell));
        }
        return true;
      },
      this.carveStopCells
    );
  }

  private increment(cell: GridCell): void {
    const key = cellKey(cell);
    const record = this.cells.get(key);
    if (record) {
      record.count++;
    } else {
      this.cells.set(key, { cell, count: 1 });
    }
  }
}

function cellKey(cell: GridCell): string {
  return `${cell[0]},${cell[1]},${cell[2]}`;
}

function cellsEqual(a: GridCell, b: GridCell): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function isFiniteTriple(v: Vector3): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}
