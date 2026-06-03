/**
 * Tests for the promoted capability-gating helpers (framework `ar/`).
 *
 * Why this matters: the minimal AR example and AnchorStarter both gate on
 * "WebXR + geolocation available" and show an honest message instead of a
 * crash on unsupported devices. These tests pin that the decision is correct,
 * the message names exactly what is missing, and the app-specific
 * `contextLabel` is appended only when supplied — so the neutral core can be
 * shared without sharing copy (§6.4).
 */

import { describe, it, expect } from 'vitest';
import { isFullySupported, capabilityMessage } from './capability-checker';

describe('isFullySupported', () => {
  it('is true only when both WebXR and geolocation are available', () => {
    expect(isFullySupported({ webxr: true, geolocation: true })).toBe(true);
    expect(isFullySupported({ webxr: true, geolocation: false })).toBe(false);
    expect(isFullySupported({ webxr: false, geolocation: true })).toBe(false);
    expect(isFullySupported({ webxr: false, geolocation: false })).toBe(false);
  });
});

describe('capabilityMessage', () => {
  it('returns null when everything is supported', () => {
    expect(capabilityMessage({ webxr: true, geolocation: true })).toBeNull();
    expect(
      capabilityMessage(
        { webxr: true, geolocation: true },
        { contextLabel: 'the demo' }
      )
    ).toBeNull();
  });

  it('names WebXR when only AR is missing', () => {
    const msg = capabilityMessage({ webxr: false, geolocation: true });
    expect(msg).toContain('WebXR');
    expect(msg).not.toContain('GPS / geolocation');
    expect(msg).toContain('AR-capable phone');
  });

  it('names GPS when only geolocation is missing', () => {
    const msg = capabilityMessage({ webxr: true, geolocation: false });
    expect(msg).toContain('GPS / geolocation');
    expect(msg).not.toContain('WebXR');
  });

  it('names both when nothing is supported', () => {
    const msg = capabilityMessage({ webxr: false, geolocation: false });
    expect(msg).toContain('WebXR');
    expect(msg).toContain('GPS / geolocation');
    expect(msg).toContain('and');
  });

  it('ends neutrally at "outdoors." when no contextLabel is given', () => {
    const msg = capabilityMessage({ webxr: false, geolocation: true });
    expect(msg).toContain('outdoors.');
    expect(msg).not.toContain('to try');
  });

  it('appends the app-specific contextLabel when supplied', () => {
    const msg = capabilityMessage(
      { webxr: false, geolocation: true },
      { contextLabel: 'the persistent-anchor flow' }
    );
    expect(msg).toContain('outdoors, to try the persistent-anchor flow.');
  });
});
