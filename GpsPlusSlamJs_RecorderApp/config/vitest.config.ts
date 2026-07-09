import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      'gps-plus-slam-app-framework': fileURLToPath(
        new URL('../../GpsPlusSlamJs_AppFramework/src', import.meta.url)
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    // Suppress console.log/error output from tests to reduce noise.
    // Failing tests still show the assertion error and source context.
    // To see all console output for debugging, run with --silent=false:
    //   npm run test:unit -- --silent=false
    silent: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/main.ts',
        // Benchmarks are measurement instruments, not code under test.
        'src/**/*.bench.ts',
      ],
      thresholds: {
        statements: 87,
        branches: 75,
        functions: 87,
        lines: 88,
      },
    },
  },
});
