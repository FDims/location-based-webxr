# compression.ts

## Purpose

Thin `CompressionStream`/`DecompressionStream` byte helpers for the QR
payload codecs — after the P5 pruning consumed only by the
[codec-dictionary.ts](codec-dictionary.ts.md) A4+A2 chain and the
benchmark's `/S/<BASE32>` path candidates (benchmark plan §6 P3/P5).

## Public API

- `compressBytes(bytes: Uint8Array, format: CompressionFormat) → Promise<Uint8Array>`
  — rejects only on programming errors (unknown format).
- `decompressBytes(bytes: Uint8Array, format: CompressionFormat) → Promise<Uint8Array | null>`
  — **total** over byte input: corrupt streams yield `null`, never a throw.

## Invariants & assumptions

- Runtime floor: browsers Safari 16.4 / Chrome 103 (for `deflate-raw`) /
  Firefox 113; Node ≥ 21.2 for `'deflate-raw'` — hence the package's
  `engines: >=22` (benchmark decision D3). Older-Safari fallback is an open
  P5 topic (plan §8).
- Implementation routes through `Blob → stream → Response` so the same code
  runs in browsers and Node without `node:zlib`.

## Examples

```ts
const packed = await compressBytes(
  new TextEncoder().encode('…'),
  'deflate-raw'
);
const bytes = await decompressBytes(packed, 'deflate-raw'); // Uint8Array
await decompressBytes(new Uint8Array([1, 2, 3]), 'deflate-raw'); // null
```

## Tests

Covered through the codec suites: `codec-dictionary.test.ts` (A4+A2 chain
round-trips, corrupt-stream nulls) and `codecs.property.test.ts`.
