# `setup-state-machine.ts` — sequential setup FSM

## Purpose

The pedagogical core of the starter example: an explicit, named, pure finite
state machine for the first-user-experience, replacing inline `if`/flag glue.

## Public API

- `initialSetupState: SetupState` — the `booting` start state.
- `setupReducer(state, event): SetupState` — pure reducer; unknown /
  out-of-branch events return the same reference (no-op).
- `canPlaceAnchor(state): boolean` — soft-gate predicate (placement branch
  only, never while saving).
- `isBusy(state): boolean` — true during the async `saving` phase.
- Types: `SetupPhase`, `SetupState`, `SetupEvent`.

### Branches

- **cache-miss:** `booting → awaiting-tracking ⇄ ready-to-place →
  (PLACE_REQUESTED) saving → (PLACE_SUCCEEDED) saved` /
  `(PLACE_FAILED) back to placeable + errorMessage`.
- **cache-hit:** `booting → relocalising → (tracking ready) anchor-shown`.

## Invariants & assumptions

- Placement is **soft-gated** (decision D2): `canPlaceAnchor` is true in both
  `awaiting-tracking` and `ready-to-place`; `trackingReady` only drives a
  *recommendation*, never a hard block.
- The async place/save honours the repo async-UX rule: `saving` is the
  in-progress state and resolves to either `saved` (final) or a placeable
  phase carrying `errorMessage` (revert). A fresh `PLACE_REQUESTED` clears a
  previous `errorMessage`.
- `BOOTED` is idempotent — only the initial `booting` phase reacts to it.
- The reducer never throws; it is exhaustively typed over `SetupEvent`.

## Examples

```ts
let s = setupReducer(initialSetupState, { type: 'BOOTED', hasCachedAnchor: false });
// s.phase === 'awaiting-tracking', canPlaceAnchor(s) === true
s = setupReducer(s, { type: 'PLACE_REQUESTED' });   // s.phase === 'saving', isBusy(s)
s = setupReducer(s, { type: 'PLACE_SUCCEEDED' });   // s.phase === 'saved'
```

## Tests

- [setup-state-machine.test.ts](./setup-state-machine.test.ts) — both
  branches, boot selection, soft-gate placement, async in-progress →
  final/revert transitions, error clearing, and no-op robustness.
