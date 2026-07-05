# session-zip-naming.ts

## Purpose

Session-ZIP naming and scenario-identity helpers shared across layers: the
canonical `DEFAULT_SCENARIO` constant, the zip-filename timestamp parser, and
the `session.json` → scenario-name resolver.

## Why it lives in `storage/`

Both `ui/session-browser.ts` (replay discovery) and
`storage/ref-point-recovery.ts` (recording-mode ref-point indexing,
2026-07-05 folder-import plan §3.1) need these. The layered architecture
forbids storage → ui imports (dependency-cruiser `no-storage-importing-ui`),
while ui → storage is allowed — so the shared pieces live here and
`session-browser.ts` re-exports them for its existing consumers (`hud.ts`,
`recording-session-handlers.ts`, tests).

## Public API

- `DEFAULT_SCENARIO: string` — canonical scenario name for recordings without
  an explicit scenario. Missing metadata, empty strings, and the literal
  `"Default Scenario"` all canonicalize to it.
- `parseDateFromSessionFilename(filename: string): Date | null` — parses the
  `..._YYYY-MM-DD_HH-MM-SSutc.zip` timestamp (both `recording-…` and
  `<Scenario>-session-…` forms); `null` for non-conforming names or impossible
  dates (e.g. Feb 30).
- `resolveScenarioNameFromMetadata(metadata: Record<string, unknown> | null): string`
  — resolves a recording's scenario with precedence `contextTag` (current
  framework field) → legacy `scenarioName` → `DEFAULT_SCENARIO`.

## Invariants & assumptions

- Pure functions, no I/O, no module state.
- `resolveScenarioNameFromMetadata` treats metadata as untrusted (any field
  may be missing or non-string) and never throws.
- The precedence rules must stay identical for replay discovery and ref-point
  indexing — that is the whole reason this module exists; never fork them.

## Examples

```ts
parseDateFromSessionFilename('recording-2026-02-19_10-15-00utc.zip');
// → Date(2026-02-19T10:15:00Z)

resolveScenarioNameFromMetadata({ contextTag: 'Paris' }); // → 'Paris'
resolveScenarioNameFromMetadata({ scenarioName: 'Old' }); // → 'Old'
resolveScenarioNameFromMetadata(null); // → 'Default Scenario'
```

## Tests

Covered via the re-exporting consumers' suites:
`src/ui/session-browser.test.ts`, `src/ui/session-browser.property.test.ts`
(timestamp parsing properties), `src/ui/replay-zip-discovery.test.ts`
(resolution precedence via `discoverScenariosFromZipMetadata`), and
`src/storage/ref-point-recovery.test.ts` (resolution + newest-first ordering
via `indexRefPointDefinitionsFromFolder`).
