# zip-frame-blob-source.ts

F3.5a of the [tracking-quality regression & replay-gaps feedback](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).

`createZipFrameBlobSource(zipData)` returns a `FrameBlobSource`
(`(imageFile) => Promise<Blob | null>`) compatible with
[`wireFrameTileSubscribers`](../visualization/wire-frame-tile-subscribers.ts.md)'s
`blobSource` slot.

## Design

- The recording zip's central directory is read once at creation; an
  internal `Map<string, Entry>` indexes every non-directory entry by
  its filename. Subsequent lookups are O(1) + the per-frame decompress
  cost.
- Returns `null` for unknown paths so the wirer can skip silently
  (broken frames in the field-recording corpus).
- The `BlobWriter('image/jpeg')` type tag is a hint; the decoder
  (F3.5b) does not rely on it but it helps `createImageBitmap`'s
  format detection.

## Tested in

- `zip-frame-blob-source.test.ts`: round-trip read, missing-path
  fallback, repeated lookups.
- F3.6 will exercise it against the real field-recording fixture
  `gps-plus-slam/TestDataJs/2026-05-19_15-43-55utc.zip`.
