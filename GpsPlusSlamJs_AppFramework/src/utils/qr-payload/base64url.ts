/**
 * Unpadded base64url (RFC 4648 §5) over the shared bit-alphabet codec —
 * the default URL transport for binary codec output in the QR
 * payload-compression benchmark (plan §6 P2). The URL-safe alphabet
 * survives `encodeURIComponent` unchanged, so it adds zero percent-escaping
 * overhead inside a query parameter; note that '_' and lowercase letters
 * force QR byte mode (8 bits/char) — see `qr-size-estimator.ts`.
 */

import { createBitAlphabetCodec } from './bit-alphabet';

const CODEC = createBitAlphabetCodec(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  6
);

/** Encode bytes as unpadded base64url. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return CODEC.encode(bytes);
}

/**
 * Decode unpadded base64url. Total: `null` for padding, foreign characters,
 * impossible lengths or non-canonical trailing bits — never throws.
 */
export function decodeBase64Url(text: string): Uint8Array | null {
  return CODEC.decode(text);
}
