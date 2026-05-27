/**
 * Tests for the `gpsData/add2dImage` → `framesInScene/addFrameInScene`
 * listener middleware. See [add-2d-image-listener.ts](./add-2d-image-listener.ts)
 * and F3 of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 */

import { describe, expect, it } from 'vitest';
import { add2dImage } from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import type { Vector3, Quaternion } from 'gps-plus-slam-app-framework/core';
import { createRecorderStore } from './recorder-store';

function buildStore() {
  return createRecorderStore({ storageBackend: new NullStorageBackend() });
}

const POSITION: Vector3 = [1, 2, -3];
const ROTATION: Quaternion = [0, 0, 0, 1];

describe('add-2d-image-listener', () => {
  // Why: F3 — every accepted add2dImage must materialize as one
  // framesInScene/addFrameInScene entry so the 3D tile visualizer can
  // subscribe to a single source of truth.
  it('mirrors add2dImage into framesInScene with payload preserved verbatim', () => {
    const store = buildStore();

    store.dispatch(
      add2dImage({
        imageFile: 'frames/frame-000007.jpg',
        position: POSITION,
        rotation: ROTATION,
        screenRotation: 90,
        capturedAt: 1_700_000_002_000,
      })
    );

    const frames = store.getState().framesInScene.frames;
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame).toBeDefined();
    if (!frame) return;
    expect(frame.imageFile).toBe('frames/frame-000007.jpg');
    expect(frame.position).toEqual(POSITION);
    expect(frame.rotation).toEqual(ROTATION);
    expect(frame.screenRotation).toBe(90);
    expect(frame.capturedAt).toBe(1_700_000_002_000);
  });

  // Why: replay streams in many frames; the listener must append
  // exactly one entry per dispatch and preserve order.
  it('appends one entry per dispatch in arrival order', () => {
    const store = buildStore();

    for (let i = 1; i <= 3; i++) {
      store.dispatch(
        add2dImage({
          imageFile: `frames/frame-${String(i).padStart(6, '0')}.jpg`,
          position: [i, 0, 0],
          rotation: ROTATION,
          screenRotation: 0,
          capturedAt: 1_700_000_000_000 + i,
        })
      );
    }

    const frames = store.getState().framesInScene.frames;
    expect(frames.map((f) => f.imageFile)).toEqual([
      'frames/frame-000001.jpg',
      'frames/frame-000002.jpg',
      'frames/frame-000003.jpg',
    ]);
  });
});
