/**
 * Camera frame source — a GENERIC throttled RGBA camera-frame feed for
 * computer-vision consumers (QR detection today; object detection / OpenCV
 * tomorrow). Framework-wiring-options Part A / B2.
 *
 * Mirrors {@link DepthSampler}'s shape: a per-XR-frame `onFrame(timestamp)`
 * tick that, **only when `intervalMs` has elapsed**, performs an injected
 * `capture()` (the GPU blit → top-left RGBA) and hands the result to
 * `onCapture`. Throttling the *capture itself* — not just the downstream detect
 * — is the efficiency win the in-session wiring unlocks (§A.4): on a 60 fps
 * device the blit runs ~8×/s instead of every render frame.
 *
 * **Single cadence owner (Option A).** When a {@link createDetectionScheduler}
 * (QR controller, object detector, …) is driven from this source, the source
 * should be the ONE place that sets the cadence: give it the detection
 * `intervalMs` and set the scheduler's own `minIntervalMs` to `0`. The
 * scheduler's coalescing still prevents overlapping in-flight detects, so every
 * delivered frame is detected without a second throttle dropping boundary
 * frames. (Two equal throttles in series let jitter drop ~1 frame per cycle.)
 *
 * `capture` is injected (not a hard dependency on `CameraBlitCapture` /
 * `WebGLRenderer`) so the throttle is pure-logic unit-testable without a GPU —
 * see `camera-frame-source.test.ts`, which pins the cadence as a performance
 * regression test.
 *
 * @see camera-blit-capture.ts — `captureToRgba` (the production `capture`).
 * @see webxr-session.ts — owns the camera-frame blit and wires this in the frame loop.
 */

import type { RgbaImage } from './qr-frontend.js';

/** Tuning for the camera frame source. */
export interface CameraFrameSourceConfig {
  /**
   * Minimum interval between captures in milliseconds. Default 125 ms (≈ 8 Hz),
   * the plan §9 5–10 Hz detection target. The capture (and therefore the blit)
   * fires at most once per `intervalMs`.
   */
  intervalMs: number;
}

/** Injected I/O for the camera frame source. */
export interface CameraFrameSourceCallbacks {
  /**
   * Capture the current XR frame as top-left-origin RGBA, or `null` when no
   * frame is available (no camera texture yet, GL failure). This is the GPU
   * blit + readback; the source only invokes it at the throttled cadence so
   * the cost is bounded. A `null` return does NOT consume the interval slot —
   * the next frame retries immediately (a missing texture is transient).
   */
  capture: () => RgbaImage | null;
  /** Receive a throttled, successfully-captured frame. */
  onCapture: (image: RgbaImage) => void;
}

const DEFAULT_CONFIG: CameraFrameSourceConfig = {
  intervalMs: 125,
};

/**
 * Throttled RGBA capturer. Construct with the injected `capture`/`onCapture`
 * pair, `start()`, then call `onFrame(timestamp)` once per XR frame.
 */
export class CameraFrameSource {
  private readonly callbacks: CameraFrameSourceCallbacks;
  private readonly config: CameraFrameSourceConfig;
  private running = false;
  private captureCount = 0;
  private lastCaptureTime = -Infinity;

  constructor(
    callbacks: CameraFrameSourceCallbacks,
    config?: Partial<CameraFrameSourceConfig>
  ) {
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Begin throttling. Resets the cadence so the first tick captures. */
  start(): void {
    this.running = true;
    this.captureCount = 0;
    this.lastCaptureTime = -Infinity;
  }

  /** Stop capturing. `onFrame` becomes a no-op until `start()` is called again. */
  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Number of frames successfully captured + delivered since `start()`. */
  getFrameCount(): number {
    return this.captureCount;
  }

  getConfig(): CameraFrameSourceConfig {
    return { ...this.config };
  }

  /**
   * Apply partial config (e.g. the app's detection cadence). Invalid values
   * are ignored defensively — `intervalMs` requires a finite positive number.
   */
  updateConfig(config: Partial<CameraFrameSourceConfig>): void {
    if (
      typeof config.intervalMs === 'number' &&
      Number.isFinite(config.intervalMs) &&
      config.intervalMs > 0
    ) {
      this.config.intervalMs = config.intervalMs;
    }
  }

  /**
   * Per-XR-frame tick. Captures + delivers a frame at most once per
   * `intervalMs`; otherwise a cheap no-op so it is safe to call every frame.
   *
   * @param timestamp - monotonic frame time in ms (the XR `time` argument).
   */
  onFrame(timestamp: number): void {
    if (!this.running) {
      return;
    }
    if (timestamp - this.lastCaptureTime < this.config.intervalMs) {
      return;
    }

    // Interval elapsed — do the (expensive) capture now. A null result is a
    // transient missing-texture; do NOT consume the slot so the next frame
    // retries rather than waiting another full interval.
    const image = this.captureSafely();
    if (!image) {
      return;
    }

    this.lastCaptureTime = timestamp;
    this.captureCount++;
    this.callbacks.onCapture(image);
  }

  /**
   * Run the injected capture, guarded so a blit failure (e.g. GL context loss)
   * can never throw out of the XR frame loop — it degrades to "no frame this
   * tick", exactly like a missing texture.
   */
  private captureSafely(): RgbaImage | null {
    try {
      return this.callbacks.capture();
    } catch {
      return null;
    }
  }
}
