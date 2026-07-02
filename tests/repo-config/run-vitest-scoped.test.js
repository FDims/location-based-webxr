// Repo-meta test: pins the shared scripts/run-vitest-scoped.mjs arg builder
// that every workspace package's `test:unit` routes through.
//
// Why this test matters: `pnpm run test:unit -- <file>` makes pnpm forward a
// **literal** `--` token, and vitest (CAC) routes everything after a bare `--`
// into argv['--'] (raw passthrough) instead of treating the path as a
// positional file filter. The documented single-file invocation therefore
// silently ran each package's ENTIRE unit suite (verified 2026-07-02 in
// AppFramework 139 files, RecorderApp 87, AnchorStarter 11, QrTrackingDemo 7,
// MinimalExample 5). The shared wrapper strips the bare `--` so both
// `pnpm run test:unit <file>` and `pnpm run test:unit -- <file>` scope
// correctly in every package; these tests keep that stripping logic from
// silently regressing. A no-arg run must pass through unchanged — it is the
// full-suite invocation every package's `test`/`test:core` gate uses.

import { describe, it, expect } from 'vitest';

import { buildScopedVitestArgs } from '../../scripts/run-vitest-scoped.mjs';

describe('buildScopedVitestArgs — pnpm "--" stripping', () => {
  it('strips the literal "--" pnpm forwards, so the file filter survives', () => {
    // Package base args come first (from the package.json script line), then
    // pnpm appends the developer's args after a literal `--`.
    expect(
      buildScopedVitestArgs([
        'run',
        '--coverage',
        '--config',
        'config/vitest.config.ts',
        '--',
        'src/ar/occupancy-mesher.smooth.test.ts',
      ])
    ).toEqual([
      'run',
      '--coverage',
      '--config',
      'config/vitest.config.ts',
      'src/ar/occupancy-mesher.smooth.test.ts',
    ]);
  });

  it('passes the no-separator form through unchanged (order preserved)', () => {
    expect(buildScopedVitestArgs(['run', 'src/boot.test.ts'])).toEqual([
      'run',
      'src/boot.test.ts',
    ]);
  });

  it('with no developer args yields the package base invocation (full suite, no refusal)', () => {
    expect(buildScopedVitestArgs(['run'])).toEqual(['run']);
  });

  it('preserves real flags — only the BARE "--" token is stripped', () => {
    expect(
      buildScopedVitestArgs(['run', '--', 'src/x.test.ts', '--reporter=dot'])
    ).toEqual(['run', 'src/x.test.ts', '--reporter=dot']);
  });
});
