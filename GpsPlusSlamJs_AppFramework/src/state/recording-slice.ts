/**
 * Redux slice for recording session lifecycle management.
 *
 * Extracted from store.ts to enable proper separation of concerns and
 * break circular dependencies with persistence-middleware.ts.
 *
 * Manages: recording state, session metadata, write failure tracking.
 *
 * @see docs/2026-04-07-architecture-observations-consolidated.md §4
 */

import type { Draft, PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import { type RecordingOptions } from './recording-options';
import type { DepthSample } from '../types/ar-types';

// --- Recording-specific Types ---

export interface SessionMetadata {
  scenarioName: string;
  sessionName: string;
  startTime: number;
  deviceInfo?: string;
  notes?: string;
  /** Recording options used for this session (for replay context) */
  recordingOptions?: RecordingOptions;
}

export interface RecordingState {
  isRecording: boolean;
  sessionMetadata: SessionMetadata | null;
  actionCount: number;
  /**
   * Count of failed file write operations during this session.
   * User Feedback Issue #1 Part B: Track write failures for visibility.
   */
  failedWriteCount: number;
  /**
   * The most recent depth sample, kept ONLY so subscribers can observe new
   * samples via reference comparison (the AR-space occupancy grid is fed
   * this way — see the 2026-06-11 occupancy-grid port plan). The persisted
   * action stream remains the source of truth; no history is kept here.
   * The payload stays in raw WebXR coordinates — conversion-free.
   */
  latestDepthSample: DepthSample | null;
}

// --- Initial State ---

const initialRecordingState: RecordingState = {
  isRecording: false,
  sessionMetadata: null,
  actionCount: 0,
  failedWriteCount: 0,
  latestDepthSample: null,
};

// --- Recording Slice ---

const recordingSlice = createSlice({
  name: 'recording',
  initialState: initialRecordingState,
  reducers: {
    startSession(state, action: PayloadAction<SessionMetadata>) {
      state.isRecording = true;
      state.sessionMetadata = action.payload;
      state.actionCount = 0;
      state.failedWriteCount = 0;
      state.latestDepthSample = null;
    },

    endSession(state) {
      state.isRecording = false;
    },

    /**
     * Record a depth sample from WebXR depth sensing.
     * The sample includes camera pose and a grid of depth points.
     * This action is persisted to enable replay with depth data.
     *
     * The reducer stores only the LATEST sample (observation hook for
     * subscribers like the occupancy-grid wiring); it applies no
     * coordinate conversion — the payload stays raw WebXR, exactly as
     * persisted.
     */
    recordDepthSample(state, action: PayloadAction<DepthSample>) {
      // castDraft equivalent: the payload's readonly tuples are stored
      // as-is (never mutated), only the type needs the Draft view.
      state.latestDepthSample = action.payload as Draft<DepthSample>;
    },

    /**
     * Record a write failure during persistence.
     * User Feedback Issue #1 Part B: Track write failures for session summary.
     */
    recordWriteFailure(state, _action: PayloadAction<string>) {
      state.failedWriteCount += 1;
    },
  },
});

export const {
  startSession,
  endSession,
  recordDepthSample,
  recordWriteFailure,
} = recordingSlice.actions;

export const recordingReducer = recordingSlice.reducer;
