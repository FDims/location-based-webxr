import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    // Same alias as the main test config: bench files exercise app modules
    // that import the framework, and both configs must resolve it to the
    // sibling source tree, not a published dist.
    alias: {
      'gps-plus-slam-app-framework': fileURLToPath(
        new URL('../../GpsPlusSlamJs_AppFramework/src', import.meta.url)
      ),
    },
  },
  test: {
    benchmark: {
      include: ['src/**/*.bench.ts'],
      outputJson: 'docs/perf-baselines/bench-results.json',
    },
  },
});
