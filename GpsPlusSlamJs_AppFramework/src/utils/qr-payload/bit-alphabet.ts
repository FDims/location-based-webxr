/**
 * Shared power-of-two alphabet codec backing `base64url.ts` (6 bits/char)
 * and `base32up.ts` (5 bits/char) of the QR payload-compression benchmark
 * (plan §6 P2). Encodes without padding; decoding is TOTAL and strictly
 * canonical: foreign characters, impossible lengths (a whole character of
 * slack) and non-zero trailing bits all yield `null`, never a throw —
 * printed QR codes deliver malformed input forever, so two spellings of the
 * same bytes must not both decode.
 */

export interface BitAlphabetCodec {
  encode(bytes: Uint8Array): string;
  decode(text: string): Uint8Array | null;
}

/**
 * Build a codec for `alphabet` where each character carries `bitsPerChar`
 * bits (alphabet length must be exactly `2^bitsPerChar`; validated once at
 * construction because a mismatch is a programming error, not bad data).
 */
export function createBitAlphabetCodec(
  alphabet: string,
  bitsPerChar: number
): BitAlphabetCodec {
  if (alphabet.length !== 1 << bitsPerChar) {
    throw new Error(
      `alphabet length ${alphabet.length} does not match ${bitsPerChar} bits/char`
    );
  }
  const reverse = new Map<string, number>();
  for (let i = 0; i < alphabet.length; i++) {
    reverse.set(alphabet.charAt(i), i);
  }
  const mask = (1 << bitsPerChar) - 1;

  function encode(bytes: Uint8Array): string {
    let out = '';
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
      buffer = (buffer << 8) | byte;
      bits += 8;
      while (bits >= bitsPerChar) {
        bits -= bitsPerChar;
        out += alphabet.charAt((buffer >> bits) & mask);
      }
      buffer &= (1 << bits) - 1;
    }
    if (bits > 0) {
      out += alphabet.charAt((buffer << (bitsPerChar - bits)) & mask);
    }
    return out;
  }

  function decode(text: string): Uint8Array | null {
    if (typeof text !== 'string') {
      return null;
    }
    let buffer = 0;
    let bits = 0;
    const out: number[] = [];
    for (const char of text) {
      const value = reverse.get(char);
      if (value === undefined) {
        return null;
      }
      buffer = (buffer << bitsPerChar) | value;
      bits += bitsPerChar;
      if (bits >= 8) {
        bits -= 8;
        out.push((buffer >> bits) & 0xff);
        buffer &= (1 << bits) - 1;
      }
    }
    // Canonical tail: leftover must be less than one character's worth of
    // bits (otherwise the length is impossible) and all-zero padding.
    if (bits >= bitsPerChar || buffer !== 0) {
      return null;
    }
    return Uint8Array.from(out);
  }

  return { encode, decode };
}
