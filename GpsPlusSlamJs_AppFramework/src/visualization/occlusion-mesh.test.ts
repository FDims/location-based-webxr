/**
 * OcclusionMesh — unit tests.
 *
 * Why this test matters:
 * OcclusionMesh is the THREE adapter that turns the pure `meshOccupiedCells`
 * output into a depth-only occluder Mesh parented under `arWorldGroup`. These
 * tests pin the things that make it an *occluder* and not a visible mesh: the
 * material writes depth but not color, the node carries the WEBXR_TO_NUE basis
 * (so it rides alignment like the cubes), `update` rebuilds geometry from a
 * snapshot, `clear` empties it, and `dispose` detaches + frees. The geometry
 * counts come straight from the mesher's proven invariants.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { GridCell } from '../ar/bresenham3d';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis';
import { OcclusionMesh } from './occlusion-mesh';

function findMesh(parent: THREE.Object3D): THREE.Mesh | undefined {
  return parent.children.find((c) => c instanceof THREE.Mesh) as
    | THREE.Mesh
    | undefined;
}

function meshes(parent: THREE.Object3D): THREE.Mesh[] {
  return parent.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
}

/** The invisible depth-only occluder mesh (colorWrite off). */
function occluderMesh(parent: THREE.Object3D): THREE.Mesh | undefined {
  return meshes(parent).find(
    (m) => (m.material as THREE.Material).colorWrite === false
  );
}

/** The visible matcap debug skin, if present. */
function debugSkin(parent: THREE.Object3D): THREE.Mesh | undefined {
  return meshes(parent).find(
    (m) => m.material instanceof THREE.MeshMatcapMaterial
  );
}

describe('OcclusionMesh', () => {
  it('attaches a depth-only mesh under the injected node with the NUE basis', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const mesh = findMesh(parent);
    expect(mesh).toBeDefined();
    const material = mesh!.material as THREE.MeshBasicMaterial;
    // Invisible depth-writer: this is what makes it occlude rather than show.
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(true);
    // Drawn before virtual content (renderOrder ≥ 0).
    expect(mesh!.renderOrder).toBeLessThan(0);
    // Carries the raw-WebXR → NUE basis change as its local matrix.
    expect(mesh!.matrixAutoUpdate).toBe(false);
    expect(mesh!.matrix.elements).toEqual(WEBXR_TO_NUE.elements);
    occluder.dispose();
  });

  it('starts empty and meshes a snapshot on update', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    expect(occluder.getTriangleCount()).toBe(0);

    // Single isolated voxel → 6 faces → 12 triangles (greedy can't merge one).
    occluder.update([[0, 0, 0]], 0.15);
    expect(occluder.getTriangleCount()).toBe(12);
    expect(occluder.getAabbs()).toHaveLength(1);
    occluder.dispose();
  });

  it('greedy-merges a flat slab (default greedy=true) to fewer triangles', () => {
    const cells: GridCell[] = [];
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) cells.push([x, y, 0]);

    const greedy = new OcclusionMesh(new THREE.Group());
    greedy.update(cells, 0.15);
    const perFace = new OcclusionMesh(new THREE.Group(), { greedy: false });
    perFace.update(cells, 0.15);

    // 5×5×1 slab: greedy → 6 quads (12 tris); per-face → 70 quads (140 tris).
    expect(greedy.getTriangleCount()).toBe(12);
    expect(perFace.getTriangleCount()).toBe(140);
    // AABB list is unaffected by greedy — one box per cell either way.
    expect(greedy.getAabbs()).toHaveLength(25);
    expect(perFace.getAabbs()).toHaveLength(25);
    greedy.dispose();
    perFace.dispose();
  });

  it('clear() empties the geometry but keeps the node attached', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.update([[0, 0, 0]], 0.15);
    occluder.clear();
    expect(occluder.getTriangleCount()).toBe(0);
    expect(occluder.getAabbs()).toHaveLength(0);
    expect(findMesh(parent)).toBeDefined(); // still in scene
    occluder.dispose();
  });

  it('dispose() removes the mesh and is idempotent', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.update([[0, 0, 0]], 0.15);
    occluder.dispose();
    expect(findMesh(parent)).toBeUndefined();
    // No-op after dispose (no throw, no re-mesh).
    occluder.update([[1, 1, 1]], 0.15);
    expect(() => occluder.dispose()).not.toThrow();
  });

  /**
   * Debug visualization (2026-06-29 testing feedback): when on, a VISIBLE shiny
   * matcap "skin" is added so the operator can judge the meshed surface, while
   * the original invisible depth-only mesh is left untouched — so occlusion is
   * provably unchanged. (A single transparent material would render in three.js's
   * transparent phase after opaque content, which would stop it occluding opaque
   * objects; the additive skin avoids that entirely.)
   */
  describe('setDebugVisualization', () => {
    it('adds a visible semi-transparent matcap skin while keeping the depth-only occluder', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);

      expect(debugSkin(parent)).toBeUndefined();
      occluder.setDebugVisualization(true);

      // The invisible depth-only occluder is still present and still occludes.
      const depthMesh = occluderMesh(parent);
      expect(depthMesh).toBeDefined();
      expect((depthMesh!.material as THREE.Material).colorWrite).toBe(false);
      expect((depthMesh!.material as THREE.Material).depthWrite).toBe(true);

      // A second, visible matcap mesh now exists: shiny, semi-transparent.
      const skin = debugSkin(parent);
      expect(skin).toBeDefined();
      const mat = skin!.material as THREE.MeshMatcapMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeLessThan(1);
      expect(mat.matcap).toBeTruthy(); // shaded/"shiny", not flat
      // Matcap shading needs normals; the mesher emits none, so debug computes them.
      expect(skin!.geometry.getAttribute('normal')).toBeTruthy();
      // Skin rides the same NUE basis as the occluder so it overlays exactly.
      expect(skin!.matrix.elements).toEqual(WEBXR_TO_NUE.elements);

      occluder.dispose();
    });

    it('removes the skin when turned back off, leaving only the depth-only mesh', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      occluder.setDebugVisualization(true);
      expect(debugSkin(parent)).toBeDefined();

      occluder.setDebugVisualization(false);
      expect(debugSkin(parent)).toBeUndefined();
      expect(occluderMesh(parent)).toBeDefined();
      occluder.dispose();
    });

    it('keeps the skin geometry + normals in sync across re-mesh', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.setDebugVisualization(true); // enabled before any geometry
      occluder.update([[0, 0, 0]], 0.15);

      const skin = debugSkin(parent)!;
      expect(skin.geometry).toBe(occluderMesh(parent)!.geometry); // shared
      expect(skin.geometry.getAttribute('normal')).toBeTruthy();
      occluder.dispose();
    });

    it('is idempotent and safe after dispose', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      occluder.setDebugVisualization(true);
      occluder.setDebugVisualization(true); // no duplicate skin
      expect(
        meshes(parent).filter(
          (m) => m.material instanceof THREE.MeshMatcapMaterial
        )
      ).toHaveLength(1);

      occluder.dispose();
      expect(debugSkin(parent)).toBeUndefined();
      expect(() => occluder.setDebugVisualization(true)).not.toThrow();
    });
  });
});
