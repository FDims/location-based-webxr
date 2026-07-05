import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodeBase64Url, encodeBase64Url } from './base64url';
import { decodeBase45, encodeBase45 } from './base45';
import { decodeBase32Up, encodeBase32Up } from './base32up';
import { QR_ALPHANUMERIC_CHARSET } from './qr-size-estimator';

/**
 * P2 property tests (benchmark plan §6 P2): every transport encoder must
 * round-trip arbitrary bytes, emit only its promised charset (that promise
 * is what the whole QR-mode analysis of §3 rests on), and decode totally.
 */

interface TransportEncoder {
  name: string;
  encode: (bytes: Uint8Array) => string;
  decode: (text: string) => Uint8Array | null;
  /** Every char the encoder may emit must satisfy this predicate. */
  charOk: (char: string) => boolean;
}

const ENCODERS: readonly TransportEncoder[] = [
  {
    name: 'base64url',
    encode: encodeBase64Url,
    decode: decodeBase64Url,
    // URL-safe: survives encodeURIComponent unchanged.
    charOk: (c) => /[A-Za-z0-9_-]/.test(c),
  },
  {
    name: 'base45',
    encode: encodeBase45,
    decode: decodeBase45,
    // The QR alphanumeric charset IS the base45 alphabet (RFC 9285 §4.2).
    charOk: (c) => QR_ALPHANUMERIC_CHARSET.includes(c),
  },
  {
    name: 'base32up',
    encode: encodeBase32Up,
    decode: decodeBase32Up,
    // Both QR-alphanumeric AND URL-safe — the intersection matters for H3.
    charOk: (c) => /[A-Z2-7]/.test(c),
  },
];

describe.each(ENCODERS)('$name — properties', ({ encode, decode, charOk }) => {
  it('round-trips arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        expect(decode(encode(bytes))).toEqual(bytes);
      })
    );
  });

  it('emits only its promised charset', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        const encoded = encode(bytes);
        expect([...encoded].every(charOk)).toBe(true);
      })
    );
  });

  it('decodes arbitrary strings totally (null or bytes, never a throw)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 128 }), (text) => {
        const decoded = decode(text);
        expect(decoded === null || decoded instanceof Uint8Array).toBe(true);
      })
    );
  });

  it('is canonical: decodable strings re-encode to themselves', () => {
    // Why: printed QR codes live forever — two spellings of the same bytes
    // would make payload equality checks unreliable.
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (text) => {
        const decoded = decode(text);
        const canonical = decoded === null || encode(decoded) === text;
        expect(canonical).toBe(true);
      })
    );
  });
});
