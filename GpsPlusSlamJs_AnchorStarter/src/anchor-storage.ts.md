# `anchor-storage.ts` — inline anchor persistence

## Purpose

Persist a *single* GPS anchor to `localStorage` so it survives a page
reload — the payoff of the starter example's umbrella user story. Decision
D2 (option B1) keeps this inline in the example (no framework helper) so the
whole save/load story is readable in one small file.

## Public API

- `STORAGE_KEY` — the `localStorage` key.
- `saveAnchor(anchor, store?)` — persist a `LatLong | LatLongAlt`. Never
  throws; quota / private-mode failures are swallowed.
- `loadAnchor(store?): LatLongAlt | null` — load the cached anchor or `null`
  when there is none or the value is unusable.
- `clearAnchor(store?)` — remove the cached anchor (back to cache-miss).
- `AnchorStore` — minimal injectable `getItem`/`setItem`/`removeItem` surface
  (a structural subset of DOM `Storage`); defaults to `globalThis.localStorage`.

## Invariants & assumptions

- **Defensive load:** malformed JSON, non-object payloads, missing /
  non-numeric / out-of-range (`lat ∉ [-90,90]`, `lon ∉ [-180,180]`) or
  non-finite coordinates all resolve to `null` (the cache-miss branch),
  never a throw. A non-finite `altitude` is dropped while a valid lat/lon is
  kept.
- **Defensive save:** a throwing/unavailable store is swallowed; the demo
  surfaces the failure through its normal save-failure path.
- Storage is injectable so the module is testable in Node without jsdom.

## Examples

```ts
saveAnchor({ lat: 48.137, lon: 11.575, altitude: 519 });
const cached = loadAnchor(); // → { lat: 48.137, lon: 11.575, altitude: 519 } | null
```

## Tests

- [anchor-storage.test.ts](./anchor-storage.test.ts) — round-trip (incl.
  altitude), `clearAnchor`, and the full defensive-load / defensive-save
  matrix using an in-memory `AnchorStore`.
