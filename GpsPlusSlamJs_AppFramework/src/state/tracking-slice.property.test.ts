/**
 * Property-based tests for the tracking slice.
 *
 * Invariants under random `[poseReceived, poseLost, originReset,
 * resetTracking, clearLastRestartedPayload]` walks:
 *
 *   1. `phase` is one of the three literals.
 *   2. `lostFrameCount` is non-negative.
 *   3. `originResetDuringLoss` is `false` whenever `phase !== 'lost'`.
 *   4. `lastValidPose` stays `null` until at least one `poseReceived`.
 *   5. `resetTracking` returns the slice to the initial state regardless
 *      of history.
 *
 * Why this matters: the slice replaces a hand-rolled state machine; random
 * traversal catches transitions the unit tests don't explicitly enumerate.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { configureStore } from '@reduxjs/toolkit';
import {
  trackingReducer,
  poseReceived,
  poseLost,
  originReset,
  resetTracking,
  clearLastRestartedPayload,
  type DeviceOrientation,
} from './tracking-slice';
import type { ARPose } from '../types/ar-types';

const arbARPose: fc.Arbitrary<ARPose> = fc.record({
  position: fc.record({
    x: fc.double({ min: -1000, max: 1000, noNaN: true }),
    y: fc.double({ min: -1000, max: 1000, noNaN: true }),
    z: fc.double({ min: -1000, max: 1000, noNaN: true }),
  }),
  orientation: fc.record({
    x: fc.double({ min: -1, max: 1, noNaN: true }),
    y: fc.double({ min: -1, max: 1, noNaN: true }),
    z: fc.double({ min: -1, max: 1, noNaN: true }),
    w: fc.double({ min: -1, max: 1, noNaN: true }),
  }),
});

const arbOrientation: fc.Arbitrary<DeviceOrientation> = fc.record({
  alpha: fc.double({ min: 0, max: 360, noNaN: true }),
  beta: fc.double({ min: -180, max: 180, noNaN: true }),
  gamma: fc.double({ min: -90, max: 90, noNaN: true }),
  absolute: fc.boolean(),
});

type Event =
  | { type: 'pose'; pose: ARPose; orientation: DeviceOrientation }
  | { type: 'lost' }
  | { type: 'reset' }
  | { type: 'clear' };

const arbEvent: fc.Arbitrary<Event> = fc.oneof(
  fc.record({
    type: fc.constant('pose' as const),
    pose: arbARPose,
    orientation: arbOrientation,
  }),
  fc.record({ type: fc.constant('lost' as const) }),
  fc.record({ type: fc.constant('reset' as const) }),
  fc.record({ type: fc.constant('clear' as const) })
);

function createStore() {
  return configureStore({ reducer: { tracking: trackingReducer } });
}

function apply(store: ReturnType<typeof createStore>, ev: Event) {
  if (ev.type === 'pose') {
    store.dispatch(
      poseReceived({ pose: ev.pose, sensorOrientation: ev.orientation })
    );
  } else if (ev.type === 'lost') {
    store.dispatch(poseLost());
  } else if (ev.type === 'reset') {
    store.dispatch(originReset());
  } else {
    store.dispatch(clearLastRestartedPayload());
  }
}

describe('trackingSlice — property tests', () => {
  it('phase is always one of the three literals', () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 60 }), (events) => {
        const store = createStore();
        for (const ev of events) {
          apply(store, ev);
          const phase = store.getState().tracking.phase;
          expect(['initializing', 'tracking', 'lost']).toContain(phase);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('lostFrameCount is always non-negative', () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 60 }), (events) => {
        const store = createStore();
        for (const ev of events) {
          apply(store, ev);
          expect(
            store.getState().tracking.lostFrameCount
          ).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('originResetDuringLoss can only be true while phase === lost', () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 60 }), (events) => {
        const store = createStore();
        for (const ev of events) {
          apply(store, ev);
          const { phase, originResetDuringLoss } = store.getState().tracking;
          // Implication: phase !== 'lost' ⇒ originResetDuringLoss === false.
          // Encoded as a boolean so the assertion is unconditional.
          expect(phase === 'lost' || originResetDuringLoss === false).toBe(
            true
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  it('lastValidPose stays null until the first poseReceived', () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 30 }), (events) => {
        const store = createStore();
        let seenPose = false;
        for (const ev of events) {
          apply(store, ev);
          if (ev.type === 'pose') seenPose = true;
          // Implication: !seenPose ⇒ lastValidPose === null.
          const lastValidPose = store.getState().tracking.lastValidPose;
          expect(seenPose || lastValidPose === null).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('resetTracking returns to the initial state regardless of history', () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 60 }), (events) => {
        const store = createStore();
        for (const ev of events) apply(store, ev);
        store.dispatch(resetTracking());
        const state = store.getState().tracking;
        expect(state.phase).toBe('initializing');
        expect(state.lastValidPose).toBeNull();
        expect(state.lastSensorOrientation).toBeNull();
        expect(state.lostFrameCount).toBe(0);
        expect(state.originResetDuringLoss).toBe(false);
        expect(state.resetTransform).toBeUndefined();
        expect(state.lastRestartedPayload).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('poseReceived after any history leaves phase = tracking and resets lostFrameCount', () => {
    fc.assert(
      fc.property(
        fc.array(arbEvent, { maxLength: 30 }),
        arbARPose,
        arbOrientation,
        (events, finalPose, finalOrientation) => {
          const store = createStore();
          for (const ev of events) apply(store, ev);
          store.dispatch(
            poseReceived({
              pose: finalPose,
              sensorOrientation: finalOrientation,
            })
          );
          const state = store.getState().tracking;
          expect(state.phase).toBe('tracking');
          expect(state.lostFrameCount).toBe(0);
          expect(state.lastValidPose).toEqual(finalPose);
        }
      ),
      { numRuns: 100 }
    );
  });
});
