/**
 * Tests for the `framesInScene` slice — the 3D-tile breadcrumb store
 * introduced by F3 of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 */

import { describe, expect, it } from 'vitest';
import {
  framesInSceneReducer,
  addFrameInScene,
  clearFramesInScene,
  resetFramesInSceneState,
  type FrameInScene,
} from './frames-in-scene-slice';

function makeFrame(overrides: Partial<FrameInScene> = {}): FrameInScene {
  return {
    imageFile: 'frames/frame-000001.jpg',
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    screenRotation: 0,
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('framesInSceneSlice', () => {
  // Why: a stale initial state would break every downstream test.
  it('initial state has an empty frames array', () => {
    const state = framesInSceneReducer(undefined, { type: '@@INIT' });
    expect(state.frames).toEqual([]);
  });

  // Why: the visualizer relies on monotonic growth — every
  // markReferencePoint-like dispatch must yield exactly one new entry.
  it('addFrameInScene appends in dispatch order', () => {
    let state = framesInSceneReducer(undefined, { type: '@@INIT' });
    state = framesInSceneReducer(
      state,
      addFrameInScene(makeFrame({ imageFile: 'frames/frame-000001.jpg' }))
    );
    state = framesInSceneReducer(
      state,
      addFrameInScene(makeFrame({ imageFile: 'frames/frame-000002.jpg' }))
    );
    expect(state.frames.map((f) => f.imageFile)).toEqual([
      'frames/frame-000001.jpg',
      'frames/frame-000002.jpg',
    ]);
  });

  // Why: every payload field must survive — losing position or rotation
  // would put tiles at the world origin / unrotated by accident.
  it('preserves every payload field verbatim', () => {
    const frame = makeFrame({
      imageFile: 'frames/frame-000099.jpg',
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3, 0.9],
      screenRotation: 270,
      capturedAt: 1_700_000_005_000,
    });
    const state = framesInSceneReducer({ frames: [] }, addFrameInScene(frame));
    expect(state.frames[0]).toEqual(frame);
  });

  // Why: scenario switches / new recording sessions need a clean slate.
  it('clearFramesInScene empties the array without touching identity', () => {
    let state = framesInSceneReducer(undefined, { type: '@@INIT' });
    state = framesInSceneReducer(state, addFrameInScene(makeFrame()));
    state = framesInSceneReducer(state, clearFramesInScene());
    expect(state.frames).toEqual([]);
  });

  it('resetFramesInSceneState returns to the initial state', () => {
    let state = framesInSceneReducer(undefined, { type: '@@INIT' });
    state = framesInSceneReducer(state, addFrameInScene(makeFrame()));
    state = framesInSceneReducer(state, resetFramesInSceneState());
    expect(state).toEqual({ frames: [] });
  });
});
