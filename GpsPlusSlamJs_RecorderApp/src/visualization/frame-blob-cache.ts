/**
 * `FrameBlobCache` — an LRU, byte-capped cache for captured frame JPEG
 * blobs held in memory during a live recording session.
 *
 * Background — Step 7 of the
 * [2026-05-27 slice-collapse plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md)
 * and review §E: `main.ts` previously kept every captured frame blob in
 * a plain `Map` that was only emptied on `resetMainState`. Long outdoor
 * sessions accumulated all JPEG bytes in RAM. This cache bounds that
 * growth by evicting the least-recently-used entries once a configurable
 * byte cap is exceeded.
 *
 * Eviction is safe for the frame-tile pipeline because the wirer
 * processes frames tail-first and never re-reads a blob once its tile is
 * decoded (it keeps a `processed` set), so cold/old blobs are no longer
 * needed. The cache additionally guarantees the most-recently-added
 * entry is never evicted by its own insertion, because the frame-tile
 * subscriber reads it synchronously right after `set`.
 */

export interface FrameBlobCacheOptions {
  /**
   * Maximum total bytes to retain. When a `set` pushes the total over
   * this cap, least-recently-used entries are evicted oldest-first until
   * the total is back under the cap (or only the newest entry remains).
   * Must be a positive number.
   */
  readonly maxBytes: number;
}

export class FrameBlobCache {
  /** Insertion-ordered map; first key is least-recently-used. */
  private readonly entries = new Map<string, Blob>();
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(options: FrameBlobCacheOptions) {
    if (!(options.maxBytes > 0)) {
      throw new Error(
        `FrameBlobCache: maxBytes must be a positive number, got ${String(
          options.maxBytes
        )}`
      );
    }
    this.maxBytes = options.maxBytes;
  }

  /** Number of cached blobs. */
  get size(): number {
    return this.entries.size;
  }

  /** Total bytes currently retained across all cached blobs. */
  get byteSize(): number {
    return this.totalBytes;
  }

  /**
   * Store a blob under `key`, replacing any existing entry, then evict
   * least-recently-used entries until the total byte size is within the
   * cap. The just-added entry is never evicted by this call.
   */
  set(key: string, blob: Blob): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      this.totalBytes -= existing.size;
      this.entries.delete(key);
    }
    this.entries.set(key, blob);
    this.totalBytes += blob.size;
    this.evictToCap();
  }

  /**
   * Return the blob stored under `key`, or `undefined` if absent.
   * A hit promotes the entry to most-recently-used.
   */
  get(key: string): Blob | undefined {
    const blob = this.entries.get(key);
    if (blob === undefined) return undefined;
    // Re-insert to move to the most-recently-used position.
    this.entries.delete(key);
    this.entries.set(key, blob);
    return blob;
  }

  /** Drop all entries and release all retained bytes. */
  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  /**
   * Evict from the least-recently-used end until under the cap. Stops
   * before evicting the single most-recently-added entry so a frame that
   * alone exceeds the cap still survives for its synchronous read.
   */
  private evictToCap(): void {
    while (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest !== undefined) this.totalBytes -= oldest.size;
    }
  }
}
