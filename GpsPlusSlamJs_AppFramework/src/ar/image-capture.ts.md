# image-capture.ts

## Purpose

Captures periodic JPEG screenshots from the WebGL canvas during AR recording. Uses async `toBlob()` for non-blocking performance. Includes validation to detect suspiciously small (likely black/empty) images.

## Public API

| Export                   | Type                 | Description                                                                                                                                                                    |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MIN_VALID_IMAGE_BYTES`  | `number` (5000)      | Blob size threshold for suspicious image detection                                                                                                                             |
| `ARPose`                 | interface            | Camera position + orientation (duplicated from webxr-session to avoid cycles)                                                                                                  |
| `ImageCaptureConfig`     | interface            | Configuration: `intervalMs`, `quality`, `captureTimeoutMs`, `resolutionDivisor`                                                                                                |
| `DEFAULT_CAPTURE_CONFIG` | `ImageCaptureConfig` | Defaults: 2000ms interval, 0.7 quality, 5000ms timeout, 1× resolution                                                                                                          |
| `CapturedImage`          | interface            | Blob + timestamp + frameIndex + position + rotation + screenRotation (every persistable field is forwarded by RecorderApp `handleImageCaptured`; thread new fields through it) |
| `ImageCaptureCallbacks`  | interface            | Hooks for pose, rotation, onCaptured, onCaptureFailed, onSuspiciousImage, captureFrame                                                                                         |
| `ImageCaptureManager`    | class                | Manages periodic capture lifecycle                                                                                                                                             |
| `startImageCapture(…)`   | function             | Convenience factory: creates + starts an `ImageCaptureManager`                                                                                                                 |
| `stopImageCapture()`     | function             | Stops the active manager                                                                                                                                                       |

### ImageCaptureManager key methods

- `start()` — Begin periodic capture timer.
- `stop()` — Stop timer, clear any pending safety timeout, and reset `captureInProgress`.
- `onFrame(canvas, gl)` — Called each XR frame. Checks interval, captures if ready.
- `getFrameCount()` — Returns total frames captured so far.

## Invariants & Assumptions

1. **Single active manager**: `startImageCapture()` replaces any previous manager via `stopImageCapture()`.
2. **captureInProgress guard**: Only one `toBlob()`/`captureFrame()` call can be in-flight at a time. The flag is always reset by `handleCapturedBlob()` or the `.catch()` handler.
3. **Safety timeout**: If a capture promise doesn't resolve within `captureTimeoutMs` (default 5s), the `captureInProgress` flag is force-reset to prevent permanent pipeline deadlock. This is a belt-and-suspenders defense — normal operation always resolves/rejects the promise.
4. **Suspicious image detection**: If blob size < `MIN_VALID_IMAGE_BYTES` (5000), `onSuspiciousImage` is called. The image is still stored for debugging.
5. **Custom capture function**: When `captureFrame` callback is provided, it's used instead of `canvas.toBlob()`. This supports the "blit" technique for WebXR opaque textures.
6. **Epoch-ms timestamp from frame time**: `CapturedImage.timestamp` is `performance.timeOrigin + time`, where `time` is the XR frame `DOMHighResTimeStamp` passed to `onFrame()`. This keeps it in the exact same epoch-ms time domain as the same-frame AR pose and the other per-frame streams (notably depth samples, which use the identical conversion), avoiding the sub-frame drift that `Date.now()` would introduce.

## Examples

```typescript
import {
  startImageCapture,
  stopImageCapture,
  DEFAULT_CAPTURE_CONFIG,
} from './image-capture';

const manager = startImageCapture(canvas, gl, {
  getCurrentPose: () => currentPose,
  getScreenRotation: () => screen.orientation?.angle ?? 0,
  onCaptured: (image) => storage.writeFrame(image),
  onCaptureFailed: () => log.warn('Capture failed'),
});

// Later
stopImageCapture();
```

## Tests

- Unit tests: `image-capture.test.ts` (30 tests)
- Covers: interval timing, JPEG quality, frameIndex increment, pose data, suspicious image detection, toBlob null handling, custom captureFrame, captureInProgress safety timeout (3 tests), stop() cleanup of safety timeout and captureInProgress (1 test)
