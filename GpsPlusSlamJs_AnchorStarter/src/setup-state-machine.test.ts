/**
 * Unit tests for the setup state machine (setup-state-machine.ts).
 *
 * Why this test matters: this FSM is the *pedagogical core* of the starter
 * example.
 * It makes the "is there a cached anchor? no → place mode; yes → load and
 * show" branch explicit and self-explaining instead of inline `if`/flag
 * spaghetti. These tests pin both branches, the soft-gate placement rule
 * (D2), and the async in-progress → final/revert transitions the repo's
 * async-UX rule requires.
 */

import { describe, it, expect } from 'vitest';
import {
  initialSetupState,
  setupReducer,
  canPlaceAnchor,
  isBusy,
  type SetupState,
} from './setup-state-machine.js';

function boot(hasCachedAnchor: boolean): SetupState {
  return setupReducer(initialSetupState, { type: 'BOOTED', hasCachedAnchor });
}

describe('setupReducer — boot branch selection', () => {
  it('starts in the booting phase', () => {
    expect(initialSetupState.phase).toBe('booting');
    expect(canPlaceAnchor(initialSetupState)).toBe(false);
  });

  it('cache-miss boot enters the placement (awaiting-tracking) branch', () => {
    expect(boot(false).phase).toBe('awaiting-tracking');
  });

  it('cache-hit boot enters the relocalising branch', () => {
    expect(boot(true).phase).toBe('relocalising');
  });
});

describe('setupReducer — cache-miss placement branch', () => {
  it('advances awaiting-tracking → ready-to-place when tracking becomes ready', () => {
    const s = setupReducer(boot(false), {
      type: 'TRACKING_READY_CHANGED',
      ready: true,
    });
    expect(s.phase).toBe('ready-to-place');
    expect(s.trackingReady).toBe(true);
  });

  it('regresses ready-to-place → awaiting-tracking when tracking degrades', () => {
    let s = setupReducer(boot(false), {
      type: 'TRACKING_READY_CHANGED',
      ready: true,
    });
    s = setupReducer(s, { type: 'TRACKING_READY_CHANGED', ready: false });
    expect(s.phase).toBe('awaiting-tracking');
    expect(s.trackingReady).toBe(false);
  });

  it('SOFT GATE (D2): placement is allowed even before tracking is ready', () => {
    const awaiting = boot(false);
    expect(awaiting.phase).toBe('awaiting-tracking');
    expect(canPlaceAnchor(awaiting)).toBe(true);

    const ready = setupReducer(awaiting, {
      type: 'TRACKING_READY_CHANGED',
      ready: true,
    });
    expect(canPlaceAnchor(ready)).toBe(true);
  });

  it('PLACE_REQUESTED moves into the saving in-progress phase', () => {
    const s = setupReducer(boot(false), { type: 'PLACE_REQUESTED' });
    expect(s.phase).toBe('saving');
    expect(isBusy(s)).toBe(true);
    // While saving, no second placement may be dispatched.
    expect(canPlaceAnchor(s)).toBe(false);
  });

  it('PLACE_SUCCEEDED moves saving → saved (final state, prompts reload)', () => {
    let s = setupReducer(boot(false), { type: 'PLACE_REQUESTED' });
    s = setupReducer(s, { type: 'PLACE_SUCCEEDED' });
    expect(s.phase).toBe('saved');
    expect(isBusy(s)).toBe(false);
  });

  it('PLACE_FAILED reverts saving → placeable phase and surfaces the error', () => {
    // tracking was ready before placing → revert to ready-to-place.
    let s = setupReducer(boot(false), {
      type: 'TRACKING_READY_CHANGED',
      ready: true,
    });
    s = setupReducer(s, { type: 'PLACE_REQUESTED' });
    expect(s.phase).toBe('saving');
    s = setupReducer(s, { type: 'PLACE_FAILED', message: 'disk full' });
    expect(s.phase).toBe('ready-to-place');
    expect(s.errorMessage).toBe('disk full');
    expect(isBusy(s)).toBe(false);
  });

  it('PLACE_FAILED reverts to awaiting-tracking when tracking was not ready', () => {
    let s = setupReducer(boot(false), { type: 'PLACE_REQUESTED' });
    s = setupReducer(s, { type: 'PLACE_FAILED', message: 'nope' });
    expect(s.phase).toBe('awaiting-tracking');
    expect(s.errorMessage).toBe('nope');
  });

  it('a fresh PLACE_REQUESTED clears a previous error message', () => {
    let s = setupReducer(boot(false), { type: 'PLACE_REQUESTED' });
    s = setupReducer(s, { type: 'PLACE_FAILED', message: 'boom' });
    expect(s.errorMessage).toBe('boom');
    s = setupReducer(s, { type: 'PLACE_REQUESTED' });
    expect(s.errorMessage).toBeNull();
  });
});

describe('setupReducer — cache-hit relocalise branch', () => {
  it('advances relocalising → anchor-shown when tracking becomes ready', () => {
    const s = setupReducer(boot(true), {
      type: 'TRACKING_READY_CHANGED',
      ready: true,
    });
    expect(s.phase).toBe('anchor-shown');
    expect(s.trackingReady).toBe(true);
  });

  it('does not offer placement in the relocalise branch (soft gate is placement-only)', () => {
    expect(canPlaceAnchor(boot(true))).toBe(false);
    const shown = setupReducer(boot(true), {
      type: 'TRACKING_READY_CHANGED',
      ready: true,
    });
    expect(canPlaceAnchor(shown)).toBe(false);
  });
});

describe('setupReducer — robustness', () => {
  it('ignores out-of-branch events instead of throwing', () => {
    // PLACE_REQUESTED while still booting is a no-op.
    const s = setupReducer(initialSetupState, { type: 'PLACE_REQUESTED' });
    expect(s).toBe(initialSetupState);
  });

  it('ignores BOOTED after boot (idempotent guard)', () => {
    const placed = boot(false);
    const again = setupReducer(placed, {
      type: 'BOOTED',
      hasCachedAnchor: true,
    });
    expect(again.phase).toBe('awaiting-tracking');
  });
});
