# occupancy-mesher.ts

## Purpose

Pure, dependency-free mesher that turns a snapshot of {@link OccupancyGrid}
occupied cells into a **face-culled voxel surface** (`positions` + `indices`,
raw-WebXR metres) plus a per-cell **AABB list**. The surface feeds the
persistent depth-only **occlusion** mesh and a **trimesh** physics collider; the
AABB list feeds a **compound box collider** (the better voxel-physics fit). See
`GpsPlusSlamJs_Docs/docs/2026-06-13-occupancy-mesh-options-plan.md` (option B,
§3E, §8).

## Public API

- `meshOccupiedCells(cells: Iterable<GridCell>, cellSizeM: number, options?: MeshOccupiedCellsOptions): OccupancyMeshResult`
  - **Inputs:** `cells` — occupied cells, typically `grid.getOccupiedCells(occupancy.minConfidence)`; `cellSizeM` — cube edge length in metres; `options.mode` — the mesher strategy (see below); `options.getCellPoint` — per-cell measured centroid provider consumed by `'smooth'`.
  - **Output:** `{ positions: Float32Array, indices: Uint32Array, aabbs: Aabb[] }`.
    - `positions`/`indices`: a triangle soup in raw-WebXR metres. Cube modes (`per-face`/`greedy`) emit 4 vertices per quad, **not** shared. `smooth` **welds** one vertex per surface cell (shared across quads).
    - `aabbs`: one `{ center, halfExtents }` per **unique** occupied cell (`center = cell · cellSizeM`, `halfExtents = cellSizeM/2`). The AABB list is **mode-independent**.
  - **Error modes:** throws `RangeError` if `cellSizeM` is non-finite or ≤ 0. Duplicate cells are de-duplicated; cells with a non-finite coordinate are skipped defensively.
- `Aabb` — `{ center: [x,y,z], halfExtents: [hx,hy,hz] }`, raw-WebXR metres.
- `OccupancyMeshResult` — the typed-array bundle above (transferable to a Web Worker).
- `MeshMode` — `'per-face' | 'greedy' | 'smooth'` (F2b adds `'corner-fit'`).
- `MeshOccupiedCellsOptions` — `{ mode?: MeshMode; greedy?: boolean; getCellPoint?: (cell) => Vector3 | null }`. `mode` takes precedence; the legacy `greedy` boolean is a back-compat shim (`true → 'greedy'`, else `'per-face'`). All modes stay simultaneously usable — none replaces another.

## Modes

- **`'per-face'`** (default) — blocky, watertight, exact cell volume; the strict baseline. See "Invariants" below.
- **`'greedy'`** — fewest triangles, blocky; coplanar-face merge for memory. See "Greedy merge".
- **`'smooth'`** (surface nets, F2 2026-06-30) — one **welded** vertex per occupied _surface_ cell (a cell with ≥1 empty neighbour) placed at `getCellPoint(cell)` — the measured centroid the cube modes throw away — or the cell centre when no provider is given. Faces are the dual of coplanar surface patches: one quad per coplanar 2×2 occupied group whose `+d` **or** `−d` side is exposed.
  - **Open, not closed:** a one-cell-thick slab (the floor) yields ONE sheet hugging the measured surface — an **open** manifold, so the even-edge-cover / closed-surface invariant is deliberately **unsatisfiable** and not asserted. Leak-prevention comes from **crack-free welding** (shared vertex indices), not closedness. Thick solids get top/bottom/side sheets (closed where thick).
  - **Hugs the measured surface, occludes less volume:** every vertex sits within `cellSize/2` of the cell centre (inside the union-of-cubes hull), so it occludes a little less than the cubes but far more accurately.
  - **Scope:** connects coplanar surface cells, so flat/convex exposed surfaces (the floor) are fully tiled; bridging the **concave seam** where two perpendicular surfaces meet (wall-meets-floor) is left to the deferred full QEF/dual-contouring solver.

## Greedy merge (`{ greedy: true }`)

Minecraft-style greedy meshing: per face-normal axis + side, each slice's
exposed-face mask is merged into maximal rectangles (row-major, deterministic),
emitting one quad per rectangle. Cuts the triangle count substantially on flat
runs (e.g. a 5×5×1 slab: 70 quads → 6). The merged surface covers the **exact
same set of unit faces** as the default per-face output — proven by the
differential property test — so the occluded volume is identical; only the
triangulation is coarser.

- **AABBs unchanged:** greedy merges the render/occluder geometry only. A 3-D
  greedy **box** merge for fewer colliders (plan §3E) is a separate follow-on;
  the AABB list stays one box per cell.
- **T-junctions:** greedy quads of differing extents can meet at T-junctions
  (a long edge against two shorter ones), so the greedy surface is **not**
  edge-2-manifold and the per-face "even edge cover" watertight test does not
  apply to it. For a depth-only occluder this is harmless (coverage is identical
  and watertight in the area sense); a consumer that needs a welded, crack-free
  manifold (some trimesh colliders) should use the **default per-face** output
  or weld + T-junction-split downstream.

## Invariants & assumptions

- **Face culling:** a face is emitted **iff** its neighbour cell (±1 on one axis) is empty. Interior faces are dropped → triangle count scales with surface area, not volume.
- **Geometry:** cube for cell `c` spans `[c·s − s/2, c·s + s/2]` per axis, matching `OccupancyGrid.getCellCenter` (round-quantization, no half-cell offset). Faces use outward CCW winding.
- **Watertight:** for a closed voxel region the surface has no boundary — every edge is covered an **even** number of times (2 for manifold edges, 4 along the non-manifold edges that diagonal-touching voxels create). It is **not** guaranteed edge-2-manifold (diagonal contact is legal voxel data).
- **Deterministic:** output for a given input is stable; face/AABB counts are permutation-invariant in the input order.
- **Raw-WebXR space:** positions are in the same frame as the grid cells. The consumer parents the mesh under `arWorldGroup` (carrying `WEBXR_TO_NUE`) so it rides the alignment matrix, exactly like the cubes visualizer.
- **Snapshot, don't mesh the live grid:** the caller passes an immutable array snapshot; the mesher never holds a reference to the mutating grid.

## Examples

```ts
import {
  OccupancyGrid,
  meshOccupiedCells,
} from 'gps-plus-slam-app-framework/ar';

const cells = grid.getOccupiedCells(occupancy.minConfidence);
const { positions, indices, aabbs } = meshOccupiedCells(cells, grid.cellSizeM);

// → THREE depth-only occluder geometry (thin adapter; see the recorder wiring)
const geom = new THREE.BufferGeometry();
geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geom.setIndex(new THREE.BufferAttribute(indices, 1));

// → developer's own physics: one box collider per AABB
for (const { center, halfExtents } of aabbs)
  physics.addBox(center, halfExtents);
```

## Tests

- `occupancy-mesher.test.ts` — exact-count fixtures: isolated voxel (6 faces / 12 tris), AABB placement, ±half-cell span, shared-face culling (10 faces), solid 2×2×2 (24 faces), enclosed-voxel drop (3×3×3 → 54 faces), de-dup, non-finite skip, `cellSizeM` validation.
- `occupancy-mesher.property.test.ts` — invariants over arbitrary cell sets: face count = empty-6-neighbour sum, watertight (even edge cover, per-face path), in-range indices + finite positions, permutation invariance, one AABB per unique cell, and **greedy covers the exact same unit faces as per-face culling** (with ≤ the triangle count).
- `occupancy-mesher.smooth.test.ts` — the `'smooth'` surface-nets invariants: vertex AT `getCellPoint` (within `cellSize/2`, ≠ centre), centre fallback without a provider, crack-free **welded** manifold (shared indices, no T-junctions) that is explicitly **open** (not even-edge-cover), full-patch tiling with no internal holes, `≤` per-face triangle budget, AABBs mode-independent, and the `greedy:true`→`'greedy'` back-compat shim.
- `occupancy-mesher.perf.test.ts` — **deterministic, CI-safe large-scene perf/memory harness (F3, 2026-06-30)**. Builds a known ~20k-cell solid box slab via `../test-utils/synthetic-occupancy-grid.ts` and asserts exact triangle/vertex/byte budgets, watertightness, greedy ≤ per-face, and linear bytes-per-cell across a 4× scale-up. Wall-clock is logged (non-gating). Its `STRATEGIES` list is the side-by-side "compare at scale" bench every selectable mode (per-face, greedy, and — once they land — `'smooth'`/`'corner-fit'`) runs in.
- A complementary skip-if-missing RecorderApp integration probe meshes a _real_ recorded room (plan §8 "Test data strategy"); the F3 harness is the deterministic CI gate that probe could not be.
