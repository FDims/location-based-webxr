/**
 * Occupancy-cubes visualizer — renders the AR-space occupancy grid as one
 * `THREE.InstancedMesh` of cubes (2026-06-11 depth occupancy-grid port
 * plan §3/Iter 5). The TS equivalent of the Unity debug cubes in
 * `ArCursorOnDepthSurface.cs`: refreshed at ~1 Hz by
 * `wireOccupancyGridSubscribers`, drawing all occupied cells when under
 * the instance cap and a random subset above it (the "randomly picking
 * points every second" behavior — no geometry-shader point billboard is
 * ported, WebGL has none).
 *
 * Coloring: height-based per-instance color (HSL ramp over the cell's Y)
 * until per-point RGB capture lands (plan §5).
 *
 * Coordinate space: the grid's cells are **raw WebXR** coordinates, but
 * the AR-space node (`arWorldGroup`) they must ride lives in AR-odometry
 * NUE. The mesh therefore carries the constant `WEBXR_TO_NUE` basis
 * change as its own local matrix — the same role `basisChangeNode` plays
 * for the camera — so every cube's world pose follows the camera's
 * `alignment × WEBXR_TO_NUE` chain (see the hit-test-reticle entry in
 * `GpsPlusSlamJs_Docs/docs/lessons-learned.md`). Parenting the mesh at
 * the scene root instead leaves the cubes axis-swapped and unaligned.
 *
 * The parent node is injected explicitly (no `getArWorldGroup()` call)
 * so the class stays unit-testable — same P3 rule as
 * `FrameTileVisualizer`.
 */

import * as THREE from 'three';
import type { GridCell } from 'gps-plus-slam-app-framework/ar';
// Deep subpath on purpose: the /ar barrel eagerly evaluates enable-gps-ar's
// module-level deps, which breaks tests that partially mock webxr-session /
// permission-checker; webxr-nue-basis depends only on three.
import { WEBXR_TO_NUE } from 'gps-plus-slam-app-framework/ar/webxr-nue-basis';

/** The read surface of the framework's `OccupancyGrid` this class draws. */
export interface OccupancyGridSource {
  getOccupiedCells(minObservations?: number): readonly GridCell[];
  getCellCenter(cell: GridCell): readonly [number, number, number];
  /**
   * Per-cell average camera color (0–255 per channel, Iter 8), or null
   * when the cell carries no color — the cube then falls back to the
   * height ramp.
   */
  getCellColor(cell: GridCell): readonly [number, number, number] | null;
}

export interface OccupancyCubesVisualizerOptions {
  /** Maximum rendered cubes (InstancedMesh capacity). Default 2000. */
  readonly maxInstances?: number;
  /**
   * Minimum observation count for a cell to be drawn (noise filter,
   * forwarded to `getOccupiedCells`). Default 1 — tuned in Iter 6.
   */
  readonly minObservations?: number;
  /**
   * Rendered edge length of each debug cube in meters. Deliberately
   * much smaller than the grid cell (0.15 m) so individual voxels stay
   * readable instead of fusing into a solid wall. Default 0.025
   * (field-tuned: 0.1 still read as too bulky on device).
   */
  readonly cubeSizeM?: number;
  /**
   * Random source for the over-cap subset selection. Injected so tests
   * are deterministic. Default `Math.random`.
   */
  readonly rng?: () => number;
}

const DEFAULT_MAX_INSTANCES = 2000;
const DEFAULT_CUBE_SIZE_M = 0.025;
const MESH_NAME = 'occupancy-cubes';

/** Height range mapped onto the color ramp (meters, raw WebXR Y). */
const COLOR_Y_MIN = -1;
const COLOR_Y_MAX = 3;

export class OccupancyCubesVisualizer {
  private readonly arSpaceNode: THREE.Object3D;
  private readonly minObservations: number;
  private readonly cubeSizeM: number;
  private readonly rng: () => number;
  private readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BoxGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private disposed = false;

  /**
   * @param arSpaceNode - the node whose local space is AR-odometry NUE
   *   and which receives the alignment matrix (`arWorldGroup` live,
   *   `replaySceneState.arWorldGroup` in replay) — NOT the scene root.
   */
  constructor(
    arSpaceNode: THREE.Object3D,
    options: OccupancyCubesVisualizerOptions = {}
  ) {
    this.arSpaceNode = arSpaceNode;
    this.minObservations = options.minObservations ?? 1;
    this.cubeSizeM = options.cubeSizeM ?? DEFAULT_CUBE_SIZE_M;
    this.rng = options.rng ?? Math.random;
    const maxInstances = options.maxInstances ?? DEFAULT_MAX_INSTANCES;

    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.7,
    });
    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      maxInstances
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = MESH_NAME;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // instances spread across the room
    // Instances stay raw WebXR; the mesh node itself converts to the
    // parent's NUE frame (mirrors webxr-session's basisChangeNode).
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(WEBXR_TO_NUE);
    this.arSpaceNode.add(this.mesh);
  }

  /** Number of cubes currently drawn. */
  getCount(): number {
    return this.mesh.count;
  }

  /**
   * Redraw from the grid: every sufficiently-observed cell when under the
   * instance cap, otherwise a random subset of cap size.
   */
  refresh(grid: OccupancyGridSource): void {
    if (this.disposed) return;
    const occupied = grid.getOccupiedCells(this.minObservations);
    const capacity = this.mesh.instanceMatrix.count;
    const cells =
      occupied.length <= capacity
        ? occupied
        : pickRandomSubset(occupied, capacity, this.rng);

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell === undefined) continue;
      const [x, y, z] = grid.getCellCenter(cell);
      matrix.makeScale(this.cubeSizeM, this.cubeSizeM, this.cubeSizeM);
      matrix.setPosition(x, y, z);
      this.mesh.setMatrixAt(i, matrix);
      // Iter 8: real camera color when the cell has one; height ramp for
      // color-less cells (rgb option off, pre-Iter-8 recordings).
      const rgb = grid.getCellColor(cell);
      this.mesh.setColorAt(
        i,
        rgb
          ? color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
          : heightColor(color, y)
      );
    }
    this.mesh.count = cells.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Hide all cubes (e.g. on store swap); the mesh stays in the scene. */
  clear(): void {
    this.mesh.count = 0;
  }

  /** Remove the mesh from its parent and release GPU resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.arSpaceNode.remove(this.mesh);
    this.mesh.dispose(); // releases the instance buffers
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Map cell height to a stable HSL ramp (blue floor → red ceiling). */
function heightColor(target: THREE.Color, y: number): THREE.Color {
  const t = Math.min(
    1,
    Math.max(0, (y - COLOR_Y_MIN) / (COLOR_Y_MAX - COLOR_Y_MIN))
  );
  // 0.66 (blue) down to 0 (red)
  return target.setHSL(0.66 * (1 - t), 1, 0.5);
}

/**
 * Pick `count` distinct elements via partial Fisher–Yates on a copy —
 * O(count), unbiased for an unbiased rng, deterministic for injected rngs.
 */
function pickRandomSubset<T>(
  items: readonly T[],
  count: number,
  rng: () => number
): T[] {
  const pool = [...items];
  const result: T[] = [];
  const limit = Math.min(count, pool.length);
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const a = pool[i];
    const b = pool[j];
    if (a === undefined || b === undefined) continue; // rng out of [0,1)
    pool[i] = b;
    pool[j] = a;
    result.push(b);
  }
  return result;
}
