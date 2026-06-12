# Changelog

## [Unreleased]

### Features

- **RGB voxel coloring (occupancy-grid port Iter 8)** — `DepthPoint` gains an optional, additive `rgb: [r, g, b]` (0–255) sampled from the camera frame in the same XR frame as the depth read; `DepthSampler` gains a `rgb` config (default true) + lazy `acquireRgbLookup` callback (at most one small GPU blit+readback per emitted sample via the new `CameraBlitCapture.captureToPixels()` and the pure `ar/depth-rgb-lookup`); `OccupancyGrid.getCellColor()` exposes a per-cell running average of the colored observations; `DepthCaptureOptions.rgb` recording option (default on). Old recordings and rgb-off sessions are unaffected (consumers fall back to height-based coloring).

## [1.1.0] — 2026-06-08

### Features

- **ArWorldGroupAlignment** — `enableArWorldGroupAlignment()` applies lerped GPS→AR alignment on `arWorldGroup`, replacing per-anchor lerps with a single group-level correction
- **AR re-entry** — `enable()` now exposes `disable()` teardown with a `stopping` state, allowing clean AR session restart without stale state
- **`onBootstrapComplete` callback** — `createGpsAnchor` accepts an optional callback fired once the anchor's world-pose bootstraps
- **Hit-test reticle** — promoted from consumer apps into the framework as a first-class visualization primitive
- **Headless Enable GPS AR seam** — `enable-gps-ar` module provides a headless entry point for starting AR+GPS without UI
- **`registerXrFrameUpdate`** — new seam for per-frame XR callbacks + `requestHitTest` opt-in
- **Capability checker** — promoted to `ar/` with `contextLabel` for richer diagnostics
- **Onboarding-guidance coaching** — coaching seam over tracking-quality for consumer UIs
- **GPS-anchor guard** — `createGpsAnchor` now validates that the target `Object3D` is a descendant of `arWorldGroup`
- **Smooth steady-state corrections** — GPS-anchor corrections default to smooth interpolation
- **Chromium camera-access workaround** — version-gated `baseLayer` persistence for affected Chrome builds

### Bug Fixes

- Guard `refreshSupport` against clobbering active `starting`/`running` AR state with a stale probe
- Correct on-screen GPS-anchor hard-jump by removing the large-jump bypass
- Apply `WEBXR_TO_NUE` basis change to hit-test pose so the reticle stays centred
- Keep hit-test reticle pinned at screen centre under aligned `arWorldGroup`
- Start sensor watches only after `initAR` resolves in `enable-gps-ar`
- Isolate throwing listeners in `enable-gps-ar` `setState` dispatch
- Make orientation permission probe truly non-blocking in `enable()`
- Harden `updateRenderState` patch against `null` and explicit `undefined` baseLayer
- Isolate throwing per-frame callbacks so one bug cannot kill the render loop
- Isolate WebXR `baseLayer` persistence per `XRSession` via `WeakMap`
- Nest HUD overlays inside the `initAR` container
- Widen baseLayer patch window to all of Chrome 148 + add bootstrap diagnostics
- Publish `visualization` subpath artifacts in tsdown `entryFiles`

### Refactoring

- Tie `ArWorldGroupAlignment` disposal to the XR session lifecycle
- Remove D1 per-anchor lerp — steady-state corrections now snap instantly at the group level
- Derive recording action types from action creators in persistence middleware

### Documentation

- Update scene-graph docs: anchors ride lerped `arWorldGroup` alignment
- Cross-link trivial → starter → full example ladder
