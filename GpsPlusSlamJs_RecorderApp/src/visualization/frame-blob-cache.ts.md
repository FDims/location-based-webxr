# frame-blob-cache.ts

## Purpose

In-memory, LRU, byte-capped cache for captured frame JPEG `Blob`s held
during a live recording session. Bounds the memory growth of the live
frame-tile pipeline so multi-hour outdoor sessions don't accumulate every
captured JPEG in RAM.

## Public API

- `new FrameBlobCache({ maxBytes })` — construct with a positive byte cap.
  Throws if `maxBytes <= 0`.
- `set(key, blob)` — store/replace a blob under `key`, then evict
  least-recently-used entries until the total is within the cap. The
  just-added entry is never evicted by its own insertion.
- `get(key) => Blob | undefined` — retrieve a blob; a hit promotes the
  entry to most-recently-used.
- `clear()` — drop all entries and release all retained bytes.
- `size` (getter) — number of cached blobs.
- `byteSize` (getter) — total retained bytes.

## Invariants & assumptions

- Insertion order is the recency order (oldest key first). `get` and
  `set` both re-position the touched key to the most-recently-used end.
- Eviction stops while only one entry remains, so a single blob larger
  than the cap still survives long enough for the synchronous read the
  frame-tile subscriber performs immediately after `set`.
- `byteSize` is maintained incrementally from `Blob.size`; it must always
  equal the sum of the cached blobs' sizes.
- Eviction of cold/old blobs is safe for the frame-tile pipeline: the
  wirer ([wire-frame-tile-subscribers.ts](wire-frame-tile-subscribers.ts))
  processes frames tail-first and keeps a `processed` set, so it never
  re-reads a blob after its tile is decoded.

## Examples

```ts
const cache = new FrameBlobCache({ maxBytes: 64 * 1024 * 1024 });
cache.set('frames/frame-000001.jpg', blob);
const same = cache.get('frames/frame-000001.jpg'); // === blob
```

## Tests

- [frame-blob-cache.test.ts](frame-blob-cache.test.ts) — round-trip
  (cache-key contract from review §E), byte/entry accounting, replace,
  LRU eviction on cap overflow, `get`-promotes-recency, never-evict the
  newest entry, `clear`, and the non-positive-cap guard.

## Related

- [main.ts](../main.ts) — constructs the cache (`liveFrameBlobs`,
  64 MiB cap) and clears it on `resetMainState`.
- Step 7 of
  [2026-05-27-collapse-refpoint-and-frame-slices-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md)
  and review §E of
  [2026-05-27-listener-middleware-and-opfs-state-review.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-listener-middleware-and-opfs-state-review.md).
