import { describe, expect, it } from 'vitest';
import { decodeBase32Up, encodeBase32Up } from './base32up';

/**
 * P2 of the QR payload-compression benchmark plan: uppercase RFC 4648
 * base32 is the URL-SAFE alphanumeric-mode candidate — unlike base45, its
 * alphabet (A–Z, 2–7) needs no percent-escaping in a query string while
 * still qualifying for the 5.5-bit QR alphanumeric mode (hypothesis H3).
 * Vectors are RFC 4648 §10 with padding stripped.
 */
describe('base32up', () => {
  const VECTORS: readonly [string, string][] = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];

  it('matches the RFC 4648 test vectors (unpadded)', () => {
    for (const [plain, encoded] of VECTORS) {
      const bytes = new TextEncoder().encode(plain);
      expect(encodeBase32Up(bytes)).toBe(encoded);
      expect(decodeBase32Up(encoded)).toEqual(bytes);
    }
  });

  it('rejects padding, impossible lengths, foreign chars and non-canonical bits', () => {
    expect(decodeBase32Up('MY======')).toBeNull(); // padding is not part of the format
    expect(decodeBase32Up('M')).toBeNull(); // length % 8 === 1 is impossible
    expect(decodeBase32Up('MZX')).toBeNull(); // length % 8 === 3 is impossible
    expect(decodeBase32Up('my')).toBeNull(); // strict uppercase only
    expect(decodeBase32Up('M1')).toBeNull(); // '1' is not in the RFC 4648 alphabet
    expect(decodeBase32Up('MZ')).toBeNull(); // non-zero trailing bits
  });
});
