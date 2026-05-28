# ref-point-subscribers.ts

## Purpose

Recorder-app wiring between the flat `selectRefPointEntries` selector
and the `RefPointVisualizer`. Step 5.3 of
`2026-05-27-collapse-refpoint-and-frame-slices-plan.md` migrated this
subscriber from the library's `selectReferencePoints` (over
`state.gpsData.referencePoints`) onto the recorder-side slice
`state.refPoints.entries`, which is now the single source of truth
for ref points in the recorder.

## Public API

- `wireRefPointSubscribers(store, visualizer): () => void`
  - `store: RecorderStore` — recorder store.
  - `visualizer: Pick<RefPointVisualizer, 'syncRefPoints'> | null` —
    `null` is accepted (no-op) so headless / replay paths can opt out.
  - Returns an unsubscribe function that detaches the store listener.

## Invariants & assumptions

- Performs an initial `syncRefPoints` call on attach so existing entries
  render immediately (e.g. imported via the OPFS sidecar fast-path
  before the subscriber attached).
- Subsequent calls fire **iff** `selectRefPointEntries` returns a new
  array reference. The memoised selector returns the same reference when
  `state.refPoints` is unchanged, so unrelated state mutations don't
  trigger re-renders.
- The visualizer owns the id-based diff and decides which inserts to
  animate; this wirer just forwards the full selector result.

## Tests

- `ref-point-subscribers.test.ts` — initial sync on attach, sync on
  selector-result change, no-op when result reference is unchanged,
  null-visualizer no-op, and unsubscribe detaches.

## Related docs

- `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md`
- `recorder-store.ts.md`
- `ref-points-slice.ts.md`
- `ref-point-visualizer.ts.md`

