/**
 * Depth RGB lookup — pure mapping from a depth point's normalized view
 * coordinates onto a camera-frame pixel buffer (occupancy-grid port plan
 * Iter 8, "RGB voxel coloring").
 *
 * The buffer is the raw output of `readRenderTargetPixels` /
 * `gl.readPixels` (RGBA, **bottom-row-first** — WebGL's y-flip), produced
 * by `CameraBlitCapture.captureToPixels()`. Depth points use view
 * coordinates with y=0 at the TOP, so the lookup flips the row.
 *
 * Known limitation (plan §5 / Iter 8 field-verification item): the camera
 * image's crop/aspect/rotation relative to the XR view is assumed to match
 * — i.e. normalized view coords address the camera frame directly, as on
 * ARCore. Whether that holds for WebXR's `getCameraTexture` can only be
 * verified on-device; any correction (rotation, crop rect) belongs HERE so
 * the convention stays in one place, mirroring `depth-unprojection.ts` for
 * NDC flips.
 *
 * @see depth-rgb-lookup.md for detailed documentation
 */

import type { RgbTuple } from '../types/ar-types';

/**
 * Sample the camera color at normalized view coordinates (0–1, y=0 top).
 * Returns null for out-of-range or non-finite coordinates.
 */
export type RgbLookup = (screenX: number, screenY: number) => RgbTuple | null;

/**
 * Build an {@link RgbLookup} over an RGBA readback buffer.
 *
 * Defensive boundary: returns `null` (no lookup) when the dimensions are
 * not positive integers or the buffer length does not match
 * `width × height × 4` — callers then simply emit color-less points
 * rather than crashing the capture path.
 */
export function createRgbLookup(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): RgbLookup | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.length !== width * height * 4
  ) {
    return null;
  }
  return (screenX, screenY) => {
    if (
      !Number.isFinite(screenX) ||
      !Number.isFinite(screenY) ||
      screenX < 0 ||
      screenX > 1 ||
      screenY < 0 ||
      screenY > 1
    ) {
      return null;
    }
    const col = Math.min(width - 1, Math.floor(screenX * width));
    const rowFromTop = Math.min(height - 1, Math.floor(screenY * height));
    // readPixels buffers are bottom-row-first; view coords are top-first.
    const bufferRow = height - 1 - rowFromTop;
    const i = (bufferRow * width + col) * 4;
    return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
  };
}
