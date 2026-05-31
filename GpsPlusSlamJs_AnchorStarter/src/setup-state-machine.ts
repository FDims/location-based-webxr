/**
 * Setup state machine — the pedagogical core of the persistent-anchor
 * starter example.
 *
 * It encodes the sequential first-user-experience as an explicit, named,
 * pure finite state machine instead of inline `if`/flag glue.
 *
 * Two branches, chosen at boot by "is there a cached anchor?":
 *
 *   cache-miss:  booting → awaiting-tracking ⇄ ready-to-place
 *                          → (PLACE_REQUESTED) saving
 *                          → (PLACE_SUCCEEDED) saved        [prompt reload]
 *                          → (PLACE_FAILED)    back to placeable + error
 *
 *   cache-hit:   booting → relocalising → (tracking ready) anchor-shown
 *
 * Placement is **soft-gated** (decision D2): the user may place the anchor
 * at any point in the placement branch; tracking-readiness only drives a
 * *recommendation* (surfaced by the onboarding guidance meter), never a
 * hard block. The async place/save follows the repo async-UX rule: the
 * `saving` phase is the in-progress state and resolves to either `saved`
 * (final) or back to a placeable phase carrying `errorMessage` (revert).
 */

export type SetupPhase =
  | 'booting'
  | 'awaiting-tracking'
  | 'ready-to-place'
  | 'saving'
  | 'saved'
  | 'relocalising'
  | 'anchor-shown';

export interface SetupState {
  readonly phase: SetupPhase;
  /**
   * Whether tracking is currently good enough to *recommend* placing (or, in
   * the cache-hit branch, to reveal the saved anchor). Soft-gate: placement
   * is allowed regardless of this flag.
   */
  readonly trackingReady: boolean;
  /** Last placement error, surfaced to the user; cleared on the next attempt. */
  readonly errorMessage: string | null;
}

export type SetupEvent =
  | { type: 'BOOTED'; hasCachedAnchor: boolean }
  | { type: 'TRACKING_READY_CHANGED'; ready: boolean }
  | { type: 'PLACE_REQUESTED' }
  | { type: 'PLACE_SUCCEEDED' }
  | { type: 'PLACE_FAILED'; message: string };

export const initialSetupState: SetupState = {
  phase: 'booting',
  trackingReady: false,
  errorMessage: null,
};

/**
 * Pure reducer. Unknown / out-of-branch events return the *same* state
 * reference (no-op), so callers can dispatch freely without guarding every
 * transition.
 */
export function setupReducer(state: SetupState, event: SetupEvent): SetupState {
  switch (event.type) {
    case 'BOOTED': {
      // Idempotent guard: only the initial booting phase reacts to BOOTED.
      if (state.phase !== 'booting') return state;
      return {
        ...state,
        phase: event.hasCachedAnchor ? 'relocalising' : 'awaiting-tracking',
      };
    }

    case 'TRACKING_READY_CHANGED': {
      const trackingReady = event.ready;
      let phase = state.phase;
      if (event.ready) {
        if (state.phase === 'awaiting-tracking') phase = 'ready-to-place';
        else if (state.phase === 'relocalising') phase = 'anchor-shown';
      } else if (state.phase === 'ready-to-place') {
        phase = 'awaiting-tracking';
      }
      if (phase === state.phase && trackingReady === state.trackingReady) {
        return state;
      }
      return { ...state, phase, trackingReady };
    }

    case 'PLACE_REQUESTED': {
      if (state.phase !== 'awaiting-tracking' && state.phase !== 'ready-to-place') {
        return state;
      }
      return { ...state, phase: 'saving', errorMessage: null };
    }

    case 'PLACE_SUCCEEDED': {
      if (state.phase !== 'saving') return state;
      return { ...state, phase: 'saved' };
    }

    case 'PLACE_FAILED': {
      if (state.phase !== 'saving') return state;
      // Async-UX rule: revert the in-progress state and surface the error.
      return {
        ...state,
        phase: state.trackingReady ? 'ready-to-place' : 'awaiting-tracking',
        errorMessage: event.message,
      };
    }

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Soft-gate predicate: may the user dispatch a placement now? True only in
 * the cache-miss placement branch and never while a save is in flight.
 */
export function canPlaceAnchor(state: SetupState): boolean {
  return state.phase === 'awaiting-tracking' || state.phase === 'ready-to-place';
}

/** Is an async operation (the anchor save) currently in progress? */
export function isBusy(state: SetupState): boolean {
  return state.phase === 'saving';
}
