# routing-slice.ts

## Purpose

Redux slice for tracking the current application screen in the recorder.
Originally introduced in Bug 2 of the SPA architecture audit to move
`currentScreen` from a module-level variable in `navigation.ts` into the
Redux store (single source of truth, time-travel debugging).

Recorder-only. The framework intentionally does not impose a routing
pattern; apps that don't need a `'setup' → 'ar' → 'recording' → 'summary'`
flow can compose their own slice (or skip Redux routing entirely) via
`createSlamAppStore`'s `extraReducers` seam.

Moved out of the framework in Iter 1 of the [AppFramework / RecorderApp
boundary migration plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).

## Public API

- `AppScreen` — `'setup' | 'ar' | 'recording' | 'summary'`.
- `RoutingState` — `{ currentScreen: AppScreen }`.
- `navigateTo(screen)` — action creator dispatching a screen change.
- `routingReducer` — pure reducer for the `routing` slice.

## State shape

```ts
{
  currentScreen: 'setup';
} // initial
```

## Invariants

- Initial state is always `{ currentScreen: 'setup' }`.
- `navigateTo` overwrites `currentScreen` — no history stack in Redux
  (browser history handles that).
- Routing actions (`routing/navigateTo`) are **not persisted** during
  recording — they are UI state, not session data.

## Examples

```ts
import { routingReducer, navigateTo } from './routing-slice';

const state = routingReducer(undefined, { type: '@@INIT' });
// → { currentScreen: 'setup' }
const next = routingReducer(state, navigateTo('ar'));
// → { currentScreen: 'ar' }
```

## Tests

- [routing-slice.test.ts](routing-slice.test.ts) — 5 unit tests covering
  initial state, all screen values, successive navigations, and reset to
  setup.
- Integration coverage lives in
  [recorder-store.test.ts](recorder-store.test.ts) (combined-store
  routing dispatches, persistence exclusion).

## Related

- [navigation.ts](../ui/navigation.ts) — consumer.
- [recorder-store.ts](recorder-store.ts.md) — mounts this slice via
  `extraReducers`.
- [SPA architecture audit — Bug 2](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-06-spa-architecture-audit.md).
