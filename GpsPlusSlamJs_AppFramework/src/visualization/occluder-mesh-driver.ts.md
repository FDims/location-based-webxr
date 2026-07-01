# occluder-mesh-driver.ts

## Purpose

Main-thread orchestration for the occluder Web Worker offload — the glue between the occluder wiring and a worker running `runMeshRequest`. THREE-free + framework-owned; a consumer supplies a `Worker` adapter and applies the result (e.g. `OcclusionMesh.applyMeshData`).

## Public API

- `new OccluderMeshDriver(poster: MeshWorkerPoster | null, options?)` — `null` ⇒ **synchronous fallback** (meshes inline, calls back immediately). `options`: `onWorkerUnusable?()` (the driver gave up on the worker → consumer should terminate it) and `onError?(err)` (a job aborted — worker error event or a sync-meshing throw — for logging).
- `request(cells, cellSizeM, mode, getCellPoint, onMesh)` — pack + post a mesh job; `onMesh(positions, indices)` fires when it returns.
- `busy` — a job is in flight (worker path).
- `dispose()` — detach the worker handlers, drop any pending job.
- `MeshWorkerPoster` — the minimal `Worker`-like surface (`postMessage(message, transfer)` + `onmessage` + `onerror`) the driver drives; `OnMesh` — the result callback; `OccluderMeshDriverOptions` — the optional callbacks above.

## Invariants & assumptions

- **Coalesce to latest:** at most ONE job in flight. A `request` made while busy becomes the single `pending` job (newest wins); intermediates are dropped — so work never queues behind a growing grid. On response, the completed job's `onMesh` fires, then the pending job (if any) is posted.
- **Sync fallback delivers immediately** (no coalescing needed — each `request` completes before returning).
- **Post-dispose safety:** a response arriving after `dispose()` (or with a stale id) is ignored; no callback fires.
- The driver does not own the worker lifecycle — the consumer terminates the `Worker` (see the recorder's `occluder-mesh-worker-client.ts`).
- **Error recovery (never wedges — *for errors that fire while a job is in flight*).** A worker error is routed to the driver via `poster.onerror`. When it fires with a job in flight (`inFlightId !== null` — the ordering of an **uncaught throw in `runMeshRequest`**), the driver clears the in-flight slot and re-posts the coalesced `pending` snapshot if one is queued (else the next `request` posts normally) — it never re-posts the *failed* job (deterministic bad data would loop). If the worker had never meshed (`hasSucceeded` still false) it is declared unusable (`onWorkerUnusable`) and the driver switches permanently to synchronous meshing; a worker that has meshed once is treated as transient and kept. The synchronous path also guards its `runMeshRequest` so a throw (e.g. bad `cellSizeM`) reports via `onError` and clears the slot instead of wedging.
  - **⚠️ Known gap (open):** `handleWorkerError` **early-returns when `inFlightId === null`**, so a worker that errors **before the first `request`** (the realistic ordering for a **module-load failure** — it errors within tens of ms, before the throttled first refresh) is ignored: `syncMode`/`onWorkerUnusable` never fire, and the first post then wedges the dead worker permanently (a load-failed worker silently discards messages, no second error). Fix: on `inFlightId === null` + `!hasSucceeded` + `!syncMode`, declare unusable so the first `request` meshes synchronously. See `GpsPlusSlamJs_Docs/docs/2026-07-01-occluder-worker-and-chunked-remesh-plan.md` §"Phase 1 gap" (**Residual gap**).

## Tests

- `occluder-mesh-driver.test.ts` — sync fallback matches a direct mesh; posts + delivers on response; coalesces to the latest (drops intermediates); no delivery after dispose; **error recovery** — a transient error re-posts the pending snapshot, an error with nothing queued un-wedges so the next request posts (the freeze regression guard), a first-error-before-success falls back to sync (`onWorkerUnusable` fired), and a sync-meshing throw reports via `onError` and recovers. Uses a fake poster (no worker env needed).
