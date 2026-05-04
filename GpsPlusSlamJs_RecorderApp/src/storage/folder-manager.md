# Folder Manager

## Purpose

Encapsulates folder/save-location selection, scenario management, and OPFS scenario caching — extracted from `main.ts` as part of Finding #7 Step 4.

## Public API

### `createFolderManager(deps: FolderManagerDeps): FolderManager`

Factory function that creates a folder manager instance with injected dependencies.

**Returned methods:**

| Method                              | Description                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handleOpenFolder()`                | Opens folder picker, lists scenarios, populates UI. Behaves differently in recording vs replay mode. Ref point import is deferred to scenario selection time.                                 |
| `handleChooseSaveLocation()`        | Opens save-file picker for external ZIP export. Guards on `isExternalStorageSupported()`.                                                                                                     |
| `handleScenarioChange(name)`        | Sets current scenario in storage, loads & displays reference points.                                                                                                                          |
| `loadAndDisplayRefPoints(handle)`   | Loads ref points, flattens for 3D display, computes averaged GPS per ID, dispatches to store for H3 proximity, and displays on 2D map overlay. Returns `{ refPointCount, observationCount }`. |
| `getCurrentScenarioName()`          | Reads the current scenario name from `state.scenario.currentScenarioName`.                                                                                                                    |
| `setCurrentScenarioName(name)`      | Dispatches `scenario/setCurrentScenarioName` to update the recorder-app `scenario` slice.                                                                                                     |
| `getCachedOpfsScenarios()`          | Returns the cached OPFS scenario names array.                                                                                                                                                 |
| `setCachedOpfsScenarios(scenarios)` | Sets the cached OPFS scenarios.                                                                                                                                                               |
| `reset()`                           | Resets `currentScenarioName` and `cachedOpfsScenarios` to defaults.                                                                                                                           |

### `FolderManagerDeps`

Dependencies injected from `main.ts`:

- **Cross-module state:** `getIsReplayMode`, `setReplayZipScenariosCache`, `setImportedRefPoints`
- **UI callbacks:** `showError`, `updateStatus`, `populateScenarios`, `setFolderSelected`, `setSaveLocationSelected`, `validateEnterButton`, `listScenariosFromFolder`, `extractScenarioNamesFromZips`, `discoverScenariosFromZipMetadata`, `populateReplayScenarios`, `updateFolderStatus`, `updateSaveStatus`
- **Optional:** `mapOverlay?: { addPriorRefPoints, clearPriorRefPoints }` — 2D map display for prior ref points

UI functions are injected (not imported directly) to respect the `storage/ → ui/` dependency boundary rule enforced by dependency-cruiser. This includes status display helpers (`updateFolderStatus`, `updateSaveStatus`) so the module has zero direct DOM access.

## Invariants & Assumptions

- `handleOpenFolder` checks `getIsReplayMode()` to branch between recording-mode (list scenarios, no ref point import) and replay-mode (discover zip metadata + populate replay UI). Ref point import happens at scenario-selection time via `loadAndDisplayRefPoints`.
- In recording mode, folder and zip scenario names are merged and deduplicated before populating the dropdown.
- `loadAndDisplayRefPoints` clears existing visualized ref points before displaying new ones.
- `handleChooseSaveLocation` is a no-op (with error toast) when `isExternalStorageSupported()` returns false.

## Examples

```ts
const folderManager = createFolderManager({
  getIsReplayMode: () => replayHandlers.getIsReplayMode(),
  setReplayZipScenariosCache: (c) =>
    replayHandlers.setReplayZipScenariosCache(c),
  setImportedRefPoints: (rp) => refPointHandlers.setImportedRefPoints(rp),
  showError,
  updateStatus,
  populateScenarios,
  setFolderSelected,
  setSaveLocationSelected,
  validateEnterButton,
  listScenariosFromFolder,
  extractScenarioNamesFromZips,
  discoverScenariosFromZipMetadata,
  populateReplayScenarios,
  updateFolderStatus(text) {
    const el = document.getElementById('folder-status');
    if (el) el.textContent = text;
  },
  updateSaveStatus(text) {
    const el = document.getElementById('save-status');
    if (el) el.textContent = text;
  },
});

await folderManager.handleOpenFolder();
folderManager.getCurrentScenarioName(); // → 'MyScenario'
```

## Tests

- `storage/folder-manager.test.ts` — 38 tests covering recording-mode folder open (including verify no ref point import at folder-open time), replay-mode folder open, save location selection, scenario change, ref point loading with averaged GPS and map overlay forwarding, state accessors, and reset.
