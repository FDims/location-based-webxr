# base64url.ts

## Purpose

Unpadded base64url (RFC 4648 §5) — the default URL transport for binary
codec output (A2–A5) in the QR payload-compression benchmark (plan §6 P2).
URL-safe: output survives `encodeURIComponent` unchanged, but lowercase
letters and `_` keep the QR encoder in byte mode (8 bits/char) — the
benchmark compares this against the QR-alphanumeric transports
([base45.ts](base45.ts.md), [base32up.ts](base32up.ts.md)).

## Public API

- `encodeBase64Url(bytes: Uint8Array) → string` — unpadded base64url.
- `decodeBase64Url(text: string) → Uint8Array | null` — total + canonical;
  `null` for padding (`=`), `+`/`/` (classic alphabet), impossible lengths
  or non-zero trailing bits. Never throws.

## Invariants & assumptions

Thin wrapper over [bit-alphabet.ts](bit-alphabet.ts.md) — all encoding
invariants (canonicity, totality) live there.

## Examples

```ts
encodeBase64Url(new Uint8Array([0xfb, 0xff])); // '-_8'
decodeBase64Url('Zm9v'); // Uint8Array [0x66,0x6f,0x6f]
decodeBase64Url('Zg=='); // null
```

## Tests

`base64url.test.ts` (RFC 4648 §10 vectors, URL-safe alphabet, rejection
cases); `transport-encoders.property.test.ts` (round-trip, charset,
totality, canonicity).
