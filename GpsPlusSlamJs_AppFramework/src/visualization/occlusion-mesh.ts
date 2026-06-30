/**
 * Persistent occlusion mesh — a depth-only `THREE.Mesh` of the occupancy grid.
 *
 * Wraps the pure {@link meshOccupiedCells} (face-culled voxel surface) into a
 * THREE object that **writes depth but no color** (`colorWrite = false`,
 * `depthWrite = true`), drawn before virtual content (low `renderOrder`) so real
 * geometry the camera saw earlier hides virtual objects placed behind it —
 * including out-of-view surfaces a single-frame live depth occluder cannot
 * remember (2026-06-13-occupancy-mesh-options-plan.md §4; complements the live
 * occluder in 2026-06-14-webxr-depth-occlusion-plan.md).
 *
 * Reusable across consumer apps (AnchorStarter / MinimalExample want occlusion
 * too); the recorder only owns the off-by-default toggle + scene wiring.
 *
 * Coordinate space: the grid cells (and therefore the mesh positions) are **raw
 * WebXR**, but the parent `arWorldGroup` is AR-odometry NUE. The mesh carries
 * the constant `WEBXR_TO_NUE` basis change as its own local matrix — identical
 * to `OccupancyCubesVisualizer` — so it rides the `alignment × WEBXR_TO_NUE`
 * chain. The parent node is injected (no `getArWorldGroup()`) to stay testable.
 *
 * Scope: this is a full-rebuild occluder (re-mesh the whole snapshot on
 * `update`). The chunked dirty-remesh perf layer (plan §7) is a follow-on.
 *
 * @see occlusion-mesh.ts.md for detailed documentation
 */

import * as THREE from 'three';
import type { GridCell } from '../ar/bresenham3d.js';
import {
  meshOccupiedCells,
  type Aabb,
  type MeshMode,
  type MeshOccupiedCellsOptions,
} from '../ar/occupancy-mesher.js';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis.js';
import type { Vector3 } from 'gps-plus-slam-js';

const MESH_NAME = 'occupancy-occluder';
const DEBUG_MESH_NAME = 'occupancy-occluder-debug';

/** Default render order — well before virtual content (which is ≥ 0). */
const DEFAULT_RENDER_ORDER = -1;

/** Opacity of the matcap debug skin — see-through enough to read the real scene
 *  behind it while the shape stays legible. */
const DEBUG_SKIN_OPACITY = 0.6;

/**
 * Build a tiny procedural matcap texture (a shaded sphere with a specular
 * highlight) so the debug skin reads as a **shiny** surface with **no scene
 * lights** — `MeshMatcapMaterial` bakes the lighting into this lookup. Generated
 * from a typed array (no canvas/WebGL), so it works headless in tests too.
 */
function createOccluderDebugMatcap(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  // Light direction (front-upper-right); normalized via its length below.
  const lx = 0.4;
  const ly = 0.5;
  const lz = 0.75;
  const llen = Math.hypot(lx, ly, lz);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = (j * size + i) * 4;
      const nx = ((i + 0.5) / size) * 2 - 1;
      const ny = ((j + 0.5) / size) * 2 - 1;
      const r2 = nx * nx + ny * ny;
      let r = 12;
      let g = 12;
      let b = 14;
      if (r2 <= 1) {
        const nz = Math.sqrt(1 - r2);
        const ndl = Math.max(0, (nx * lx + ny * ly + nz * lz) / llen);
        const diff = 0.25 + 0.75 * ndl; // ambient + diffuse
        const spec = Math.pow(ndl, 32); // tight specular highlight
        // Cyan-ish tint so the occluder reads as obviously "debug".
        r = Math.min(255, 255 * (0.15 * diff + spec));
        g = Math.min(255, 255 * (0.55 * diff + spec));
        b = Math.min(255, 255 * (0.78 * diff + spec));
      }
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export interface OcclusionMeshOptions {
  /**
   * Merge coplanar faces (fewer triangles, same occluded volume). Default
   * true — the occluder is invisible, so the coarser triangulation is free.
   * Ignored when {@link OcclusionMeshOptions.mode} is set.
   */
  readonly greedy?: boolean;
  /**
   * Mesher strategy (additive opt-in; 2026-06-30 occluder-tuning, F2). When set
   * it takes precedence over {@link greedy}. `'smooth'` selects the surface-nets
   * mesher that hugs the measured per-cell centroids — pass a `getCellPoint`
   * provider to {@link OcclusionMesh.update} for it to read. Left **unset by
   * default** so existing behaviour (greedy cubes) is byte-for-byte unchanged
   * until the smooth occluder is confirmed on-device.
   */
  readonly mode?: MeshMode;
  /**
   * `renderOrder` of the depth-only mesh. Must be below virtual content so the
   * occluder lays down depth first. Default −1. (The live occluder, when it
   * exists, sits between this and content — plan §5.)
   */
  readonly renderOrder?: number;
}

/**
 * A depth-only occlusion mesh that rebuilds from an occupancy-grid snapshot.
 * Mirrors {@link OccupancyCubesVisualizer}'s lifecycle (inject parent, `update`,
 * `clear`, `dispose`) so the recorder can wire it the same way as the cubes.
 */
export class OcclusionMesh {
  private readonly arSpaceNode: THREE.Object3D;
  private readonly greedy: boolean;
  private readonly mode: MeshMode | undefined;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private lastAabbs: readonly Aabb[] = [];
  private disposed = false;
  // Debug visualization (off by default): a VISIBLE matcap "skin" sharing the
  // occluder's geometry. Kept separate from `this.mesh` (the invisible depth
  // writer) so toggling debug never changes the actual occlusion — the depth
  // mesh is untouched, the skin is purely additive.
  private debugViz = false;
  private debugSkin: THREE.Mesh | null = null;
  private debugMaterial: THREE.MeshMatcapMaterial | null = null;

  /**
   * @param arSpaceNode the AR-odometry-NUE node that receives the alignment
   *   matrix (`arWorldGroup` live, `replaySceneState.arWorldGroup` in replay).
   */
  constructor(arSpaceNode: THREE.Object3D, options: OcclusionMeshOptions = {}) {
    this.arSpaceNode = arSpaceNode;
    this.greedy = options.greedy ?? true;
    this.mode = options.mode;
    this.geometry = new THREE.BufferGeometry();
    // Invisible depth-writer: contributes only to the depth buffer, so virtual
    // content's normal depth test hides fragments behind the real surface.
    this.material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = MESH_NAME;
    this.mesh.renderOrder = options.renderOrder ?? DEFAULT_RENDER_ORDER;
    this.mesh.frustumCulled = false; // surface spans the whole room
    // Raw-WebXR positions; the mesh node converts to the parent's NUE frame.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(WEBXR_TO_NUE);
    this.arSpaceNode.add(this.mesh);
  }

  /** The number of triangles currently drawn. */
  getTriangleCount(): number {
    const index = this.geometry.getIndex();
    return index ? index.count / 3 : 0;
  }

  /** The AABB list from the most recent {@link update} (physics export hook). */
  getAabbs(): readonly Aabb[] {
    return this.lastAabbs;
  }

  /**
   * Re-mesh from a fresh occupied-cell snapshot. Pass
   * `grid.getOccupiedCells(occupancy.minConfidence)` so the occluder shares the
   * same noise floor as the cubes and the COLMAP export.
   *
   * @param getCellPoint optional per-cell measured-centroid provider
   *   (`grid.getCellPoint`); only consumed when this occluder was constructed
   *   with `mode: 'smooth'` (otherwise ignored). When omitted under `'smooth'`,
   *   the surface nets falls back to cell centres.
   */
  update(
    cells: Iterable<GridCell>,
    cellSizeM: number,
    getCellPoint?: (cell: GridCell) => Vector3 | null
  ): void {
    if (this.disposed) return;
    const meshOptions: MeshOccupiedCellsOptions = this.mode
      ? { mode: this.mode, getCellPoint }
      : { greedy: this.greedy };
    const { positions, indices, aabbs } = meshOccupiedCells(
      cells,
      cellSizeM,
      meshOptions
    );
    this.lastAabbs = aabbs;
    // Replace the geometry wholesale — a full rebuild is the simple first cut;
    // dispose the old buffers to avoid leaking GPU memory across refreshes.
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    next.setIndex(new THREE.BufferAttribute(indices, 1));
    // Matcap shading needs per-vertex normals; the mesher emits none. Compute
    // them only when the debug skin is showing, so the default occluder path
    // (invisible — normals unused) stays cheap.
    if (this.debugViz) next.computeVertexNormals();
    this.geometry.dispose();
    this.geometry = next;
    this.mesh.geometry = next;
    if (this.debugSkin) this.debugSkin.geometry = next;
  }

  /**
   * Toggle a **visible** matcap debug rendering of the occluder mesh (shiny,
   * semi-transparent) so the meshed surface's shape can be judged on-device.
   *
   * Additive by design: this adds/removes a separate skin mesh sharing the
   * occluder's geometry and **never touches the invisible depth-only mesh**, so
   * occlusion is byte-for-byte unchanged whether debug is on or off. The skin is
   * `transparent` with `depthWrite:false` (the depth-only mesh already wrote the
   * occluding depth), so it just paints the shiny surface where the occluder is
   * the nearest geometry.
   *
   * Only meaningful when this occluder is actually meshing the grid (it is the
   * persistent occluder's mesh); enabling it on an empty/disabled occluder is a
   * harmless no-op until {@link update} feeds geometry.
   */
  setDebugVisualization(enabled: boolean): void {
    if (this.disposed || enabled === this.debugViz) return;
    this.debugViz = enabled;
    if (enabled) {
      if (!this.debugMaterial) {
        this.debugMaterial = new THREE.MeshMatcapMaterial({
          matcap: createOccluderDebugMatcap(),
          transparent: true,
          opacity: DEBUG_SKIN_OPACITY,
          depthWrite: false, // the invisible depth mesh owns the occluding depth
        });
      }
      // Normals for the (possibly already-meshed) current geometry.
      this.geometry.computeVertexNormals();
      const skin = new THREE.Mesh(this.geometry, this.debugMaterial);
      skin.name = DEBUG_MESH_NAME;
      skin.renderOrder = 0; // transparent overlay, after the depth pass
      skin.frustumCulled = false;
      skin.matrixAutoUpdate = false;
      skin.matrix.copy(WEBXR_TO_NUE); // same raw-WebXR → NUE basis as the occluder
      this.debugSkin = skin;
      this.arSpaceNode.add(skin);
    } else if (this.debugSkin) {
      this.arSpaceNode.remove(this.debugSkin);
      this.debugSkin = null;
    }
  }

  /** Empty the mesh (e.g. on store swap); the node stays in the scene. */
  clear(): void {
    if (this.disposed) return;
    const next = new THREE.BufferGeometry();
    this.geometry.dispose();
    this.geometry = next;
    this.mesh.geometry = next;
    this.lastAabbs = [];
  }

  /** Remove the mesh from its parent and release GPU resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.arSpaceNode.remove(this.mesh);
    if (this.debugSkin) {
      this.arSpaceNode.remove(this.debugSkin);
      this.debugSkin = null;
    }
    this.debugMaterial?.matcap?.dispose();
    this.debugMaterial?.dispose();
    this.debugMaterial = null;
    this.geometry.dispose();
    this.material.dispose();
    this.lastAabbs = [];
  }
}
