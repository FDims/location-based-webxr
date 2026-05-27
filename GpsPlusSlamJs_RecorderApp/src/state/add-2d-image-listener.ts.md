# `add-2d-image-listener.ts`

## Purpose

RTK listener middleware that observes every accepted
`gpsData/add2dImage` action and dispatches a matching
`framesInScene/addFrameInScene` so the new `framesInScene` slice
stays a faithful mirror of captured-frame events in both live
recording and replay. Per F3 of
[2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md)
this is the seam that lets the 3D textured-tile visualizer render
identically in both modes.

## Public API

- `createAdd2dImageListenerMiddleware(): Middleware` — factory that
  produces the listener middleware to plug into
  `createSlamAppStore({ extraMiddleware: [...] })`.

## Design notes

- Twin of `ref-point-mark-listener.ts`. The pattern (factory +
  `createListenerMiddleware` + `isAnyOf(action)` matcher + payload
  validation guard) is intentionally identical so future readers see
  one shape for "framework action → app-owned mirror slice".
- The slice stores **raw WebXR** pose verbatim. Coordinate-space
  conversion (`webxrToNUE`) lives in the visualizer to keep the slice
  serializable and to match what `ref-point-mark-listener.ts`
  already does.
- Broken-frame filtering does **not** belong here — it requires
  knowing the on-disk blob size and so happens further downstream in
  the visualizer/wiring layer where the blob is fetched.

## Tests

- `add-2d-image-listener.test.ts` — unit tests around a real
  `createRecorderStore({ storageBackend: new NullStorageBackend() })`
  asserting that one `add2dImage` dispatch produces exactly one
  `framesInScene/addFrameInScene` with payload preserved verbatim,
  and that malformed payloads are ignored.
