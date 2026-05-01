/**
 * Tests for the curated `core` re-export surface.
 *
 * Why this test matters: the Option-C migration depends on every symbol that
 * apps used to import directly from `gps-plus-slam-js` being available at
 * `gps-plus-slam-app-framework/core`. If a future refactor accidentally drops
 * one of the re-exports, app code (and the lint rule banning direct
 * `gps-plus-slam-js` imports in apps) would catch it eventually — but this
 * test catches it at framework build time, with a clear failure message.
 *
 * See: 2026-05-01-app-single-package-dep-analysis.md §2.4
 */

import { describe, it, expect } from 'vitest';
import * as core from './index.js';
import * as lib from 'gps-plus-slam-js';

describe('core re-export surface', () => {
  it('re-exports the runtime symbols apps depend on', () => {
    // Functions
    expect(core.webxrToNUE).toBe(lib.webxrToNUE);
    expect(core.calcGpsCoords).toBe(lib.calcGpsCoords);
    expect(core.isIdentityMatrix4).toBe(lib.isIdentityMatrix4);
    // Action creator (Redux Toolkit creates a callable with `.type`)
    expect(typeof core.odometryTrackingRestarted).toBe('function');
    expect(core.odometryTrackingRestarted).toBe(lib.odometryTrackingRestarted);
    // Factory
    expect(core.createGpsSlamStore).toBe(lib.createGpsSlamStore);
  });
});
