# settings-modal.ts

## Purpose

UI component for the settings modal dialog. Allows users to configure recording options (depth sampling, image capture) with visual sliders and checkboxes.

## Public API

### Functions

| Function                       | Input               | Output                     | Description                               |
| ------------------------------ | ------------------- | -------------------------- | ----------------------------------------- |
| `initSettingsModal(callback?)` | `(options) => void` | `void`                     | Initializes modal, wires up events        |
| `showSettingsModal()`          | -                   | `void`                     | Shows modal, loads current options        |
| `hideSettingsModal()`          | -                   | `void`                     | Hides modal, discards unsaved changes     |
| `isSettingsModalVisible()`     | -                   | `boolean`                  | Check if modal is currently shown         |
| `getWorkingOptions()`          | -                   | `RecordingOptions \| null` | Get current unsaved options (for testing) |

> **Note:** HTML markup lives in `index.html`. Tests use `../test-utils/html-fixtures.ts` to load production HTML, ensuring tests always match the actual UI.

### UI Elements Expected

| Element ID                        | Type     | Purpose                                        |
| --------------------------------- | -------- | ---------------------------------------------- |
| `settings-modal`                  | div      | Modal container (should have `hidden` class)   |
| `btn-settings`                    | button   | Opens settings modal                           |
| `btn-settings-close`              | button   | Closes modal without saving                    |
| `btn-settings-save`               | button   | Saves and closes modal                         |
| `btn-settings-reset`              | button   | Resets to defaults                             |
| `depth-enabled`                   | checkbox | Toggle depth sampling                          |
| `depth-interval`                  | range    | Depth sample interval slider                   |
| `depth-interval-value`            | span     | Display for interval value                     |
| `depth-grid`                      | range    | Grid size slider                               |
| `depth-grid-value`                | span     | Display for grid value                         |
| `depth-rgb`                       | checkbox | Toggle RGB voxel coloring (Iter 8, default on) |
| `images-enabled`                  | checkbox | Toggle image capture                           |
| `images-interval`                 | range    | Image capture interval slider                  |
| `images-interval-value`           | span     | Display for interval value                     |
| `images-quality`                  | range    | JPEG quality slider                            |
| `images-quality-value`            | span     | Display for quality value                      |
| `images-resolution-divisor`       | range    | Resolution divisor slider (1=full … 8)         |
| `images-resolution-divisor-value` | span     | Display: "1× (full)", "÷2 (half)", etc         |
| `build-version-label`             | span/div | One-line build label for bug reports           |

## Invariants & Assumptions

- Modal starts with `hidden` class applied
- Changes are only persisted on Save, not on close/backdrop click
- Sliders are disabled when their parent toggle is unchecked
- Working copy is created on show, cleared on hide
- Callback is invoked only after successful save
- Build version label (`#build-version-label`) is populated during `initSettingsModal()` from `getBuildInfo()`. If metadata is unavailable, the modal logs a warning and shows `Build unavailable` instead of throwing.

## Examples

```typescript
import { initSettingsModal, showSettingsModal } from './settings-modal';

// Initialize with optional change callback
initSettingsModal((options) => {
  console.log('Options saved:', options);
  // Apply new options to capture systems
});

// Open modal (e.g., from a button click)
document
  .getElementById('btn-settings')
  .addEventListener('click', showSettingsModal);
```

## Tests

- `settings-modal.test.ts` — 40 unit tests
  - Production HTML validation: modal and button markup from `index.html`
  - Modal visibility: show/hide behavior
  - Form population: checkboxes, sliders
  - Slider interactions: value updates on input
  - Checkbox interactions: disables related sliders
  - Save/reset/close behavior
  - Build label population and graceful fallback when metadata is unavailable

> Tests use `html-fixtures.ts` to load the actual production HTML from `index.html`, eliminating duplication and ensuring tests fail if the production markup is broken.
