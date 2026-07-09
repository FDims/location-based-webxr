# bit-alphabet.ts

## Purpose

Shared power-of-two alphabet codec backing [base64url.ts](base64url.ts.md)
(6 bits/char) and [base32up.ts](base32up.ts.md) (5 bits/char) in the QR
payload-compression benchmark (plan §6 P2). One bit-accumulator
implementation instead of two near-identical copies.

## Public API

- `createBitAlphabetCodec(alphabet: string, bitsPerChar: number) → BitAlphabetCodec`
  - Throws `Error` at construction when `alphabet.length !== 2^bitsPerChar`
    (programming error, not runtime data).
  - `encode(bytes: Uint8Array) → string` — unpadded, most-significant-bit
    first, final partial character zero-padded low.
  - `decode(text: string) → Uint8Array | null` — **total and canonical**:
    `null` for foreign characters (including `=` padding), impossible
    lengths (a whole character of slack, e.g. base64 `len % 4 === 1`), and
    non-zero trailing bits. Never throws.

## Invariants & assumptions

- Canonicity: for every decodable string `s`, `encode(decode(s)) === s` —
  printed QR payloads must not have two spellings of the same bytes
  (property-tested).
- The bit buffer is masked after every step, so values never approach
  2^31 regardless of input length.

## Examples

```ts
const b64 = createBitAlphabetCodec('ABC…yz0123456789-_', 6);
b64.encode(new Uint8Array([0x66])); // 'Zg'
b64.decode('Zg=='); // null — padding is foreign
```

## Tests

Covered through its consumers: `base64url.test.ts`, `base32up.test.ts`
(RFC 4648 vectors + malformed-input rejections) and
`transport-encoders.property.test.ts` (round-trip, charset, totality,
canonicity properties).
