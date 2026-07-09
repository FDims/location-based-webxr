/**
 * UTF-8 helper tests.
 *
 * Why these tests matter:
 * `utf8DecodeTotal` decodes anchor NAMES out of QR payloads
 * (`codec-binary-anchor.ts`, `codec-dictionary.ts`). The module's contract is
 * "total, never silently mangled" — so encode→decode must be lossless for
 * EVERY valid Unicode string, and invalid byte sequences must yield `null`
 * (not U+FFFD). The BOM case was a real bug (PR #163 review, coderabbit):
 * `TextDecoder`'s default `ignoreBOM: false` silently STRIPPED a leading
 * U+FEFF, so a name starting with a BOM round-tripped to a different string.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { utf8Encode, utf8DecodeTotal } from './utf8';

describe('utf8Encode / utf8DecodeTotal', () => {
  it('round-trips plain and multi-byte text', () => {
    for (const text of ['', 'abc', 'Zürich', '🗼 Tokyo Tower', 'a b']) {
      expect(utf8DecodeTotal(utf8Encode(text))).toBe(text);
    }
  });

  it('preserves a leading U+FEFF (BOM) instead of silently stripping it', () => {
    // Why: with the default ignoreBOM:false, TextDecoder drops a leading
    // UTF-8 BOM — a silent mangle, exactly what this module promises never
    // to do. U+FEFF is a valid Unicode scalar an anchor name may contain.
    expect(utf8DecodeTotal(utf8Encode('\uFEFF'))).toBe('\uFEFF');
    expect(utf8DecodeTotal(utf8Encode('\uFEFFname'))).toBe('\uFEFFname');
  });

  it('returns null for invalid byte sequences (total, no U+FFFD)', () => {
    expect(utf8DecodeTotal(new Uint8Array([0xff]))).toBeNull();
    expect(utf8DecodeTotal(new Uint8Array([0xc0, 0x00]))).toBeNull();
    // Truncated 3-byte sequence (first two bytes of the U+FEFF encoding).
    expect(utf8DecodeTotal(new Uint8Array([0xef, 0xbb]))).toBeNull();
  });

  it('round-trips arbitrary Unicode strings (property)', () => {
    // Why: pins losslessness over the full scalar range — fc's default
    // string arbitrary almost never emits a leading BOM, which is how the
    // BOM bug slipped past the codec property suites.
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        expect(utf8DecodeTotal(utf8Encode(text))).toBe(text);
      })
    );
  });
});
