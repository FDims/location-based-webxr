import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { estimateQrSize, type QrEcLevel } from './qr-size-estimator';

/**
 * Property tests for the P1 QR size estimator (benchmark plan §6 P1).
 *
 * Why these tests matter: the benchmark trusts the estimator as its metric,
 * so its structural invariants must hold for ARBITRARY strings, not just the
 * corpus — totality (never throws), shape validity, and the plan-mandated
 * monotonicity ("appending a character never decreases the bit count").
 */

const EC_ARB = fc.constantFrom<QrEcLevel>('L', 'M', 'Q', 'H');

describe('estimateQrSize — properties', () => {
  it('is total and returns a valid shape or null for arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), EC_ARB, (payload, ec) => {
        const estimate = estimateQrSize(payload, ec);
        if (estimate === null) {
          return;
        }
        expect(Number.isInteger(estimate.bits)).toBe(true);
        expect(estimate.bits).toBeGreaterThanOrEqual(0);
        expect(estimate.version).toBeGreaterThanOrEqual(1);
        expect(estimate.version).toBeLessThanOrEqual(25);
        expect(estimate.modules).toBe(17 + 4 * estimate.version);
      })
    );
  });

  it('never decreases bits or version when a character is appended', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 300 }),
        fc.string({ minLength: 1, maxLength: 1 }),
        EC_ARB,
        (payload, extra, ec) => {
          const before = estimateQrSize(payload, ec);
          const after = estimateQrSize(payload + extra, ec);
          // Once a payload no longer fits, no longer payload may fit again.
          const refitsAfterOverflow = before === null && after !== null;
          expect(refitsAfterOverflow).toBe(false);
          if (before === null || after === null) {
            return; // Overflowed the capacity table — nothing more to check.
          }
          expect(after.bits).toBeGreaterThanOrEqual(before.bits);
          expect(after.version).toBeGreaterThanOrEqual(before.version);
        }
      )
    );
  });

  it('costs a payload independently of unrelated EC levels (L ≤ M ≤ Q ≤ H version order)', () => {
    // Why: higher EC eats codewords, so the chosen version must be
    // monotone in EC level for any fixed payload.
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (payload) => {
        const versions = (['L', 'M', 'Q', 'H'] as const).map(
          (ec) =>
            estimateQrSize(payload, ec)?.version ?? Number.POSITIVE_INFINITY
        );
        for (let i = 1; i < versions.length; i++) {
          expect(versions[i]).toBeGreaterThanOrEqual(versions[i - 1] ?? 0);
        }
      })
    );
  });
});
