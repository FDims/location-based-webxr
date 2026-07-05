# base32up.ts

## Purpose

Unpadded uppercase base32 (RFC 4648 §6) — the benchmark's **URL-safe**
QR-alphanumeric transport (plan §4 A6, hypothesis H3), carrier of the
winning `/S/<BASE32>` path form. Alphabet `A–Z 2–7` sits in the
intersection of the QR alphanumeric charset (5.5 bits/char) and the
URL-unreserved set. base45 (RFC 9285, 1.5 chars/byte vs base32's 1.6) was
benchmarked too but pruned in P5: its ` `/`%`/`+` are not URL-safe and the
density edge was only ~5 % of QR bits — see the 2026-07-05 benchmark
results doc in `GpsPlusSlamJs_Docs`.

## Public API

- `encodeBase32Up(bytes: Uint8Array) → string` — unpadded uppercase base32.
- `decodeBase32Up(text: string) → Uint8Array | null` — total + canonical;
  `null` for padding, lowercase/foreign chars, impossible lengths or
  non-zero trailing bits. Never throws (strictly uppercase by design — the
  wire format is machine-generated, so no case tolerance).

## Invariants & assumptions

Thin wrapper over [bit-alphabet.ts](bit-alphabet.ts.md) — all encoding
invariants (canonicity, totality) live there.

## Examples

```ts
encodeBase32Up(new TextEncoder().encode('foobar')); // 'MZXW6YTBOI'
decodeBase32Up('MY======'); // null — padding is foreign
```

## Tests

`base32up.test.ts` (RFC 4648 §10 vectors + rejection cases);
`transport-encoders.property.test.ts` (round-trip, `A–Z2–7` charset,
totality, canonicity).
