/**
 * Frame-tile visualizer — renders captured camera frames as textured
 * 3D planes anchored at their capture pose. Each entry surfaced by
 * `selectFrameTilesInWebXR` becomes one `THREE.Mesh` (shared
 * `PlaneGeometry`, per-tile `MeshBasicMaterial` with the frame's image
 * as its texture).
 *
 * Part of F3 of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md):
 * gives the operator a visible 3D breadcrumb of what the camera
 * already captured along the recording path so they can spot bad
 * tracking quality during live recording and audit coverage during
 * replay.
 *
 * Coordinate space: `selectFrameTilesInWebXR` converts the library's
 * NUE-stored `odometryPath.points` back to WebXR for the visualizer.
 * The WebXR scene the visualizer attaches to is in the same frame, so
 * the pose is applied directly. (Step 5.7a-2 deleted the legacy
 * `framesInScene` slice + `add-2d-image-listener` mirror — the
 * selector is now the sole source.)
 *
 * Scene is injected explicitly (no `getScene()` call) so the class
 * stays unit-testable and obeys the P3 rule used by
 * `syncGpsAnchoredMeshes` and `ref-point-visualizer`.
 *
 * Texture decoding is **out of scope** for this class — callers
 * (`wireFrameTileSubscribers`, F3.4) own blob → `THREE.Texture`
 * decoding so the visualizer can be exercised in jsdom without
 * `createImageBitmap`.
 */

import * as THREE from 'three';
import type { ArImageCapture } from 'gps-plus-slam-app-framework/core';

/**
 * Pose-carrying frame descriptor consumed by the visualizer. Matches
 * the shape produced by `selectFrameTilesInWebXR` (one
 * `ArImageCapture` per captured frame). Previously imported from the
 * recorder-local `framesInScene` slice, which was deleted in Step
 * 5.7a-2 of the slice-collapse plan; the selector is now the sole
 * source.
 */
type FrameTile = ArImageCapture;

/** 1 m × 1 m base plane — scaled per tile (F3.4 may pass an option). */
const SHARED_GEOMETRY = new THREE.PlaneGeometry(1, 1);

export interface FrameTileVisualizerOptions {
  /**
   * Edge length of the textured plane in meters. Tiles are square at
   * the configured size; texture aspect ratio is preserved by the
   * texture's own coordinates, not by the geometry. Defaults to 0.2 m
   * (20 cm) — visible without dominating the scene at typical
   * walking-pace capture cadence.
   */
  readonly sizeMeters?: number;
}

const DEFAULT_SIZE = 0.2;
const NAME_PREFIX = 'frame-tile';

export class FrameTileVisualizer {
  private readonly scene: THREE.Scene;
  private readonly sizeMeters: number;
  private readonly tiles = new Map<string, THREE.Mesh>();

  constructor(scene: THREE.Scene, options: FrameTileVisualizerOptions = {}) {
    this.scene = scene;
    this.sizeMeters = options.sizeMeters ?? DEFAULT_SIZE;
  }

  /**
   * Add a textured tile for `frame`. Keyed by `frame.imageFile`; a
   * second call with the same `imageFile` is a no-op (append-only
   * mirror of the slice — frames are never re-published).
   */
  addTile(frame: FrameTile, texture: THREE.Texture): void {
    if (this.tiles.has(frame.imageFile)) return;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(SHARED_GEOMETRY, material);
    mesh.scale.setScalar(this.sizeMeters);
    mesh.name = `${NAME_PREFIX}-${frame.imageFile}`;
    mesh.position.set(frame.position[0], frame.position[1], frame.position[2]);
    mesh.quaternion.set(
      frame.rotation[0],
      frame.rotation[1],
      frame.rotation[2],
      frame.rotation[3]
    );
    this.scene.add(mesh);
    this.tiles.set(frame.imageFile, mesh);
  }

  /**
   * Remove every tile from the scene and dispose its per-tile
   * texture + material. The shared geometry is *not* disposed: it
   * lives for the lifetime of the module (matching the resource
   * model in `syncGpsAnchoredMeshes`).
   */
  clear(): void {
    for (const mesh of this.tiles.values()) {
      this.scene.remove(mesh);
      disposeTileMaterial(mesh);
    }
    this.tiles.clear();
  }

  /** Identical to `clear()`; kept for parity with other visualizers. */
  dispose(): void {
    this.clear();
  }

  getCount(): number {
    return this.tiles.size;
  }
}

function disposeTileMaterial(mesh: THREE.Mesh): void {
  const material = mesh.material as THREE.MeshBasicMaterial;
  if (material.map) {
    material.map.dispose();
  }
  material.dispose();
}
