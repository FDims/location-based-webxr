import { describe, expect, test } from 'vitest';
import {
  evaluateObservation,
  computeAdaptiveThreshold,
  createSeededRng,
  solveRobustTriangulation,
  type MeasurementRayObservation
} from './robust-triangulation';
import type { Observation } from './ray-triangulation-core';

describe('createSeededRng', () => {
  test('produces identical sequences for same seed', () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);
    expect(rng1()).toBe(rng2());
    expect(rng1()).toBe(rng2());
    expect(rng1()).toBe(rng2());
  });

  test('produces different sequences for different seeds', () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(43);
    expect(rng1()).not.toBe(rng2());
  });
});

describe('computeAdaptiveThreshold', () => {
  test('returns baseTolerance at zero range', () => {
    const hypothesis: [number, number, number] = [0, 0, 0];
    const origins: [number, number, number][] = [[0, 0, 0]];
    const threshold = computeAdaptiveThreshold(hypothesis, origins, 0.2, 0.017);
    expect(threshold).toBeCloseTo(0.2, 5);
  });

  test('scales linearly with distance', () => {
    const hypothesis: [number, number, number] = [100, 0, 0];
    const origins: [number, number, number][] = [[0, 0, 0]];
    const baseTol = 0.2;
    const ang = 0.017;
    const threshold = computeAdaptiveThreshold(hypothesis, origins, baseTol, ang);
    // range is 100
    const expected = baseTol + 100 * Math.tan(ang);
    expect(threshold).toBeCloseTo(expected, 5);
  });

  test('averages ranges for multiple cameras', () => {
    const hypothesis: [number, number, number] = [0, 0, 0];
    const origins: [number, number, number][] = [
      [10, 0, 0], // dist 10
      [0, 20, 0], // dist 20
    ];
    const threshold = computeAdaptiveThreshold(hypothesis, origins, 0.2, 0);
    // angle 0 -> tan(0) = 0 -> should just be baseTolerance, wait. 
    // Let's test with non-zero angle.
    const ang = 0.01;
    const threshold2 = computeAdaptiveThreshold(hypothesis, origins, 0.2, ang);
    const expected = 0.2 + 15 * Math.tan(ang);
    expect(threshold2).toBeCloseTo(expected, 5);
  });
});

describe('evaluateObservation', () => {
  const threshold = 0.5;

  test('ray-only observation compares against pure distance', () => {
    const point: [number, number, number] = [0, 0, 0];
    const obs: Observation = {
      ray: { origin: [1, 0, 0], direction: [0, 1, 0] },
      rayWeight: 1,
    };
    // Perpendicular distance from (0,0,0) to ray (origin 1,0,0, dir 0,1,0) is 1.0.
    // 1.0 > threshold (0.5), so outlier.
    const res = evaluateObservation(point, obs, threshold);
    expect(res.isInlier).toBe(false);
    // MSAC score = rayWeight * min(dist^2, thresh^2) = 1 * min(1, 0.25) = 0.25
    expect(res.msacScore).toBeCloseTo(0.25, 5);
  });

  test('depth observation scores both ray and depth correctly', () => {
    const point: [number, number, number] = [2, 0, 0];
    const obs: Observation = {
      ray: { origin: [0, 0, 0], direction: [1, 0, 0] },
      rayWeight: 1,
      depthPoint: [2.2, 0, 0], // depth point is off by 0.2
      depthWeight: 0.5,
    };
    // Ray dist is 0. Depth dist is 0.2. 
    // threshold = 0.5 -> both are < 0.5 -> inlier.
    const res = evaluateObservation(point, obs, threshold);
    expect(res.isInlier).toBe(true);
    // MSAC score = (1 * 0) + (0.5 * 0.2^2) = 0 + 0.5 * 0.04 = 0.02
    expect(res.msacScore).toBeCloseTo(0.02, 5);
  });

  test('large depth error causes outlier even if ray is perfect', () => {
    const point: [number, number, number] = [2, 0, 0];
    const obs: Observation = {
      ray: { origin: [0, 0, 0], direction: [1, 0, 0] },
      rayWeight: 1,
      depthPoint: [5, 0, 0], // off by 3
      depthWeight: 0.1, // very low weight
    };
    // Threshold is 0.5. Depth error is 3.0. 
    const res = evaluateObservation(point, obs, threshold);
    expect(res.isInlier).toBe(false);
    // Even though weight is small, geometric error > threshold -> outlier.
  });
});

describe('solveRobustTriangulation', () => {
  const INV_SQRT2 = 1 / Math.sqrt(2);

  test('Clean multi-ray convergence', () => {
    // 3 rays crossing at origin
    const obs: MeasurementRayObservation[] = [
      { id: '1', timestamp: 0, rayOrigin: [-1, 0, 0], rayDirection: [1, 0, 0], rayWeight: 1 },
      { id: '2', timestamp: 0, rayOrigin: [0, -1, 0], rayDirection: [0, 1, 0], rayWeight: 1 },
      { id: '3', timestamp: 0, rayOrigin: [0, 0, -1], rayDirection: [0, 0, 1], rayWeight: 1 },
    ];
    const res = solveRobustTriangulation(obs);
    expect(res).not.toBeNull();
    expect(res!.point[0]).toBeCloseTo(0, 5);
    expect(res!.point[1]).toBeCloseTo(0, 5);
    expect(res!.point[2]).toBeCloseTo(0, 5);
    expect(res!.inlierIds).toHaveLength(3);
    expect(res!.outlierIds).toHaveLength(0);
    expect(res!.hasSufficientBaseline).toBe(true);
  });

  test('Outlier rejection', () => {
    const obs: MeasurementRayObservation[] = [
      { id: '1', timestamp: 0, rayOrigin: [-1, 0, 0], rayDirection: [1, 0, 0], rayWeight: 1 },
      { id: '2', timestamp: 0, rayOrigin: [0, -1, 0], rayDirection: [0, 1, 0], rayWeight: 1 },
      { id: '3', timestamp: 0, rayOrigin: [0, 0, -1], rayDirection: [0, 0, 1], rayWeight: 1 },
      { id: 'bad', timestamp: 0, rayOrigin: [5, 5, 5], rayDirection: [0, 1, 0], rayWeight: 1 }, // completely off
    ];
    const res = solveRobustTriangulation(obs, { seed: 42 });
    expect(res).not.toBeNull();
    expect(res!.inlierIds).not.toContain('bad');
    expect(res!.outlierIds).toContain('bad');
    expect(res!.point[0]).toBeCloseTo(0, 2);
    expect(res!.point[1]).toBeCloseTo(0, 2);
    expect(res!.point[2]).toBeCloseTo(0, 2);
  });

  test('Single ray with depth prior', () => {
    const obs: MeasurementRayObservation[] = [
      { 
        id: '1', timestamp: 0, 
        rayOrigin: [0, 0, 0], rayDirection: [1, 0, 0], rayWeight: 1,
        depthPoint: [5, 0, 0], depthWeight: 1
      },
    ];
    const res = solveRobustTriangulation(obs);
    expect(res).not.toBeNull();
    expect(res!.point[0]).toBeCloseTo(5, 5);
    expect(res!.hasSufficientBaseline).toBe(false);
  });

  test('Two observations solves directly', () => {
    const obs: MeasurementRayObservation[] = [
      { id: '1', timestamp: 0, rayOrigin: [-1, 0, 0], rayDirection: [1, 0, 0], rayWeight: 1 },
      { id: '2', timestamp: 0, rayOrigin: [0, -1, 0], rayDirection: [0, 1, 0], rayWeight: 1 },
    ];
    const res = solveRobustTriangulation(obs);
    expect(res).not.toBeNull();
    expect(res!.inlierIds).toHaveLength(2);
    // Baseline is distance between [-1,0,0] and [0,-1,0] = sqrt(2) = 1.414 > 0.5 -> true
    expect(res!.hasSufficientBaseline).toBe(true);
  });

  test('Baseline gatekeeping is false for tiny baseline', () => {
    const obs: MeasurementRayObservation[] = [
      { id: '1', timestamp: 0, rayOrigin: [0, 0, 0], rayDirection: [1, 0, 0], rayWeight: 1 },
      { id: '2', timestamp: 0, rayOrigin: [0, 0.01, 0], rayDirection: [1, 0.01, 0], rayWeight: 1 },
      { id: '3', timestamp: 0, rayOrigin: [0, 0, 0.01], rayDirection: [1, 0, 0.01], rayWeight: 1 },
    ];
    const res = solveRobustTriangulation(obs, { seed: 1 });
    expect(res).not.toBeNull();
    expect(res!.hasSufficientBaseline).toBe(false);
  });
});
