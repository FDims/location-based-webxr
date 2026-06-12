# recording-options.ts

## Purpose

User-configurable recording options for controlling high-frequency data streams (depth sampling, image capture). Allows users to disable/tune expensive capture operations to improve performance on lower-end devices.

## Public API

### Types

| Type                  | Description                                                                       |
| --------------------- | --------------------------------------------------------------------------------- |
| `DepthCaptureOptions` | Config for depth sampling: `enabled`, `intervalMs`, `gridSize`                    |
| `ImageCaptureOptions` | Config for image capture: `enabled`, `intervalMs`, `quality`, `resolutionDivisor` |
| `RecordingOptions`    | Combined config with `depth` and `images` sections                                |

### Functions

| Function                              | Input                            | Output                | Description                                            |
| ------------------------------------- | -------------------------------- | --------------------- | ------------------------------------------------------ |
| `loadRecordingOptions(key?)`          | `key?: string`                   | `RecordingOptions`    | Loads from localStorage, returns defaults if not found |
| `saveRecordingOptions(options, key?)` | `RecordingOptions, key?: string` | `void`                | Validates and saves to localStorage                    |
| `resetRecordingOptions(key?)`         | `key?: string`                   | `RecordingOptions`    | Clears storage, returns defaults                       |
| `cloneRecordingOptions(options)`      | `RecordingOptions`               | `RecordingOptions`    | Deep copy                                              |
| `validateDepthOptions(partial)`       | `Partial<DepthCaptureOptions>`   | `DepthCaptureOptions` | Validates and clamps values                            |
| `validateImageOptions(partial)`       | `Partial<ImageCaptureOptions>`   | `ImageCaptureOptions` | Validates and clamps values                            |
| `validateRecordingOptions(partial)`   | `Partial<RecordingOptions>`      | `RecordingOptions`    | Validates full options object                          |

### Constants

| Constant                    | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `STORAGE_KEY`               | localStorage key: `'gps-plus-slam-recorder-options'` |
| `DEFAULT_RECORDING_OPTIONS` | Default values (all enabled)                         |
| `DEPTH_CONSTRAINTS`         | Min/max/step for depth options                       |
| `IMAGE_CONSTRAINTS`         | Min/max/step for image options                       |

## Invariants & Assumptions

- Values loaded from localStorage are always validated and clamped
- Invalid JSON in storage returns defaults (no crash)
- Schema evolution: missing fields merge with defaults
- All numeric values respect constraint bounds after validation

## Defaults

```typescript
{
  depth: { enabled: true, intervalMs: 1000, gridSize: 16, rgb: true },
  images: { enabled: true, intervalMs: 2000, quality: 0.7, resolutionDivisor: 1 }
}
```

`depth.gridSize` default is 16 (16×16 = 256 points per sample) so the AR-space occupancy grid populates fast enough for on-device verification (2026-06-11 port plan §1). The depth options reach the sampler via `startDepthCapture(config)` → `DepthSampler.updateConfig` — before that plumbing existed they were dead knobs. `depth.rgb` (default **true**) toggles the Iter-8 RGB voxel coloring (one small per-sample camera-color blit+readback); non-boolean persisted values fall back to the default, so pre-Iter-8 stored options keep the feature on.

## Validation Constraints

| Setting                    | Min  | Max   |
| -------------------------- | ---- | ----- |
| `depth.intervalMs`         | 500  | 5000  |
| `depth.gridSize`           | 2    | 32    |
| `images.intervalMs`        | 1000 | 10000 |
| `images.quality`           | 0.3  | 1.0   |
| `images.resolutionDivisor` | 1    | 8     |

## Examples

```typescript
import {
  loadRecordingOptions,
  saveRecordingOptions,
  resetRecordingOptions,
} from './recording-options';

// Load (returns defaults if nothing saved)
const options = loadRecordingOptions();

// Modify
options.depth.enabled = false;
options.images.quality = 0.5;

// Save
saveRecordingOptions(options);

// Reset to defaults
const defaults = resetRecordingOptions();
```

## Tests

- `recording-options.test.ts` — 44 unit tests
  - Validation: clamps out-of-range, handles invalid types
  - Persistence: load/save/reset with localStorage
  - Schema evolution: partial stored data merges with defaults
  - Constraints: bounds are valid, defaults within bounds
