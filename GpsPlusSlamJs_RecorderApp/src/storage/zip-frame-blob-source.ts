/**
 * Frame blob source for replay mode — F3.5a of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 *
 * Wraps a recording-zip `Uint8Array` and returns a lookup function
 * compatible with `wireFrameTileSubscribers`'s `blobSource` slot.
 * On creation it reads the central directory once and indexes every
 * entry by its filename, so each subsequent lookup is O(1) + the
 * cost of decompressing that single entry.
 *
 * Returns `null` for unknown paths so the wirer's defensive branch
 * can skip the frame without throwing.
 */

import {
  BlobWriter,
  type Entry,
  Uint8ArrayReader,
  ZipReader,
} from '@zip.js/zip.js';

export type FrameBlobSource = (imageFile: string) => Promise<Blob | null>;

/**
 * Build a frame blob source backed by the given recording zip bytes.
 * Reads the zip's central directory once; the returned lookup
 * function holds a reference to the entry index for the lifetime of
 * the replay session.
 */
export async function createZipFrameBlobSource(
  zipData: Uint8Array
): Promise<FrameBlobSource> {
  const reader = new ZipReader(new Uint8ArrayReader(zipData));
  const entries = await reader.getEntries();
  const byPath = new Map<string, Entry>();
  for (const entry of entries) {
    if (entry.directory) continue;
    byPath.set(entry.filename, entry);
  }

  return async (imageFile: string): Promise<Blob | null> => {
    const entry = byPath.get(imageFile);
    if (!entry || entry.directory) return null;
    return entry.getData(new BlobWriter('image/jpeg'));
  };
}
