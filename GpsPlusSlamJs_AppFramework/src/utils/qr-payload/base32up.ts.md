# base32up.ts

## Purpose

Unpadded uppercase base32 (RFC 4648 §6) — the benchmark's **URL-safe**
QR-alphanumeric transport (plan §4 A6, hypothesis H3). Alphabet `A–Z 2–7`
sits in the intersection of the QR alphanumeric charset (5.5 bits/char) and
the URL-unreserved set, unlike [base45.ts](base45.ts.md) whose ` `/`%`/`+`
need escaping in a URL. Costs 1.6 chars/byte vs base45's 1.5 — the
benchmark quantifies whether URL-safety or density wins.

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
