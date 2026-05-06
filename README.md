# Location-Based WebXR

[![npm version](https://img.shields.io/npm/v/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![npm downloads](https://img.shields.io/npm/dm/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)

Build location-based Augmented Reality experiences on the web — an Apache-2.0 framework, a reference recorder app, and a closed-source alignment core that fuses GPS with WebXR odometry.

## What You Can Build With It

- **Outdoor AR navigation** — arrows and waypoints anchored to real-world GPS coordinates.
- **GPS-anchored 3D content** — drop persistent 3D objects at lat/lon and have them stay put as the user walks.
- **AR tour guides and museum trails** — content keyed to location, surfaced when the user is nearby.
- **Location-based games** — geocaching, scavenger hunts, multi-player AR experiences tied to physical places.
- **Field-data capture tools** — record GPS, AR poses, camera frames, and depth for later analysis or ML training.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Your App                                        │
│  (UI, screen flow, app-specific reducers)        │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-app-framework   ← this repo       │
│  (WebXR, Three.js, sensors, storage, replay,     │
│   composable store factory with extension hooks) │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-js              (npm package)     │
│  (GPS/AR alignment, outlier rejection, GPS math) │
└──────────────────────────────────────────────────┘
```

Your app composes its own state, screen flow, and visuals on top of the framework via `createSlamAppStore({ extraReducers, extraMiddleware, storageBackend })`. The framework never imports from your app, and the closed-source core never imports from the framework.

## Packages

| Package                                                     | Description                                                                                                                               | License    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [`GpsPlusSlamJs_AppFramework`](GpsPlusSlamJs_AppFramework/) | Reusable AR+GPS app framework — WebXR session management, Three.js visualization, GPS sensors, OPFS+ZIP record/replay, composable store. | Apache-2.0 |
| [`GpsPlusSlamJs_RecorderApp`](GpsPlusSlamJs_RecorderApp/)   | Full-featured recorder app: capture AR sessions on a phone, replay on a desktop, debug alignment, and contribute test data.              | Apache-2.0 |
| [`GpsPlusSlamJs_MinimalExample`](GpsPlusSlamJs_MinimalExample/) | Smallest possible consumer of the framework. Three.js cube + status panel, no AR session. Use this as your starting template.         | Apache-2.0 |

The recorder app at a glance:

- Records WebXR AR poses, GPS positions, optional camera frames, and optional depth samples.
- Exports the session as a self-contained ZIP file you can email, version-control, or share.
- Replays the ZIP on a desktop with full 3D scene reconstruction for inspection and debugging.

## About the Core Library

The core alignment library ([`gps-plus-slam-js`](https://www.npmjs.com/package/gps-plus-slam-js)) is **closed-source** and distributed via npm under a proprietary license (EULA). It provides:

- **Sub-meter positioning** — fuses high-frequency AR odometry with noisy GPS.
- **Fully offline** — all computation runs on-device, no network requests.
- **Framework-agnostic** — pure TypeScript with a Redux-based state store.
- **Incremental alignment** — the alignment matrix updates live as new observations arrive.

A free **community license key** is bundled with the framework for evaluation and non-commercial use. See the [EULA](https://www.npmjs.com/package/gps-plus-slam-js) for commercial licensing.

## Quick Start: Try the Recorder

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 10 (enable via `corepack enable`)

### Run the Recorder App

```bash
git clone https://github.com/cs-util-com/location-based-webxr.git
cd location-based-webxr

# Install all workspace dependencies
pnpm install

# Start the dev server
pnpm --filter gps-plus-slam-recorder dev
```

The recorder app opens at `http://localhost:5173`. Use a WebXR-capable mobile device (e.g., Chrome on Android) to start recording AR+GPS sessions. The recorder also runs in a desktop browser for replay-only flows.

## Quick Start: Build Your Own App

Install the framework and core library:

```bash
pnpm add gps-plus-slam-app-framework gps-plus-slam-js
```

```ts
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { initAR } from 'gps-plus-slam-app-framework/ar';
import { startGpsWatch } from 'gps-plus-slam-app-framework/sensors';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';

// 1. Compose the store. Use OpfsStorageBackend for durable recording.
const store = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
});

// 2. Start the WebXR AR session.
await initAR(document.getElementById('app')!);

// 3. Wire GPS into the store.
startGpsWatch(
  (pos) => {
    /* dispatch into store */
  },
  (err) => {
    /* handle error */
  }
);
```

> See [`GpsPlusSlamJs_MinimalExample`](GpsPlusSlamJs_MinimalExample/) for the full version of this snippet (Three.js scene + status panel, end-to-end runnable). For the full API surface and the composable extension hooks (`extraReducers`, `extraMiddleware`, `ZipExportContributor`), see the [framework README](GpsPlusSlamJs_AppFramework/README.md).

## Repository Layout

| Folder                                                      | Purpose                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| [`GpsPlusSlamJs_AppFramework/`](GpsPlusSlamJs_AppFramework/) | The reusable framework (npm package).                         |
| [`GpsPlusSlamJs_RecorderApp/`](GpsPlusSlamJs_RecorderApp/)   | The reference recorder app (Vite + Playwright).               |
| [`GpsPlusSlamJs_MinimalExample/`](GpsPlusSlamJs_MinimalExample/) | Smallest possible framework consumer.                     |
| `signatures/`                                               | License-key public signatures for the closed-source core.     |
| `tests/`                                                    | Repo-config integration tests (workspace cohesion checks).    |

## Build the Framework from Source

```bash
pnpm --filter gps-plus-slam-app-framework build
```

## Run Tests

```bash
# All tests (framework + recorder unit + recorder E2E + minimal example)
pnpm test

# Framework tests only
pnpm run test:framework

# Recorder unit tests only
pnpm run test:recorder:unit

# Recorder E2E tests only
pnpm run test:recorder:e2e

# Minimal-example tests only
pnpm run test:example
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and the pull request process.

## License

The framework, recorder app, and minimal example are licensed under the [Apache License 2.0](LICENSE).

The core library (`gps-plus-slam-js`) is distributed under a separate proprietary license. See its [EULA](https://www.npmjs.com/package/gps-plus-slam-js) for details.
