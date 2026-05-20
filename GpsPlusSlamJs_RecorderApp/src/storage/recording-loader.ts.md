# recording-loader.ts

## Purpose

Version-transparent entry point for reading recording zips. Hides recording-format evolution (era-1 through era-5) from every consumer (replay engine, audits, regression tests, investigation harness) by returning a fully-normalized [`LoadedRecording`](recording-loader.ts).

Background and motivation: [`2026-05-19-recording-loader-abstraction-plan.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-19-recording-loader-abstraction-plan.md).

## Public API

- `loadRecording(zip: Uint8Array): Promise<LoadedRecording>`
  - Reads metadata, actions, and ref-point sidecars from `zip` in parallel.
  - Applies [`migrateActionsIfNeeded`](recording-migration.ts) to actions so callers always see the current schema.
  - Builds a unified `RefPointDefinition[]` from sidecar `refPoints/*.json` files **merged** with `gpsData/markReferencePoint` actions in the log. Sidecar wins per id; ids that appear only in actions get reconstructed defs.
- `LoadedRecording` (immutable):
  - `meta: Record<string, unknown> | null` — `session.json`, or `null` when absent.
  - `actions: readonly ZipActionEntry[]` — chronological, post-migration.
  - `refPoints: readonly RefPointDefinition[]` — sidecar ∪ action-derived.
  - `capabilities: { hasSidecarRefPoints, hasFusedObservations, hasSessionMeta, migrationApplied }`.
  - `getFinalState(): CombinedRootState` — lazy, memoized replay into a fresh recorder store (`NullStorageBackend`, dev checks disabled).
- `RecordingCapabilities`, `LoadedRecording` — re-exported types.

## Invariants & Assumptions

- The migration layer is the single source of schema canonicalization. Action-derived ref-point reconstruction reads `payload.rawGpsPoint` (post-migration name) and only falls back to `payload.gpsPoint` defensively.
- Merge rule: action-derived defs are loaded first, then sidecar defs overwrite by id. This guarantees sidecar wins whenever both exist for the same `id`.
- `sessionId` for synthesized observations is taken from the `recording/startSession` action's `payload.sessionName`. Falls back to `${meta.contextTag}-${meta.startedAt}`, then `'legacy-session'`. Stable per-recording but not globally unique for legacy recordings without a startSession action — acceptable because consumers (visualizer, audit) only use `sessionId` for grouping.
- `getFinalState()` constructs a brand-new store on first call and caches the result. Suitable for tests and one-off audits; not suitable for long-running replay UIs (use the dedicated replay engine for those).
- Sidecar validation uses [`isRefPointDefinitionShape`](ref-point-zip-helpers.ts) — base shape only (id/name/createdAt/observations[]). Per-observation `arPose`/`gpsPoint` validation is deferred to consumers that need it.
- Parse errors in individual sidecar files are logged and skipped, never thrown. The loader is best-effort: a corrupted sidecar must not block loading the rest of the recording.

## Examples

```ts
import { loadRecording } from './recording-loader';
import * as fs from 'node:fs';

const zip = new Uint8Array(fs.readFileSync('recording.zip'));
const rec = await loadRecording(zip);

console.log(
  `Recording has ${rec.actions.length} actions, ${rec.refPoints.length} ref points`
);
if (!rec.capabilities.hasSidecarRefPoints) {
  console.log('Legacy recording — ref points reconstructed from actions');
}
if (rec.capabilities.migrationApplied) {
  console.log('Pre-era-4 recording — schema rewritten on the fly');
}

// Lazy: only replays when you ask.
const state = rec.getFinalState();
```

## Tests

- [`recording-loader.test.ts`](recording-loader.test.ts) — end-to-end against real fixtures from `TestDataJs/`:
  - `2026-03-05_06-47-31utc.zip` (era ≤ 3): asserts `migrationApplied`, no sidecars, refPoints reconstructed from actions with finite lat/lon.
  - `2026-04-23_15-55-36utc.zip` (era ≥ 4): asserts sidecar present, session.json present, at least one curated name (`name !== id`).
  - `getFinalState()` is memoized (`first === second`).

Tests skip themselves when `TestDataJs/` is not on disk (CI without test corpus).
