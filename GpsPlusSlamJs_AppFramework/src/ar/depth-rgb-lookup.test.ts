/**
 * Tests for `createRgbLookup` (occupancy-grid port plan Iter 8).
 *
 * Why this test matters:
 * The lookup is the only place that maps a depth point's normalized view
 * coordinates onto the blit-readback pixel buffer. Two silent-corruption
 * hazards live here: WebGL's `readPixels` returns the image bottom-row-first
 * (y-flip), and the buffer is RGBA while consumers want RGB. A wrong mapping
 * would not crash — it would color every voxel with the wrong pixel, which
 * only a careful field test would catch. These tests pin the mapping with a
 * synthetic buffer whose four quadrants have distinct colors.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRgbLookup } from './depth-rgb-lookup';

/**
 * 2×2 RGBA buffer in WebGL readback order (bottom row first):
 *   buffer row 0 = bottom of the image: RED, GREEN
 *   buffer row 1 = top of the image:    BLUE, WHITE
 * Screen layout (y=0 at the top, like depth screenY):
 *   top-left BLUE | top-right WHITE
 *   bottom-left RED | bottom-right GREEN
 */
function makeQuadrantBuffer(): Uint8Array {
  // prettier-ignore
  return new Uint8Array([
    255, 0, 0, 255,   0, 255, 0, 255,   // bottom row: red, green
    0, 0, 255, 255,   255, 255, 255, 255, // top row: blue, white
  ]);
}

describe('createRgbLookup', () => {
  it('maps view coordinates (y=0 top) onto the y-flipped readback buffer', () => {
    const lookup = createRgbLookup(makeQuadrantBuffer(), 2, 2);
    expect(lookup).not.toBeNull();
    expect(lookup!(0.25, 0.25)).toEqual([0, 0, 255]); // top-left → blue
    expect(lookup!(0.75, 0.25)).toEqual([255, 255, 255]); // top-right → white
    expect(lookup!(0.25, 0.75)).toEqual([255, 0, 0]); // bottom-left → red
    expect(lookup!(0.75, 0.75)).toEqual([0, 255, 0]); // bottom-right → green
  });

  it('clamps the 1.0 edge into the last row/column instead of overflowing', () => {
    const lookup = createRgbLookup(makeQuadrantBuffer(), 2, 2)!;
    expect(lookup(1, 1)).toEqual([0, 255, 0]); // bottom-right pixel
    expect(lookup(0, 0)).toEqual([0, 0, 255]); // top-left pixel
  });

  it('returns null for out-of-range or non-finite coordinates', () => {
    const lookup = createRgbLookup(makeQuadrantBuffer(), 2, 2)!;
    expect(lookup(-0.01, 0.5)).toBeNull();
    expect(lookup(0.5, 1.01)).toBeNull();
    expect(lookup(Number.NaN, 0.5)).toBeNull();
    expect(lookup(0.5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rejects invalid buffers and dimensions (defensive boundary)', () => {
    expect(createRgbLookup(new Uint8Array(3), 2, 2)).toBeNull(); // wrong length
    expect(createRgbLookup(makeQuadrantBuffer(), 0, 2)).toBeNull();
    expect(createRgbLookup(makeQuadrantBuffer(), 2, -1)).toBeNull();
    expect(createRgbLookup(makeQuadrantBuffer(), 1.5, 2)).toBeNull();
  });

  /**
   * Property: looking up the center of any pixel returns exactly that
   * pixel's RGB, for arbitrary buffer sizes. Each pixel gets a unique
   * encoded color so an off-by-one in either axis (or a missing y-flip)
   * produces a detectably wrong triple.
   */
  it('property: pixel-center lookups address exactly the encoded pixel', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 143 }),
        (width, height, pick) => {
          const col = pick % width;
          const rowFromTop = Math.floor(pick / width) % height;
          const pixels = new Uint8Array(width * height * 4);
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              // r is the buffer row (bottom-first); encode the TOP-based row
              // so the expectation below is straightforward.
              const topRow = height - 1 - r;
              const i = (r * width + c) * 4;
              pixels[i] = c; // R encodes column
              pixels[i + 1] = topRow; // G encodes row from top
              pixels[i + 2] = 200; // B constant marker
              pixels[i + 3] = 255;
            }
          }
          const lookup = createRgbLookup(pixels, width, height)!;
          const x = (col + 0.5) / width;
          const y = (rowFromTop + 0.5) / height;
          expect(lookup(x, y)).toEqual([col, rowFromTop, 200]);
        }
      )
    );
  });
});
