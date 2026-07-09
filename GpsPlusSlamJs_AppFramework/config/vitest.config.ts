import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      // Pick up node-only `.mjs` script tests (e.g. the pre-publish
      // guardrails under `scripts/`). They share the project's `node`
      // environment but live outside `src/`.
      'scripts/**/*.test.mjs',
    ],
    setupFiles: [
      fileURLToPath(new URL('../src/test-setup.ts', import.meta.url)),
    ],
    silent: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/index.ts',
        // Benchmarks are measurement instruments, not code under test.
        'src/**/*.bench.ts',
      ],
    },
  },
});
