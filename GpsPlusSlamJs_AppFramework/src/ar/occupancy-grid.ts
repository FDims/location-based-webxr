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
import type { DepthSample, RgbTuple } from '../types/ar-types';
import { createDepthUnprojector } from './depth-unprojection';
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
  /**
   * Number of observations that carried a color (≤ count — color-less
   * observations from old recordings or with the rgb option off must not
   * dilute the average toward black, Iter 8).
   */
  colorCount: number;
  /** Per-channel sums of the colored observations (running average). */
  colorSum: [number, number, number];
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
   * Carving and incrementing run as two separate passes over the sample's
   * points: all rays are carved first, then every endpoint is incremented.
   * A single interleaved pass would be order-dependent — a deeper point's
   * carve could erase the endpoint a nearer point added earlier in the same
   * sample. Splitting the passes makes the result deterministic and lets an
   * endpoint observed within a sample survive other rays in that same
   * sample. (Deeper-carves-nearer still applies ACROSS samples: a later
   * sample's ray carves an earlier sample's endpoint as before.)
   *
   * @returns the number of points actually added.
   */
  addSample(sample: DepthSample): number {
    if (!isFiniteTriple(sample.cameraPos)) {
      return 0;
    }
    // Projection inverse and camera pose are sample-invariant — build the
    // unprojector once and reuse it for every point (null when the sample has
    // no usable projection matrix, e.g. pre-intrinsics recordings).
    const unprojector = createDepthUnprojector(
      sample.cameraPos,
      sample.cameraRot,
      sample.projectionMatrix
    );
    if (!unprojector) {
      return 0;
    }
    const cameraCell = this.cellForPosition(sample.cameraPos);
    // Pass 1: carve free space along every ray, collecting endpoint cells
    // (with the observing point's color, if any — Iter 8).
    const endpoints: Array<{ cell: GridCell; rgb?: RgbTuple }> = [];
    for (const point of sample.points) {
      const world = unprojector.unproject(point);
      if (!world) {
        continue;
      }
      const cell = this.cellForPosition(world);
      if (!cellsEqual(cameraCell, cell)) {
        this.carve(cameraCell, cell);
      }
      endpoints.push({ cell, rgb: point.rgb });
    }
    // Pass 2: count endpoints occupied, after all carving for this sample.
    for (const endpoint of endpoints) {
      this.increment(endpoint.cell, endpoint.rgb);
    }
    return endpoints.length;
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
   * Running-average color of the cell's colored observations (Iter 8), or
   * null when the cell is unknown or was only ever observed without color
   * (rgb option off / pre-Iter-8 recordings) — consumers fall back to
   * height-based coloring. Channels are rounded and clamped to 0–255.
   */
  getCellColor(cell: GridCell): RgbTuple | null {
    const record = this.cells.get(cellKey(cell));
    if (!record || record.colorCount === 0) {
      return null;
    }
    const average = (sum: number): number =>
      Math.min(255, Math.max(0, Math.round(sum / record.colorCount)));
    return [
      average(record.colorSum[0]),
      average(record.colorSum[1]),
      average(record.colorSum[2]),
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

  private increment(cell: GridCell, rgb?: RgbTuple): void {
    const key = cellKey(cell);
    let record = this.cells.get(key);
    if (!record) {
      record = { cell, count: 0, colorCount: 0, colorSum: [0, 0, 0] };
      this.cells.set(key, record);
    }
    record.count++;
    // Only finite triples enter the average — bad persisted data degrades
    // to a color-less observation instead of poisoning the cell.
    if (rgb && isFiniteTriple(rgb)) {
      record.colorCount++;
      record.colorSum[0] += rgb[0];
      record.colorSum[1] += rgb[1];
      record.colorSum[2] += rgb[2];
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
