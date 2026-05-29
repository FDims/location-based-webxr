/**
 * Tests for {@link FrameBlobCache} — Step 7 of the 2026-05-27
 * slice-collapse plan (LRU + memory cap on the live frame-blob cache).
 *
 * Why this matters: before this cache existed, `main.ts` held captured
 * frame blobs in a plain `Map` that was only ever emptied on
 * `resetMainState`. The multi-hour outdoor sessions the project targets
 * would accumulate every JPEG in RAM (review §E). These tests pin the
 * eviction contract that bounds memory growth, plus the cache-key
 * round-trip contract the review §E asked for (set → get resolves the
 * same blob).
 */

import { describe, expect, it } from 'vitest';

import { FrameBlobCache } from './frame-blob-cache';

/** Build a Blob of an exact byte size for deterministic byte-cap tests. */
function blobOfBytes(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
}

describe('FrameBlobCache', () => {
  // Why: the core round-trip contract — a blob stored under a key must
  // be retrievable under the same key (the cache-key contract test the
  // review §E flagged as missing).
  it('returns the same blob that was stored under a key', () => {
    const cache = new FrameBlobCache({ maxBytes: 1_000_000 });
    const blob = blobOfBytes(100);
    cache.set('frames/frame-000001.jpg', blob);
    expect(cache.get('frames/frame-000001.jpg')).toBe(blob);
  });

  // Why: a miss must be observable so the wirer's `?? null` fallback works.
  it('returns undefined for an unknown key', () => {
    const cache = new FrameBlobCache({ maxBytes: 1_000_000 });
    expect(cache.get('frames/missing.jpg')).toBeUndefined();
  });

  // Why: byteSize/size must track stored content so callers (and tests)
  // can reason about memory pressure.
  it('tracks entry count and total byte size', () => {
    const cache = new FrameBlobCache({ maxBytes: 1_000_000 });
    cache.set('a', blobOfBytes(100));
    cache.set('b', blobOfBytes(250));
    expect(cache.size).toBe(2);
    expect(cache.byteSize).toBe(350);
  });

  // Why: re-setting the same key must replace (not double-count) the blob.
  it('replaces an existing key and adjusts byteSize accordingly', () => {
    const cache = new FrameBlobCache({ maxBytes: 1_000_000 });
    cache.set('a', blobOfBytes(100));
    cache.set('a', blobOfBytes(400));
    expect(cache.size).toBe(1);
    expect(cache.byteSize).toBe(400);
    expect(cache.get('a')?.size).toBe(400);
  });

  // Why: the central memory bound — once total bytes exceed the cap, the
  // least-recently-used entries are evicted oldest-first until under cap.
  it('evicts least-recently-used entries when the byte cap is exceeded', () => {
    const cache = new FrameBlobCache({ maxBytes: 300 });
    cache.set('a', blobOfBytes(100)); // total 100
    cache.set('b', blobOfBytes(100)); // total 200
    cache.set('c', blobOfBytes(100)); // total 300
    cache.set('d', blobOfBytes(100)); // total 400 → evict 'a' → 300
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')?.size).toBe(100);
    expect(cache.get('c')?.size).toBe(100);
    expect(cache.get('d')?.size).toBe(100);
    expect(cache.byteSize).toBe(300);
  });

  // Why: `get` must mark an entry as most-recently-used so a frequently
  // read frame is not evicted before colder ones.
  it('promotes a key on get so it survives eviction longer', () => {
    const cache = new FrameBlobCache({ maxBytes: 300 });
    cache.set('a', blobOfBytes(100));
    cache.set('b', blobOfBytes(100));
    cache.set('c', blobOfBytes(100));
    // Touch 'a' so it becomes most-recently-used; 'b' is now coldest.
    cache.get('a');
    cache.set('d', blobOfBytes(100)); // over cap → evict coldest 'b'
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')?.size).toBe(100);
    expect(cache.get('c')?.size).toBe(100);
    expect(cache.get('d')?.size).toBe(100);
  });

  // Why: the just-added blob is read synchronously by the frame-tile
  // subscriber immediately after `set`, so it must never be evicted by
  // its own insertion — even when it alone exceeds the cap.
  it('never evicts the most-recently-added entry even if it exceeds the cap', () => {
    const cache = new FrameBlobCache({ maxBytes: 300 });
    cache.set('a', blobOfBytes(100));
    cache.set('big', blobOfBytes(5000)); // alone exceeds the cap
    expect(cache.get('big')?.size).toBe(5000);
    // The older, now-cold entry is evicted to reclaim what space it can.
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  // Why: clear() must release all retained bytes (called on resetMainState).
  it('clears all entries and resets byteSize', () => {
    const cache = new FrameBlobCache({ maxBytes: 1_000_000 });
    cache.set('a', blobOfBytes(100));
    cache.set('b', blobOfBytes(100));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.byteSize).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  // Why: an invalid cap is a programming error; fail fast rather than
  // silently retain everything (defensive boundary per AGENTS.md).
  it('throws when constructed with a non-positive maxBytes', () => {
    expect(() => new FrameBlobCache({ maxBytes: 0 })).toThrow();
    expect(() => new FrameBlobCache({ maxBytes: -1 })).toThrow();
  });
});
