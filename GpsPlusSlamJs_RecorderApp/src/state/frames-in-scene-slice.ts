/**
 * Redux slice for captured frames placed as textured 3D tiles in the
 * scene.
 *
 * One `FrameInScene` entry per accepted `gpsData/add2dImage` action: the
 * pose at capture time + the path of the JPEG inside the recording zip
 * (or in OPFS for live mode). The visualizer subscribes to this slice
 * and lazily loads the blob to build a `THREE.Mesh` tile.
 *
 * See F3 of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import type { Vector3, Quaternion } from 'gps-plus-slam-app-framework/core';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

/**
 * A single captured frame to render as a tile in 3D space.
 *
 * `imageFile` is the storage-relative path (matches the `imageFile`
 * field on `gpsData/add2dImage`). `position` and `rotation` are the
 * raw WebXR camera pose at capture time, exactly as written into the
 * recording.
 */
export interface FrameInScene {
  imageFile: string;
  position: Vector3;
  rotation: Quaternion;
  screenRotation: number;
  /** Epoch milliseconds, when available on the source payload. */
  capturedAt?: number;
}

export interface FramesInSceneState {
  frames: FrameInScene[];
}

const initialState: FramesInSceneState = {
  frames: [],
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const framesInSceneSlice = createSlice({
  name: 'framesInScene',
  initialState,
  reducers: {
    /** Append a single frame entry (idempotency is not enforced here). */
    addFrameInScene(state, action: PayloadAction<FrameInScene>) {
      // FrameInScene's `position`/`rotation` are readonly tuples that
      // Immer's WritableNonArrayDraft refuses to widen — same pattern
      // as `addCurrentRefPointMark` in ref-points-slice.ts.
      (state as { frames: FrameInScene[] }).frames.push(action.payload);
    },
    clearFramesInScene(state) {
      state.frames = [];
    },
    resetFramesInSceneState() {
      return initialState;
    },
  },
});

export const { addFrameInScene, clearFramesInScene, resetFramesInSceneState } =
  framesInSceneSlice.actions;

export const framesInSceneReducer = framesInSceneSlice.reducer;
