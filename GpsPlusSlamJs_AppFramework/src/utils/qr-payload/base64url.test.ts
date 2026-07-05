import { describe, expect, it } from 'vitest';
import { decodeBase64Url, encodeBase64Url } from './base64url';

/**
 * P2 of the QR payload-compression benchmark plan: base64url is the default
 * URL transport for binary codec output (A2–A5). Vectors are RFC 4648 §10
 * with padding stripped; decode must be total (null, never throw).
 */
describe('base64url', () => {
  const VECTORS: readonly [string, string][] = [
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ];

  it('matches the RFC 4648 test vectors (unpadded)', () => {
    for (const [plain, encoded] of VECTORS) {
      const bytes = new TextEncoder().encode(plain);
      expect(encodeBase64Url(bytes)).toBe(encoded);
      expect(decodeBase64Url(encoded)).toEqual(bytes);
    }
  });

  // Why this test matters: the URL-safe alphabet ('-' and '_', not '+'/'/')
  // is the whole point — a '+' or '/' would need percent-escaping in a query
  // string and inflate the QR payload.
  it('uses the URL-safe alphabet for high-value bytes', () => {
    expect(encodeBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });

  it('rejects padding, invalid lengths, foreign chars and non-canonical bits', () => {
    expect(decodeBase64Url('Zg==')).toBeNull(); // padding is not part of the format
    expect(decodeBase64Url('Z')).toBeNull(); // length % 4 === 1 is impossible
    expect(decodeBase64Url('Zm+8')).toBeNull(); // '+' is the non-URL-safe alphabet
    expect(decodeBase64Url('Zh')).toBeNull(); // non-zero trailing bits
    expect(decodeBase64Url('Z g')).toBeNull(); // whitespace is not tolerated
  });
});
