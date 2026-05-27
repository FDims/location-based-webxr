# ref-point-subscribers.ts

## Purpose

Recorder-app wiring between the canonical library `selectReferencePoints`
selector and the `RefPointVisualizer`. Step 4 of
`2026-05-27-collapse-refpoint-and-frame-slices-plan.md` migrated this
subscriber off the recorder-local `refPoints.{priorMarks,currentMarks}`
fields onto the library's authoritative reference-point array
(`state.gpsData.referencePoints`) so the 3D view tracks the same data
that ships in the recording and feeds replay.

## Public API

- `wireRefPointSubscribers(store, visualizer): () => void`
  - `store: RecorderStore` — recorder store.
  - `visualizer: Pick<RefPointVisualizer, 'syncRefPoints'> | null` —
    `null` is accepted (no-op) so headless / replay paths can opt out.
  - Returns an unsubscribe function that detaches the store listener.

## Invariants & assumptions

- Performs an initial `syncRefPoints` call on attach so existing marks
  render immediately (e.g. after a mid-session subscriber swap).
- Subsequent calls fire **iff** `selectReferencePoints` returns a new
  array reference. The memoised selector returns the same reference when
  `state.gpsData` is unchanged, so unrelated state mutations don't trigger
  re-renders.
- The visualizer owns the id-based diff and decides which inserts to
  animate; this wirer just forwards the full selector result.

## Tests

- `ref-point-subscribers.test.ts` — initial sync on attach, sync on
  selector-result change, no-op when result reference is unchanged,
  null-visualizer no-op, and unsubscribe detaches.

## Related docs

- `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md`
- `recorder-store.ts.md`
- `ref-point-visualizer.ts.md`
- `app-selectors.ts.md` (framework — defines `selectReferencePoints`)

