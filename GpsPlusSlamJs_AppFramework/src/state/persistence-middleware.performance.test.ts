/**
 * Performance threshold guard for persistence middleware synchronous overhead.
 *
 * Why this test matters: The persistence middleware runs on EVERY Redux
 * dispatch during recording. Its synchronous path (action type checks,
 * recording state checks, index increment, WriteQueue enqueue) must not
 * add perceptible latency to the dispatch cycle. The actual async OPFS
 * writes are non-blocking and not measured here.
 *
 * The test dispatches a burst of actions through a fully-wired middleware
 * instance and measures the average synchronous overhead per dispatch.
 * The storage backend resolves instantly (Promise.resolve) so only the
 * middleware's own synchronous code is measured.
 */

import { describe, expect, test, vi } from 'vitest';
import {
  configureStore,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { StorageBackend } from '../storage/storage-backend';
import { createPersistenceMiddleware } from './persistence-middleware';

// ---------------------------------------------------------------------------
// Minimal slices (mirror the test helper pattern from persistence-middleware.test.ts)
// ---------------------------------------------------------------------------

const testRecorderSlice = createSlice({
  name: 'recorder',
  initialState: { isRecording: false, failedWriteCount: 0 },
  reducers: {
    startSession(state) {
      state.isRecording = true;
      state.failedWriteCount = 0;
    },
    endSession(state) {
      state.isRecording = false;
    },
    recordWriteFailure(state) {
      state.failedWriteCount += 1;
    },
  },
});

const testGpsDataSlice = createSlice({
  name: 'gpsData',
  initialState: null as { lat: number; lon: number } | null,
  reducers: {
    setZeroPos(_state, action: PayloadAction<{ lat: number; lon: number }>) {
      return action.payload;
    },
  },
});

// ---------------------------------------------------------------------------
// Measurement helper (inlined — perfTestUtils is not exported from GpsPlusSlamJs)
// ---------------------------------------------------------------------------

function measureAverageMs(iterations: number, fn: () => void): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  return (performance.now() - start) / iterations;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of dispatches per measurement pass. */
const DISPATCH_COUNT = 500;

/**
 * Maximum acceptable average per-dispatch overhead in milliseconds.
 *
 * The middleware's synchronous path is type-checking + state reads +
 * index increment + one WriteQueue.enqueue. On modern hardware this
 * is sub-0.01ms. Budget set to 0.1ms (~10× headroom) to absorb CI
 * variance and GC pauses.
 */
const MAX_PER_DISPATCH_MS = 0.1;

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('persistence middleware synchronous overhead', () => {
  test(
    'per-dispatch overhead during recording stays within budget',
    { timeout: 15_000 },
    () => {
      const mockBackend: StorageBackend = {
        createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
        listSessions: vi.fn().mockResolvedValue([]),
        writeAction: vi.fn().mockResolvedValue(undefined),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
      };

      const store = configureStore({
        reducer: {
          recorder: testRecorderSlice.reducer,
          gpsData: testGpsDataSlice.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
            immutableCheck: false,
          }).concat(
            createPersistenceMiddleware({
              storageBackend: mockBackend,
              persistedPrefixes: ['gpsData', 'recording'],
            })
          ),
      });

      // Start recording so the middleware enters its hot path
      store.dispatch(testRecorderSlice.actions.startSession());

      const action = testGpsDataSlice.actions.setZeroPos({ lat: 48, lon: 2 });

      const avgMs = measureAverageMs(DISPATCH_COUNT, () => {
        store.dispatch(action);
      });

      if (process.env.DEBUG_PERF === '1') {
        console.info(
          `[perf] persistence middleware per-dispatch avg ms: ${avgMs.toFixed(6)}`
        );
      }

      expect(avgMs).toBeLessThanOrEqual(MAX_PER_DISPATCH_MS);
    }
  );

  test(
    'per-dispatch overhead when NOT recording stays within budget',
    { timeout: 15_000 },
    () => {
      const mockBackend: StorageBackend = {
        createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
        listSessions: vi.fn().mockResolvedValue([]),
        writeAction: vi.fn().mockResolvedValue(undefined),
        writeFrame: vi.fn().mockResolvedValue(undefined),
        writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
      };

      const store = configureStore({
        reducer: {
          recorder: testRecorderSlice.reducer,
          gpsData: testGpsDataSlice.reducer,
        },
        middleware: (getDefaultMiddleware) =>
          getDefaultMiddleware({
            serializableCheck: false,
            immutableCheck: false,
          }).concat(
            createPersistenceMiddleware({
              storageBackend: mockBackend,
              persistedPrefixes: ['gpsData', 'recording'],
            })
          ),
      });

      // Do NOT start recording — middleware early-exits on isRecording=false
      const action = testGpsDataSlice.actions.setZeroPos({ lat: 48, lon: 2 });

      const avgMs = measureAverageMs(DISPATCH_COUNT, () => {
        store.dispatch(action);
      });

      if (process.env.DEBUG_PERF === '1') {
        console.info(
          `[perf] persistence middleware (not recording) per-dispatch avg ms: ${avgMs.toFixed(6)}`
        );
      }

      // Not-recording path is cheaper (early exit), same budget applies
      expect(avgMs).toBeLessThanOrEqual(MAX_PER_DISPATCH_MS);
    }
  );
});
