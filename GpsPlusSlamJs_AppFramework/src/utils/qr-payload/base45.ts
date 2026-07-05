/**
 * Base45 (RFC 9285) — the QR-alphanumeric-mode transport of the payload
 * benchmark (plan §4 A6, hypothesis H3). Its 45-char alphabet IS the QR
 * alphanumeric charset, so base45 output rides at 5.5 bits/char instead of
 * byte mode's 8 — the EU Digital COVID Certificate uses it for exactly this
 * reason. Caveat measured by the benchmark, decided in P5: ' ', '%' and '+'
 * are NOT URL-safe, so inside a query parameter base45 needs escaping that
 * byte-mode transports avoid.
 *
 * Decoding is TOTAL and canonical per RFC 9285 §6: foreign characters,
 * impossible lengths (n % 3 === 1) and out-of-range groups (triplet value
 * > 0xFFFF, pair value > 0xFF) all yield `null`, never a throw.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const REVERSE = new Map<string, number>(
  [...ALPHABET].map((char, index) => [char, index])
);

/** Encode bytes as base45 (RFC 9285): 2 bytes → 3 chars, 1 byte → 2 chars. */
export function encodeBase45(bytes: Uint8Array): string {
  let out = '';
  const pairs = bytes.length - (bytes.length % 2);
  for (let i = 0; i < pairs; i += 2) {
    const value = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
    out += encodeGroup(value, 3);
  }
  if (bytes.length % 2 === 1) {
    out += encodeGroup(bytes[bytes.length - 1] ?? 0, 2);
  }
  return out;
}

/** Little-endian base-45 digits: value = d0 + d1·45 (+ d2·45²). */
function encodeGroup(value: number, chars: 2 | 3): string {
  let out = '';
  let rest = value;
  for (let i = 0; i < chars; i++) {
    out += ALPHABET.charAt(rest % 45);
    rest = Math.floor(rest / 45);
  }
  return out;
}

/** Decode base45. Total: `null` on any malformed input — never throws. */
export function decodeBase45(text: string): Uint8Array | null {
  if (typeof text !== 'string' || text.length % 3 === 1) {
    return null;
  }
  const digits = toDigits(text);
  if (digits === null) {
    return null;
  }
  const out: number[] = [];
  // After the % 3 === 1 guard the tail is always 0 or 2 digits long.
  for (let i = 0; i < digits.length; i += 3) {
    if (!appendDecodedGroup(digits, i, out)) {
      return null;
    }
  }
  return Uint8Array.from(out);
}

/**
 * Decode one digit group starting at `start` into `out`. Returns `false`
 * when the group's value is out of range (RFC 9285 §6 rejection).
 */
function appendDecodedGroup(
  digits: readonly number[],
  start: number,
  out: number[]
): boolean {
  const low = (digits[start] ?? 0) + (digits[start + 1] ?? 0) * 45;
  if (start + 3 <= digits.length) {
    const value = low + (digits[start + 2] ?? 0) * 2025;
    if (value > 0xffff) {
      return false;
    }
    out.push(value >> 8, value & 0xff);
    return true;
  }
  if (low > 0xff) {
    return false;
  }
  out.push(low);
  return true;
}

/** Map every character to its alphabet value, or `null` on a foreign char. */
function toDigits(text: string): number[] | null {
  const digits: number[] = [];
  for (const char of text) {
    const value = REVERSE.get(char);
    if (value === undefined) {
      return null;
    }
    digits.push(value);
  }
  return digits;
}
