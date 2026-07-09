# vitest.config.ts

## Purpose

Vitest configuration for unit testing with V8 coverage.

## Settings

| Setting             | Value              | Description              |
| ------------------- | ------------------ | ------------------------ |
| `globals`           | `true`             | Enable global test APIs  |
| `environment`       | `node`             | Node.js test environment |
| `include`           | `src/**/*.test.ts` | Test file pattern        |
| `coverage.provider` | `v8`               | V8 coverage engine       |
| `coverage.reporter` | `text, json, html` | Coverage output formats  |

## Path Alias

- `@app/*` → `src/*`

## Coverage Exclusions

- Test files (`*.test.ts`, `*.spec.ts`)
- Entry point (`main.ts`) - integration layer
- Benchmarks (`*.bench.ts`) - measurement instruments run via `pnpm bench` ([vitest.bench.config.ts.md](vitest.bench.config.ts.md)), not code under test; excluding them keeps the hard coverage thresholds unaffected

## Usage

```bash
npm run test:unit      # Run with coverage
npm run test:watch     # Watch mode
```
