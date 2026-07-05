import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from './base45';

/**
 * P2 of the QR payload-compression benchmark plan: base45 (RFC 9285) targets
 * the QR alphanumeric mode (5.5 bits/char instead of 8) — the EU Digital
 * COVID Certificate uses it for exactly this reason (hypothesis H3).
 * Vectors are straight from RFC 9285 §4.
 */
describe('base45', () => {
  const VECTORS: readonly [string, string][] = [
    ['AB', 'BB8'],
    ['Hello!!', '%69 VD92EX0'],
    ['base-45', 'UJCLQE7W581'],
    ['ietf!', 'QED8WEX0'],
  ];

  it('matches the RFC 9285 test vectors', () => {
    for (const [plain, encoded] of VECTORS) {
      const bytes = new TextEncoder().encode(plain);
      expect(encodeBase45(bytes)).toBe(encoded);
      expect(decodeBase45(encoded)).toEqual(bytes);
    }
  });

  it('encodes the empty input to the empty string', () => {
    expect(encodeBase45(new Uint8Array())).toBe('');
    expect(decodeBase45('')).toEqual(new Uint8Array());
  });

  // Why this test matters: RFC 9285 §6 calls out exactly these decoder
  // traps — triplets above 0xFFFF and impossible lengths MUST be rejected,
  // and a printed QR code will happily deliver corrupted input forever.
  it('rejects impossible lengths, foreign chars and overflowing triplets', () => {
    expect(decodeBase45('A')).toBeNull(); // length % 3 === 1 is impossible
    expect(decodeBase45('ab8')).toBeNull(); // lowercase is not in the charset
    expect(decodeBase45('GGW')).toBeNull(); // 16+16·45+32·2025 = 65536 > 0xFFFF
    expect(decodeBase45(':::')).toBeNull(); // 44+44·45+44·2025 overflows too
    expect(decodeBase45('Z:')).toBeNull(); // 35+44·45 = 2015 > 0xFF for a pair
  });
});
