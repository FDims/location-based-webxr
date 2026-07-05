# base45.ts

## Purpose

Base45 (RFC 9285) for the QR payload-compression benchmark (plan §4 A6,
hypothesis H3): its alphabet IS the 45-char QR alphanumeric charset, so
output rides at 5.5 bits/char instead of byte mode's 8 (the EU Digital
COVID Certificate's trick). **Caveat**: ` `, `%` and `+` are not URL-safe —
inside a query parameter base45 needs percent-escaping that erases its
advantage; the URL-safe alternative is [base32up.ts](base32up.ts.md). The
benchmark treats base45 as the alphanumeric-mode ceiling.

## Public API

- `encodeBase45(bytes: Uint8Array) → string` — 2 bytes → 3 chars
  (little-endian base-45 digits), trailing byte → 2 chars.
- `decodeBase45(text: string) → Uint8Array | null` — total + canonical per
  RFC 9285 §6: `null` for foreign chars, `length % 3 === 1`, triplet values
  > 0xFFFF or pair values > 0xFF. Never throws.

## Invariants & assumptions

- Canonicity holds because out-of-range groups are rejected — every
  decodable string re-encodes to itself (property-tested).
- Big-endian byte pairing (`n = b0·256 + b1`), little-endian digit order —
  exactly RFC 9285 §4.

## Examples

```ts
encodeBase45(new TextEncoder().encode('AB')); // 'BB8'
decodeBase45('QED8WEX0'); // bytes of 'ietf!'
decodeBase45('GGW'); // null — 65536 > 0xFFFF
```

## Tests

`base45.test.ts` (RFC 9285 §4 vectors + §6 rejection traps);
`transport-encoders.property.test.ts` (round-trip, QR-alnum charset,
totality, canonicity).
