/**
 * QR detection persistence — recorder store wiring (WS-1 of the recorder
 * live-QR plan).
 *
 * Why this matters: live QR detection records on the SAME action-stream
 * mechanism as every other recorded action — a dispatched RAW `recordQrDetection`
 * is persisted via `writeAction` iff recording is active and its slice prefix is
 * whitelisted. These tests pin: (1) a raw detection is written while recording,
 * with the raw shape intact; (2) nothing is written while stopped; (3) a
 * non-whitelisted control action is never written; (4) the recorder opts into
 * the longer live history cap without persisting that setup action.
 *
 * @see docs 2026-06-17-recorder-live-qr-detection-recording-plan.md (WS-1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';
import {
  createRecorderStore,
  startSession,
  recordQrDetection,
  RECORDER_QR_MAX_HISTORY,
  type RecorderStore,
  type QrDetectionEntry,
} from './recorder-store';

const writtenActions: unknown[] = [];
let pendingWrites: Promise<void>[] = [];

vi.mock('gps-plus-slam-app-framework/storage/file-system', () => ({
  writeAction: vi.fn().mockImplementation((action) => {
    writtenActions.push(action);
    const p = Promise.resolve();
    pendingWrites.push(p);
    return p;
  }),
}));

async function flushWrites(): Promise<void> {
  await Promise.all(pendingWrites);
  pendingWrites = [];
}

/** A RAW detection entry (decision D-A): no solved pose, just detector output. */
function rawDetection(text = 'https://x/y', t = 1000): QrDetectionEntry {
  return {
    text,
    timestamp: t,
    corners: [
      { x: 10, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 110 },
      { x: 10, y: 110 },
    ],
    cameraPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
    projectionMatrix: [1.875, 0, 0, 0, 0, 2.5, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0],
    imageWidth: 640,
    imageHeight: 480,
  };
}

describe('QR detection persistence (recorder store)', () => {
  let store: RecorderStore;

  beforeEach(() => {
    writtenActions.length = 0;
    pendingWrites = [];
    store = createRecorderStore();
  });

  it('persists a RAW recordQrDetection while recording, with the raw shape intact', async () => {
    store.dispatch(
      startSession({ scenarioName: 'T', sessionName: 't', startTime: 1 })
    );
    const entry = rawDetection();
    store.dispatch(recordQrDetection(entry));
    await flushWrites();

    const qrAction = writtenActions.find(
      (a) => (a as RecordedAction).type === 'qrDetected/recordQrDetection'
    ) as { type: string; payload: QrDetectionEntry } | undefined;

    expect(qrAction).toBeDefined();
    expect(qrAction!.payload).toEqual(entry);
    // RAW: the recording carries no baked-in solved pose (re-test guarantee).
    expect(qrAction!.payload).not.toHaveProperty('qrPoseWorld');
  });

  it('does NOT persist a detection while not recording', async () => {
    store.dispatch(recordQrDetection(rawDetection()));
    await flushWrites();
    expect(
      writtenActions.some(
        (a) => (a as RecordedAction).type === 'qrDetected/recordQrDetection'
      )
    ).toBe(false);
  });

  it('does NOT persist a non-whitelisted control action while recording', async () => {
    store.dispatch(
      startSession({ scenarioName: 'T', sessionName: 't', startTime: 1 })
    );
    store.dispatch({ type: 'someOther/control', payload: {} });
    await flushWrites();
    expect(
      writtenActions.some(
        (a) => (a as RecordedAction).type === 'someOther/control'
      )
    ).toBe(false);
  });

  it('opts into the longer live history cap without persisting the setup action', async () => {
    // The maxHistory cap is applied at store setup (before recording), so the
    // setQrMaxHistory action is never written even though qrDetected/* is
    // whitelisted.
    expect(store.getState().qrDetected.maxHistory).toBe(
      RECORDER_QR_MAX_HISTORY
    );
    store.dispatch(
      startSession({ scenarioName: 'T', sessionName: 't', startTime: 1 })
    );
    await flushWrites();
    expect(
      writtenActions.some(
        (a) => (a as RecordedAction).type === 'qrDetected/setQrMaxHistory'
      )
    ).toBe(false);
  });
});
