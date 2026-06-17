/**
 * Bilinear depth lookup over the regular {@link DepthSampler} grid (WS-A 2a).
 *
 * The depth sampler emits a `gridSize × gridSize` lattice of {@link DepthPoint}s
 * at the fixed screen positions `((col+1)/(g+1), (row+1)/(g+1))` (row-major:
 * index `row·g + col`). Consumers that need depth at an ARBITRARY screen point
 * (e.g. the QR size measurer sampling across a small QR face) previously snapped
 * to the NEAREST node — so every point of a sub-cell QR collapsed onto one depth.
 * This helper instead **bilinearly interpolates** the four surrounding nodes, so
 * depth varies smoothly across the face and the dense plane fit sees the real
 * local depth gradient (tilt) rather than a single borrowed value.
 *
 * Pure (no WebXR): it operates on an already-sampled grid, so it is fully unit-
 * testable and shared by any consumer (demo, Recorder).
 *
 * @see depth-sampler.ts — produces the grid this reads.
 * @see qr-size-measurer.ts — the primary consumer (the dense-fit lattice).
 */

import type { DepthPoint } from '../types/ar-types.js';

export interface DepthGridLookup {
  /**
   * Bilinearly-interpolated depth (m) at a normalized screen point (top-left
   * origin), or `null` when the point is outside the node grid or any of the
   * four surrounding nodes has no valid (finite, positive) depth.
   */
  depthAt(screenX: number, screenY: number): number | null;
}

/** A node's depth if finite and positive, else `null` (a grid hole). */
function validDepth(
  points: readonly DepthPoint[],
  index: number
): number | null {
  const p = points[index];
  if (!p) return null;
  const d = p.depthM;
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * Build a bilinear lookup over a depth-sampler grid.
 *
 * @param points - the grid `DepthPoint`s (row-major, `row·g + col`).
 * @param gridSize - points-per-side; inferred as `round(√points.length)` when
 *   omitted (the sampler always emits a full `g²` grid).
 */
export function createDepthGridLookup(
  points: readonly DepthPoint[],
  gridSize?: number
): DepthGridLookup {
  const g = gridSize ?? Math.round(Math.sqrt(points.length));

  // Too small for bilinear: degrade to "nearest valid node" (or always-null).
  if (g < 2 || points.length < g * g) {
    return {
      depthAt(): number | null {
        for (let i = 0; i < points.length; i++) {
          const d = validDepth(points, i);
          if (d !== null) return d;
        }
        return null;
      },
    };
  }

  return {
    depthAt(screenX: number, screenY: number): number | null {
      // Invert node position `(i+1)/(g+1)` → continuous grid coordinate.
      const gx = screenX * (g + 1) - 1;
      const gy = screenY * (g + 1) - 1;
      // Outside the node bounding box → no interpolation (avoid extrapolation).
      if (gx < 0 || gx > g - 1 || gy < 0 || gy > g - 1) return null;
      const col0 = Math.min(Math.floor(gx), g - 2);
      const row0 = Math.min(Math.floor(gy), g - 2);
      const fx = gx - col0;
      const fy = gy - row0;
      const d00 = validDepth(points, row0 * g + col0);
      const d10 = validDepth(points, row0 * g + col0 + 1);
      const d01 = validDepth(points, (row0 + 1) * g + col0);
      const d11 = validDepth(points, (row0 + 1) * g + col0 + 1);
      if (d00 === null || d10 === null || d01 === null || d11 === null) {
        return null; // a hole among the 4 → don't interpolate across it
      }
      const top = d00 + (d10 - d00) * fx;
      const bottom = d01 + (d11 - d01) * fx;
      return top + (bottom - top) * fy;
    },
  };
}
