/**
 * Inline anchor persistence for the starter example.
 *
 * Decision D2 (option B1) keeps persistence *inline in the example* — no
 * framework surface is added — so a new developer can read the entire save/load
 * story in one small file and swap `localStorage` for their own backend by
 * editing one place. It mirrors the validate-and-clamp discipline of the
 * framework's `recording-options.ts` precedent.
 *
 */

import type { LatLong, LatLongAlt } from 'gps-plus-slam-app-framework/core';

/** localStorage key under which the single starter anchor is cached. */
export const STORAGE_KEY = 'gps-plus-slam-anchor-starter:anchor';

/**
 * The minimal storage surface this module needs — a structural subset of the
 * DOM `Storage` interface. Injecting it keeps the module testable in Node
 * (no jsdom) and lets a new developer point it at any key/value store.
 */
export interface AnchorStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Resolve the default browser store, or `null` when `localStorage` is
 * unavailable (SSR, sandboxed iframe, privacy mode). Callers fall back to a
 * no-op so the demo never crashes for lack of storage.
 */
function defaultStore(): AnchorStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing localStorage can throw in some sandboxed contexts.
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Persist a single GPS anchor. Never throws — a failing/unavailable store is
 * swallowed (the worst case is that persistence silently does not happen,
 * which the demo surfaces via the normal save-failure path).
 */
export function saveAnchor(
  anchor: LatLong | LatLongAlt,
  store: AnchorStore | null = defaultStore()
): void {
  if (!store) return;
  const payload: LatLongAlt = { lat: anchor.lat, lon: anchor.lon };
  if ('altitude' in anchor && isFiniteNumber(anchor.altitude)) {
    payload.altitude = anchor.altitude;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private-mode failures must not crash the placement flow.
  }
}

/**
 * Load the cached anchor, or `null` when there is none or the stored value is
 * unusable. Any malformed / out-of-range payload is treated as "no cached
 * anchor" (the cache-miss branch) rather than thrown — this is what makes the
 * setup state machine's branch selection robust.
 */
export function loadAnchor(
  store: AnchorStore | null = defaultStore()
): LatLongAlt | null {
  if (!store) return null;
  const raw = store.getItem(STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { lat, lon, altitude } = parsed as Record<string, unknown>;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const result: LatLongAlt = { lat, lon };
  if (isFiniteNumber(altitude)) result.altitude = altitude;
  return result;
}

/** Remove the cached anchor (returns the demo to the cache-miss branch). */
export function clearAnchor(store: AnchorStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — clearing is best-effort.
  }
}
