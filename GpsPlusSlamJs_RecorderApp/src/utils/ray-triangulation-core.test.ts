import { describe, expect, test } from 'vitest';
import {
  solveClosestPointOfApproach,
  type Observation,
} from './ray-triangulation-core';

const INV_SQRT2 = 1 / Math.sqrt(2);

describe('solveClosestPointOfApproach', () => {
  // ─── Edge cases ────────────────────────────────────────────────────────────

  test('returns null for empty observation array', () => {
    expect(solveClosestPointOfApproach([])).toBeNull();
  });

  test('returns null for a single ray with no depth prior (under-determined)', () => {
    const obs: Observation[] = [
      {
        ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
        rayWeight: 1,
      },
    ];
    expect(solveClosestPointOfApproach(obs)).toBeNull();
  });

  // ─── Two-ray intersection ──────────────────────────────────────────────────

  test('two exactly intersecting perpendicular rays return the intersection with ~zero rmsError', () => {
    // Ray 1 travels along +X from (-1, 0, 0).
    // Ray 2 travels along +Y from ( 0,-1, 0).
    // They meet at the origin (0, 0, 0).
    const obs: Observation[] = [
      {
        ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
        rayWeight: 1,
      },
      {
        ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
        rayWeight: 1,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(0, 5);
    expect(result!.point.y).toBeCloseTo(0, 5);
    expect(result!.point.z).toBeCloseTo(0, 5);
    expect(result!.rmsError).toBeCloseTo(0, 5);
  });

  test('skew rays return the midpoint of the shortest connecting segment, rmsError = 0.5 m', () => {
    // Ray 1: along +X at z=0  → closest point on ray: (0, 0, 0)
    // Ray 2: along +Y at z=1  → closest point on ray: (0, 0, 1)
    // Midpoint is (0, 0, 0.5). Perpendicular distance from midpoint to each ray = 0.5 m.
    const obs: Observation[] = [
      {
        ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
        rayWeight: 1,
      },
      {
        ray: { origin: { x: 0, y: 0, z: 1 }, direction: { x: 0, y: 1, z: 0 } },
        rayWeight: 1,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(0, 5);
    expect(result!.point.y).toBeCloseTo(0, 5);
    expect(result!.point.z).toBeCloseTo(0.5, 5);
    expect(result!.rmsError).toBeCloseTo(0.5, 5);
  });

  // ─── Weights ───────────────────────────────────────────────────────────────

  test('weights bias the result towards the heavier ray', () => {
    // Ray 1 (z=0 plane) has weight 9; Ray 2 (z=1) has weight 1.
    // Weighted result should be pulled well below z=0.5.
    const obs: Observation[] = [
      {
        ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
        rayWeight: 9,
      },
      {
        ray: { origin: { x: 0, y: 0, z: 1 }, direction: { x: 0, y: 1, z: 0 } },
        rayWeight: 1,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point.z).toBeLessThan(0.5);
  });

  test('a zero-weight ray is fully ignored', () => {
    // The zero-weight ray points in a completely wrong direction.
    // Result should still converge to the intersection of the two valid rays at origin.
    const obs: Observation[] = [
      {
        ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
        rayWeight: 1,
      },
      {
        ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
        rayWeight: 1,
      },
      {
        ray: { origin: { x: 5, y: 5, z: 5 }, direction: { x: 1, y: 0, z: 0 } },
        rayWeight: 0,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(0, 5);
    expect(result!.point.y).toBeCloseTo(0, 5);
    expect(result!.point.z).toBeCloseTo(0, 5);
  });

  // ─── Depth prior ───────────────────────────────────────────────────────────

  test('single ray with a strong depth prior returns approximately the depth point', () => {
    // With only 1 ray, the geometry is under-determined without depth.
    // A strong along-ray depth prior pins the answer on the ray at the given distance.
    const obs: Observation[] = [
      {
        ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
        rayWeight: 1,
        depthPoint: { x: 5, y: 0, z: 0 },
        depthWeight: 10,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(5, 2);
    expect(result!.point.y).toBeCloseTo(0, 2);
    expect(result!.point.z).toBeCloseTo(0, 2);
  });

  test('strong triangulation baseline out-votes weak depth priors', () => {
    // Three rays converge at the origin (0, 0, 0) — directions are normalized.
    // Each carries a weak depth prior pointing toward z=1 — deliberately wrong.
    // The triangulation should win and pull the result near origin.
    const obs: Observation[] = [
      {
        ray: {
          origin: { x: -1, y: 1, z: 0 },
          direction: { x: INV_SQRT2, y: -INV_SQRT2, z: 0 },
        },
        rayWeight: 1,
        depthPoint: { x: 0, y: 0, z: 1 },
        depthWeight: 0.1,
      },
      {
        ray: {
          origin: { x: 1, y: 1, z: 0 },
          direction: { x: -INV_SQRT2, y: -INV_SQRT2, z: 0 },
        },
        rayWeight: 1,
        depthPoint: { x: 0, y: 0, z: 1 },
        depthWeight: 0.1,
      },
      {
        ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
        rayWeight: 1,
        depthPoint: { x: 0, y: 0, z: 1 },
        depthWeight: 0.1,
      },
    ];
    const result = solveClosestPointOfApproach(obs);
    expect(result).not.toBeNull();
    expect(result!.point.z).toBeLessThan(0.5);
  });

  // ─── Uncertainty metric ────────────────────────────────────────────────────

  test('adding more consistent rays lowers the uncertainty', () => {
    const twoRays: Observation[] = [
      {
        ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
        rayWeight: 1,
      },
      {
        ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
        rayWeight: 1,
      },
    ];
    const threeRays: Observation[] = [
      ...twoRays,
      {
        ray: { origin: { x: 0, y: 0, z: -1 }, direction: { x: 0, y: 0, z: 1 } },
        rayWeight: 1,
      },
    ];
    const r2 = solveClosestPointOfApproach(twoRays)!;
    const r3 = solveClosestPointOfApproach(threeRays)!;
    expect(r3.uncertainty).toBeLessThan(r2.uncertainty);
  });

  test('near-parallel rays (tiny baseline) produce higher uncertainty than wide-baseline rays', () => {
    const wideBaseline: Observation[] = [
      {
        ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
        rayWeight: 1,
      },
      {
        ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
        rayWeight: 1,
      },
    ];
    const narrowBaseline: Observation[] = [
      {
        ray: {
          origin: { x: -0.001, y: 0, z: 0 },
          direction: { x: 1, y: 0, z: 0 },
        },
        rayWeight: 1,
      },
      {
        ray: {
          origin: { x: 0.001, y: 0, z: 0 },
          direction: { x: 1, y: 0.001, z: 0 },
        },
        rayWeight: 1,
      },
    ];
    const rWide = solveClosestPointOfApproach(wideBaseline)!;
    const rNarrow = solveClosestPointOfApproach(narrowBaseline)!;
    expect(rNarrow.uncertainty).toBeGreaterThan(rWide.uncertainty);
  });

  // ─── Normalization robustness ──────────────────────────────────────────────

  test('un-normalized input directions produce the same result as pre-normalized ones', () => {
    // Same geometry as the intersecting-perpendicular test but directions scaled by 2.
    const unnormalized: Observation[] = [
      {
        ray: { origin: { x: -1, y: 0, z: 0 }, direction: { x: 2, y: 0, z: 0 } },
        rayWeight: 1,
      },
      {
        ray: { origin: { x: 0, y: -1, z: 0 }, direction: { x: 0, y: 2, z: 0 } },
        rayWeight: 1,
      },
    ];
    const result = solveClosestPointOfApproach(unnormalized);
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(0, 5);
    expect(result!.point.y).toBeCloseTo(0, 5);
    expect(result!.point.z).toBeCloseTo(0, 5);
    expect(result!.rmsError).toBeCloseTo(0, 5);
  });
});
