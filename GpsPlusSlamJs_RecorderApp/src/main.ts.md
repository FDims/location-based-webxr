# main.ts

## Purpose

Application entry point. Initializes WebXR, wires up UI callbacks, and orchestrates the recording workflow.

## Public API

This module is the entry point that runs on page load. It also exports the following for the soft-reset flow and testing:

| Export                                   | Type                     | Description                                                                                                                                                                            |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resetForNewRecording()`                 | `async () => void`       | Orchestrates soft reset: tears down current session (store, trackers, sync, map), creates fresh store, resets storage/UI state, and checks if read folder permission is still granted. |
| `getImportedRefPoints()`                 | `() => KnownGeoAnchor[]` | Returns the sidecar-imported known anchors (entries with `timestamp === 0`) from the flat `refPoints` slice via `selectImportedKnownAnchors`. Test-only seam.                          |
| `setImportedRefPointsForTesting(points)` | `(points) => void`       | Dispatches `setImportedRefPointEntries` into the flat `refPoints` slice; each input becomes a `RefPointEntry` with `timestamp: 0` (sidecar marker). Test-only.                         |
| `setCurrentScenarioName(name)`           | `(string) => void`       | Sets current scenario name (test-only).                                                                                                                                                |

## Internal Flow

1. **Check WebXR support** - Exits early with error if unsupported
2. **Initialize UI** - Wires up button callbacks to handler functions
3. **Initialize Session Summary** - Wires up summary panel callbacks
4. **Handle folder selection** - Calls `initStorage()`, populates scenario dropdown
5. **Handle Enter AR** - Calls `initAR()` to start WebXR session
6. **Handle recording controls** - Start/stop recording, mark reference points
7. **Handle stop recording** - Collects summary data and shows Session Summary panel

## Invariants & Assumptions

- Runs in a browser with potential WebXR support
- DOM elements exist in `index.html` (buttons, modals, etc.)
- File System Access API available (Chrome Android 142+)
- **Navigation store getter**: `initNavigation` receives `() => store` (not `store` directly) so that after soft reset the navigation module always resolves the current store instance (Bug 9 fix).
- **Reference point counts**: When displaying reference point info in status messages,
  always distinguish between unique reference points (`refPointDefs.length`) and
  total observations (`flattenRefPointsToMarks(refPointDefs).length`). Use format:
  `"N ref points (M observations)"` to avoid confusion.

## Examples

The module self-executes:

```typescript
// In browser, automatically runs main() on import
import './main';
```

## Tests

- Unit tests in `main.test.ts` — 32 tests covering:
  - Store creation, AR flow, recording lifecycle
  - Session summary data collection
  - Progress tracking (frame/action counters)
  - Reference point deduplication (imported + scenario)
  - **Soft reset** (Issue 4): 5 tests for `resetForNewRecording()`:
    - Calls all cleanup functions (hideSessionSummary, resetForNewSession, etc.)
    - Creates a fresh store
    - Keeps folder when read permission still granted
    - Clears folder + imported ref points when permission lost
    - Graceful handling of permission check returning false
- E2E tests in `playwright-tests/smoke.spec.js` verify the page loads
- E2E tests in `playwright-tests/session-summary.spec.js` verify post-recording summary
