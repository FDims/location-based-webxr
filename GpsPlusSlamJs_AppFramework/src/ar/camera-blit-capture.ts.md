# camera-blit-capture.ts

## Purpose

Reads WebXR **opaque** camera textures (protected GPU buffers where plain `readPixels`/`toBlob` return black) by blitting them onto a fullscreen quad into an intermediate `WebGLRenderTarget` and reading that back. Used for the periodic JPEG frame captures and, since Iter 8, for the per-depth-sample RGB voxel colors.

Background: `docs/2026-02-06-bug-camera-frames-black.md`; RGB path: `GpsPlusSlamJs_Docs/docs/2026-06-11-depth-occupancy-grid-port-plan.md` §4 Iter 8.

## Public API

- **`new CameraBlitCapture(config?)`** — `{ width, height }` of the intermediate target (default 512×512). Allocates the render target, shader quad and CPU pixel buffer once.
- **`captureToBlob(renderer, cameraTexture, quality): Promise<Blob | null>`** — blit + readback + JPEG encode (y-flip applied during encode). Null on failure/dispose.
- **`captureToPixels(renderer, cameraTexture): { pixels, width, height } | null`** — blit + readback only (steps A+B, shared with `captureToBlob`), returning the raw RGBA buffer for cheap per-point sampling (Iter 8). The returned `pixels` is the INTERNAL buffer — valid until the next capture or `resizeIfNeeded`; consume synchronously (e.g. `createRgbLookup`) or copy. Buffer is WebGL readback order (bottom-row-first). Null on failure/dispose, never throws.
- **`resizeIfNeeded(width, height): boolean`** — re-sizes target + buffer; no-op when unchanged/invalid/disposed.
- **`CameraBlitCapture.isBlackFrame(pixels): boolean`** — sampled all-zero check (blit-failed detection vs. dark scene).
- **`computeCaptureSize(cameraWidth, cameraHeight, divisor)`** — capture dimensions from native camera resolution and the user's resolution divisor; falls back to the default config on invalid input.
- **`DEFAULT_BLIT_CONFIG`** — 512×512.

## Invariants & Assumptions

1. Both capture methods MUST be called inside the XR animation frame callback while the camera texture is valid.
2. Renderer state (render target, `xr.enabled`) is saved and restored around the blit — otherwise the main XR render loop breaks.
3. The opaque-texture uniform is cleared after each capture so the protected texture is never retained.
4. Failures are best-effort: logged and returned as `null`, never thrown into the frame loop.

## Examples

```ts
const blit = new CameraBlitCapture({ width: 256, height: 192 });
// inside the XR frame callback:
const readback = blit.captureToPixels(renderer, cameraTexture);
const jpeg = await blit.captureToBlob(renderer, cameraTexture, 0.7);
blit.dispose(); // on session teardown
```

## Tests

- `camera-blit-capture.test.ts` — blob pipeline (blit → readPixels → JPEG), renderer-state restore, black-frame handling, `captureToPixels` (buffer + dimensions, state restore, throw → null, dispose → null), resize and dispose paths.
- `camera-blit-capture.property.test.ts` — `computeCaptureSize` clamping/fallback properties.
