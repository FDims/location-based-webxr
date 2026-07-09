/**
 * Unpadded uppercase base32 (RFC 4648 §6) over the shared bit-alphabet
 * codec — the benchmark's URL-safe QR-alphanumeric transport (plan §4 A6,
 * hypothesis H3): its alphabet A–Z 2–7 lies in BOTH the QR alphanumeric
 * charset (5.5 bits/char instead of 8) and the URL-unreserved set, unlike
 * base45 whose ' ', '%' and '+' need escaping inside a URL.
 */

import { createBitAlphabetCodec } from './bit-alphabet';

const CODEC = createBitAlphabetCodec('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 5);

/** Encode bytes as unpadded uppercase base32. */
export function encodeBase32Up(bytes: Uint8Array): string {
  return CODEC.encode(bytes);
}

/**
 * Decode unpadded uppercase base32. Total: `null` for padding, lowercase or
 * other foreign characters, impossible lengths or non-canonical trailing
 * bits — never throws.
 */
export function decodeBase32Up(text: string): Uint8Array | null {
  return CODEC.decode(text);
}
