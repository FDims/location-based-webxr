/**
 * Unit tests for the inline anchor persistence (anchor-storage.ts).
 *
 * Why this test matters: persistence is the umbrella user story's payoff —
 * the anchor must survive a page reload. Decision D2 keeps this inline in the
 * example (no framework helper), but it still gets a focused test:
 *  - a round-trip preserves the coordinate (incl. optional altitude);
 *  - bad / empty / out-of-range JSON is treated as "no cached anchor"
 *    (the cache-miss branch), never a throw.
 */

import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEY,
  saveAnchor,
  loadAnchor,
  clearAnchor,
  type AnchorStore,
} from './anchor-storage.js';

/** Minimal in-memory `AnchorStore` so tests need no jsdom/localStorage. */
function memoryStore(seed?: Record<string, string>): AnchorStore {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('anchor-storage round-trip', () => {
  it('saves and loads a lat/lon anchor', () => {
    const store = memoryStore();
    saveAnchor({ lat: 48.137, lon: 11.575 }, store);
    expect(loadAnchor(store)).toEqual({ lat: 48.137, lon: 11.575 });
  });

  it('preserves an optional altitude', () => {
    const store = memoryStore();
    saveAnchor({ lat: 48.137, lon: 11.575, altitude: 519.2 }, store);
    expect(loadAnchor(store)).toEqual({
      lat: 48.137,
      lon: 11.575,
      altitude: 519.2,
    });
  });

  it('clearAnchor removes the cached anchor (back to cache-miss)', () => {
    const store = memoryStore();
    saveAnchor({ lat: 1, lon: 2 }, store);
    clearAnchor(store);
    expect(loadAnchor(store)).toBeNull();
  });
});

describe('anchor-storage — load is defensive', () => {
  it('returns null when nothing is stored (cache-miss)', () => {
    expect(loadAnchor(memoryStore())).toBeNull();
  });

  it('returns null on malformed JSON instead of throwing', () => {
    expect(loadAnchor(memoryStore({ [STORAGE_KEY]: '{not json' }))).toBeNull();
  });

  it('returns null when JSON is not an object', () => {
    expect(loadAnchor(memoryStore({ [STORAGE_KEY]: '42' }))).toBeNull();
    expect(loadAnchor(memoryStore({ [STORAGE_KEY]: 'null' }))).toBeNull();
  });

  it('returns null when lat/lon are missing or non-numeric', () => {
    expect(loadAnchor(memoryStore({ [STORAGE_KEY]: '{"lat":48}' }))).toBeNull();
    expect(
      loadAnchor(memoryStore({ [STORAGE_KEY]: '{"lat":"x","lon":1}' }))
    ).toBeNull();
  });

  it('returns null when lat/lon are out of geographic range', () => {
    expect(
      loadAnchor(memoryStore({ [STORAGE_KEY]: '{"lat":120,"lon":11}' }))
    ).toBeNull();
    expect(
      loadAnchor(memoryStore({ [STORAGE_KEY]: '{"lat":48,"lon":999}' }))
    ).toBeNull();
  });

  it('returns null for non-finite coordinates', () => {
    expect(
      loadAnchor(memoryStore({ [STORAGE_KEY]: '{"lat":null,"lon":1}' }))
    ).toBeNull();
  });

  it('drops a non-finite altitude but keeps a valid lat/lon', () => {
    const loaded = loadAnchor(
      memoryStore({ [STORAGE_KEY]: '{"lat":48,"lon":11,"altitude":"high"}' })
    );
    expect(loaded).toEqual({ lat: 48, lon: 11 });
  });
});

describe('anchor-storage — save is defensive', () => {
  it('does not throw when the underlying store throws (e.g. quota / private mode)', () => {
    const throwing: AnchorStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(() => saveAnchor({ lat: 1, lon: 2 }, throwing)).not.toThrow();
  });
});
