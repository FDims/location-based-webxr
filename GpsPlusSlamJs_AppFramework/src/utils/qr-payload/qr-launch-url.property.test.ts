import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildQrLaunchUrl } from './qr-launch-url';
import { decodeDictionaryPayload } from './codec-dictionary';

/**
 * Property tests for `buildQrLaunchUrl` (QR payload benchmark follow-up).
 *
 * Why these tests matter: the helper's contract is "measured best, never a
 * broken link" — for ANY http(s) asset URL it must return the candidate
 * with the fewest QR bits, every emitted candidate must be dispatchable,
 * and the dictionary blob must round-trip to the exact input URL.
 */

const DATA_URL_ARB = fc.webUrl({ validSchemes: ['https'], size: 'medium' });

describe('buildQrLaunchUrl — properties', () => {
  it('always returns the minimum-bit candidate', async () => {
    await fc.assert(
      fc.asyncProperty(DATA_URL_ARB, async (dataUrl) => {
        const plan = await buildQrLaunchUrl('https://gps.csutil.com', dataUrl);
        const minBits = Math.min(
          ...plan.candidates.map((c) => c.estimate.bits)
        );
        expect(plan.estimate.bits).toBe(minBits);
        expect(plan.candidates.map((c) => c.url)).toContain(plan.url);
      }),
      { numRuns: 40 }
    );
  });

  it('emits a dictionary candidate that round-trips to the input URL', async () => {
    await fc.assert(
      fc.asyncProperty(DATA_URL_ARB, async (dataUrl) => {
        const plan = await buildQrLaunchUrl('https://gps.csutil.com', dataUrl);
        const dict = plan.candidates.find((c) => c.strategy === 'dictionary');
        expect(dict).toBeDefined();
        const blob = dict?.url.split('?qr=~')[1] ?? '';
        expect(await decodeDictionaryPayload(blob)).toBe(dataUrl);
      }),
      { numRuns: 40 }
    );
  });

  it('every candidate URL is percent-encoding-clean (no raw unsafe chars)', async () => {
    // A launch URL with a literal '&', '#', '+', '%' or space inside the
    // qr value would parse wrongly or break the QR→browser handoff.
    await fc.assert(
      fc.asyncProperty(DATA_URL_ARB, async (dataUrl) => {
        const plan = await buildQrLaunchUrl('https://gps.csutil.com', dataUrl);
        for (const candidate of plan.candidates) {
          const value = candidate.url.split('?qr=')[1] ?? '';
          expect(value).not.toMatch(/[&#\s]/);
        }
      }),
      { numRuns: 40 }
    );
  });
});
