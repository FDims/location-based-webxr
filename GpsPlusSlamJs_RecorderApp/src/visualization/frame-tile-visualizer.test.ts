/**
 * Tests for `FrameTileVisualizer` — F3.3 of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 *
 * Texture decoding is deliberately not exercised here: the class
 * accepts a pre-built `THREE.Texture` so tests run cleanly under
 * jsdom (no `createImageBitmap`). The decode + broken-frame filter
 * live in `wireFrameTileSubscribers` (F3.4).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FrameTileVisualizer } from './frame-tile-visualizer';
import type { ArImageCapture } from 'gps-plus-slam-app-framework/core';

function makeFrame(overrides: Partial<ArImageCapture> = {}): ArImageCapture {
  return {
    imageFile: overrides.imageFile ?? 'frames/frame-000001.jpg',
    position: overrides.position ?? [1, 2, -3],
    rotation: overrides.rotation ?? [0, 0, 0, 1],
    screenRotation: overrides.screenRotation ?? 0,
    capturedAt: overrides.capturedAt,
  };
}

describe('FrameTileVisualizer', () => {
  let scene: THREE.Scene;
  let texture: THREE.Texture;

  beforeEach(() => {
    scene = new THREE.Scene();
    texture = new THREE.Texture();
  });

  // Why: every accepted add2dImage must produce one visible tile in
  // the WebXR scene at the captured pose.
  it('adds one mesh per frame with the captured pose applied verbatim', () => {
    const viz = new FrameTileVisualizer(scene);
    viz.addTile(makeFrame({ position: [1, 2, -3] }), texture);

    expect(scene.children).toHaveLength(1);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.position.toArray()).toEqual([1, 2, -3]);
    expect(mesh.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(mesh.name).toBe('frame-tile-frames/frame-000001.jpg');
    expect(viz.getCount()).toBe(1);
  });

  // Why: tile size is observable via mesh.scale because the geometry
  // is a unit plane shared across all tiles. Default 20 cm keeps tiles
  // visible without dominating the scene.
  it('scales the shared unit-plane geometry to the configured size (20 cm default)', () => {
    const viz = new FrameTileVisualizer(scene);
    viz.addTile(makeFrame(), texture);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.scale.toArray()).toEqual([0.2, 0.2, 0.2]);
  });

  it('honours an explicit sizeMeters option', () => {
    const viz = new FrameTileVisualizer(scene, { sizeMeters: 0.5 });
    viz.addTile(makeFrame(), texture);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.scale.toArray()).toEqual([0.5, 0.5, 0.5]);
  });

  // Why: the slice is append-only; a duplicate dispatch must not
  // produce a second mesh or leak a second material.
  it('is idempotent on duplicate imageFile keys', () => {
    const viz = new FrameTileVisualizer(scene);
    viz.addTile(makeFrame({ imageFile: 'frames/dup.jpg' }), texture);
    viz.addTile(makeFrame({ imageFile: 'frames/dup.jpg' }), texture);
    expect(scene.children).toHaveLength(1);
    expect(viz.getCount()).toBe(1);
  });

  // Why: replay restart clears the slice and the visualizer needs to
  // match — no leftover meshes, materials, or textures.
  it('clear() removes every tile and disposes per-tile material + texture', () => {
    const viz = new FrameTileVisualizer(scene);
    const tex = new THREE.Texture();
    viz.addTile(makeFrame(), tex);
    const mesh = scene.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial;

    let materialDisposed = false;
    let textureDisposed = false;
    material.addEventListener('dispose', () => {
      materialDisposed = true;
    });
    tex.addEventListener('dispose', () => {
      textureDisposed = true;
    });

    viz.clear();

    expect(scene.children).toHaveLength(0);
    expect(viz.getCount()).toBe(0);
    expect(materialDisposed).toBe(true);
    expect(textureDisposed).toBe(true);
  });

  // Why: dispose is the same operation as clear() but lets call sites
  // express "I am done with this visualizer" intent explicitly.
  it('dispose() behaves like clear()', () => {
    const viz = new FrameTileVisualizer(scene);
    viz.addTile(makeFrame(), texture);
    viz.dispose();
    expect(viz.getCount()).toBe(0);
    expect(scene.children).toHaveLength(0);
  });
});
