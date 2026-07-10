import { describe, it, expect } from 'vitest';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-app-framework/core';
import { unprojectDepthPoint } from 'gps-plus-slam-app-framework/ar/depth-unprojection';
import {
  findDepthPointsInRadius,
  computeEdgePenalty,
  unprojectScreenToCamera,
  transformCameraToWorld,
  computeDepthWeight,
  sampleDepthPrior,
  type DepthPointInput,
  type DepthSampleInput,
} from './depth-prior-provider';

const IDENTITY_ROT: Quaternion = [0, 0, 0, 1];
const ORIGIN: Vector3 = [0, 0, 0];

function createPerspectiveMatrix(fovyRad: number, aspect: number): Matrix4 {
  const f = 1.0 / Math.tan(fovyRad / 2.0);
  const near = 0.1;
  const far = 100;
  const nf = 1.0 / (near - far);
  
  const m = [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ];
  return m as unknown as Matrix4;
}

describe('depth-prior-provider unit tests', () => {
  describe('computeDepthWeight', () => {
    it('value is close to 1.0 at 0m', () => {
      expect(computeDepthWeight(0, 2.0)).toBe(1.0);
    });

    it('value is exactly 0.5 at referenceRangeM', () => {
      expect(computeDepthWeight(2.0, 2.0)).toBe(0.5);
    });

    it('decays toward 0 rapidly at long range (quartic drop-off)', () => {
      expect(computeDepthWeight(4.0, 2.0)).toBeCloseTo(0.0588235, 6);
      expect(computeDepthWeight(10.0, 2.0)).toBeCloseTo(0.001597, 6);
    });

    it('is strictly monotonically decreasing with distance', () => {
      let lastWeight = computeDepthWeight(0.1, 2.0);
      for (let d = 0.2; d <= 10.0; d += 0.1) {
        const weight = computeDepthWeight(d, 2.0);
        expect(weight).toBeLessThan(lastWeight);
        lastWeight = weight;
      }
    });

    it('returns 0 for negative / NaN / Infinity depthM', () => {
      expect(computeDepthWeight(-1, 2.0)).toBe(0);
      expect(computeDepthWeight(NaN, 2.0)).toBe(0);
      expect(computeDepthWeight(Infinity, 2.0)).toBe(0);
    });

    it('returns 0 for non-positive referenceRangeM', () => {
      expect(computeDepthWeight(2.0, 0)).toBe(0);
      expect(computeDepthWeight(2.0, -1)).toBe(0);
      expect(computeDepthWeight(2.0, NaN)).toBe(0);
    });

    it('always produces a value in [0, 1]', () => {
      for (const d of [0, 0.5, 1, 2, 5, 20]) {
        const w = computeDepthWeight(d, 2.0);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('findDepthPointsInRadius', () => {
    it('returns empty array if points is empty', () => {
      expect(findDepthPointsInRadius([], 0.5, 0.5, 0.15)).toEqual([]);
    });

    it('returns all points within Euclidean distance maxDist in screen coords', () => {
      const points: DepthPointInput[] = [
        { screenX: 0.5, screenY: 0.5, depthM: 1 },
        { screenX: 0.6, screenY: 0.5, depthM: 2 },
        { screenX: 0.5, screenY: 0.6, depthM: 3 },
        { screenX: 0.6, screenY: 0.6, depthM: 4 },
        { screenX: 0.7, screenY: 0.5, depthM: 5 },
      ];
      const result = findDepthPointsInRadius(points, 0.5, 0.5, 0.15);
      expect(result).toHaveLength(4);
      expect(result).toContain(points[0]);
      expect(result).toContain(points[1]);
      expect(result).toContain(points[2]);
      expect(result).toContain(points[3]);
      expect(result).not.toContain(points[4]);
    });
  });

  describe('computeEdgePenalty', () => {
    it('returns 1.0 for single point (no variance)', () => {
      const pts = [{ screenX: 0.5, screenY: 0.5, depthM: 2.0 }];
      expect(computeEdgePenalty(pts, 0.5)).toBe(1.0);
    });

    it('returns 1.0 for multiple points with identical depths (flat surface)', () => {
      const pts = [
        { screenX: 0.5, screenY: 0.5, depthM: 2.0 },
        { screenX: 0.6, screenY: 0.5, depthM: 2.0 },
        { screenX: 0.5, screenY: 0.6, depthM: 2.0 },
      ];
      expect(computeEdgePenalty(pts, 0.5)).toBe(1.0);
    });

    it('returns 0.0 if standard deviation matches or exceeds maxAllowedDepthStdDevM', () => {
      const pts = [
        { screenX: 0.5, screenY: 0.5, depthM: 1.0 },
        { screenX: 0.5, screenY: 0.6, depthM: 2.0 },
      ];
      expect(computeEdgePenalty(pts, 0.5)).toBe(0.0);
      expect(computeEdgePenalty(pts, 0.4)).toBe(0.0);
    });

    it('returns a linear gradient factor for standard deviations between 0 and the max limit', () => {
      const pts = [
        { screenX: 0.5, screenY: 0.5, depthM: 1.25 },
        { screenX: 0.5, screenY: 0.6, depthM: 1.75 },
      ];
      expect(computeEdgePenalty(pts, 0.5)).toBe(0.5);
    });
  });

  describe('unprojectScreenToCamera', () => {
    it('crosshair centre (0.5, 0.5) with centred projection -> x=0, y=0, z=-depth', () => {
      const p = createPerspectiveMatrix(Math.PI / 3, 16 / 9);
      const result = unprojectScreenToCamera(0.5, 0.5, 3.0, p);
      expect(result).not.toBeNull();
      expect(result![0]).toBeCloseTo(0, 6);
      expect(result![1]).toBeCloseTo(0, 6);
      expect(result![2]).toBeCloseTo(-3.0, 6);
    });

    it('top-left corner (0, 0) unprojects correctly', () => {
      const p = createPerspectiveMatrix(Math.PI / 3, 1.0);
      const result = unprojectScreenToCamera(0.0, 0.0, 2.0, p);
      expect(result).not.toBeNull();
      expect(result![0]).toBeLessThan(0);
      expect(result![1]).toBeGreaterThan(0);
      expect(result![2]).toBeCloseTo(-2.0, 6);
    });

    it('bottom-right corner (1, 1) unprojects symmetrically to top-left', () => {
      const p = createPerspectiveMatrix(Math.PI / 3, 1.0);
      const tl = unprojectScreenToCamera(0.0, 0.0, 2.0, p)!;
      const br = unprojectScreenToCamera(1.0, 1.0, 2.0, p)!;
      expect(br[0]).toBeCloseTo(-tl[0], 6);
      expect(br[1]).toBeCloseTo(-tl[1], 6);
      expect(br[2]).toBeCloseTo(tl[2], 6);
    });

    it('output scales linearly with depth', () => {
      const p = createPerspectiveMatrix(Math.PI / 3, 16 / 9);
      const pt1 = unprojectScreenToCamera(0.2, 0.3, 2.0, p)!;
      const pt2 = unprojectScreenToCamera(0.2, 0.3, 4.0, p)!;
      expect(pt2[0]).toBeCloseTo(pt1[0] * 2.0, 6);
      expect(pt2[1]).toBeCloseTo(pt1[1] * 2.0, 6);
      expect(pt2[2]).toBeCloseTo(pt1[2] * 2.0, 6);
    });

    it('returns null for degenerate projection (zero focal length)', () => {
      const degenerate: Matrix4 = new Array(16).fill(0) as unknown as Matrix4;
      expect(unprojectScreenToCamera(0.5, 0.5, 2.0, degenerate)).toBeNull();
    });

    it('returns null for non-finite projection values', () => {
      const bad: Matrix4 = [
        NaN, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ] as unknown as Matrix4;
      expect(unprojectScreenToCamera(0.5, 0.5, 2.0, bad)).toBeNull();
    });
  });

  describe('transformCameraToWorld', () => {
    it('identity rotation leaves camera point unchanged except translation', () => {
      const camPt: Vector3 = [1, 2, -3];
      const camPos: Vector3 = [10, 20, 30];
      const result = transformCameraToWorld(camPt, camPos, IDENTITY_ROT);
      expect(result).toEqual([11, 22, 27]);
    });

    it('90 deg Y-axis rotation maps X-unit vector to -Z', () => {
      const halfAngle = Math.PI / 4;
      const rotY90: Quaternion = [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)];
      const camPt: Vector3 = [1, 0, 0];
      const result = transformCameraToWorld(camPt, ORIGIN, rotY90);
      expect(result[0]).toBeCloseTo(0, 6);
      expect(result[1]).toBeCloseTo(0, 6);
      expect(result[2]).toBeCloseTo(-1, 6);
    });
  });

  describe('sampleDepthPrior integration', () => {
    const p = createPerspectiveMatrix(Math.PI / 3, 16 / 9);
    const validSample: DepthSampleInput = {
      points: [
        { screenX: 0.5, screenY: 0.5, depthM: 2.0 },
        { screenX: 0.51, screenY: 0.5, depthM: 2.0 },
      ],
      projectionMatrix: p,
      cameraPos: ORIGIN,
      cameraRot: IDENTITY_ROT,
    };

    it('returns null for null sample', () => {
      expect(sampleDepthPrior(null, 0.5, 0.5)).toBeNull();
    });

    it('returns null for undefined sample', () => {
      expect(sampleDepthPrior(undefined, 0.5, 0.5)).toBeNull();
    });

    it('returns null when projectionMatrix is absent', () => {
      const badSample = { ...validSample, projectionMatrix: undefined };
      expect(sampleDepthPrior(badSample, 0.5, 0.5)).toBeNull();
    });

    it('returns null when no depth point within maxScreenDist', () => {
      expect(sampleDepthPrior(validSample, 0.8, 0.8, { maxScreenDist: 0.05 })).toBeNull();
    });

    it('returns null for depthM <= 0', () => {
      const sampleWithZero: DepthSampleInput = {
        ...validSample,
        points: [{ screenX: 0.5, screenY: 0.5, depthM: 0.0 }],
      };
      expect(sampleDepthPrior(sampleWithZero, 0.5, 0.5)).toBeNull();
    });

    it('returns null if edge penalty drops to 0 due to high standard deviation', () => {
      const noisySample: DepthSampleInput = {
        ...validSample,
        points: [
          { screenX: 0.5, screenY: 0.5, depthM: 1.0 },
          { screenX: 0.51, screenY: 0.5, depthM: 2.0 },
        ],
      };
      expect(sampleDepthPrior(noisySample, 0.5, 0.5, { maxScreenDist: 0.1, maxAllowedDepthStdDevM: 0.4 })).toBeNull();
    });

    it('valid observation for flat neighbourhood crosshair at 2m has weight=0.5, point=[0,0,-2]', () => {
      const result = sampleDepthPrior(validSample, 0.5, 0.5, { referenceRangeM: 2.0 });
      expect(result).not.toBeNull();
      expect(result!.weight).toBe(0.5);
      expect(result!.depthM).toBe(2.0);
      expect(result!.point[0]).toBeCloseTo(0, 6);
      expect(result!.point[1]).toBeCloseTo(0, 6);
      expect(result!.point[2]).toBeCloseTo(-2.0, 6);
    });

    it('weight is close to 1.0 for very near depth in flat neighbourhood', () => {
      const nearSample: DepthSampleInput = {
        ...validSample,
        points: [{ screenX: 0.5, screenY: 0.5, depthM: 0.1 }],
      };
      const result = sampleDepthPrior(nearSample, 0.5, 0.5, { referenceRangeM: 2.0 });
      expect(result).not.toBeNull();
      expect(result!.weight).toBeCloseTo(1.0, 3);
    });

    it('weight collapses to near 0 for far target', () => {
      const farSample: DepthSampleInput = {
        ...validSample,
        points: [{ screenX: 0.5, screenY: 0.5, depthM: 10.0 }],
      };
      const result = sampleDepthPrior(farSample, 0.5, 0.5, { referenceRangeM: 2.0 });
      expect(result).not.toBeNull();
      expect(result!.weight).toBeLessThan(0.002);
    });

    it('picks the nearest depth point from the radius neighbourhood for unprojection', () => {
      const multiPoints: DepthSampleInput = {
        ...validSample,
        points: [
          { screenX: 0.52, screenY: 0.5, depthM: 1.5 },
          { screenX: 0.505, screenY: 0.5, depthM: 1.8 },
        ],
      };
      const result = sampleDepthPrior(multiPoints, 0.5, 0.5);
      expect(result).not.toBeNull();
      expect(result!.depthM).toBe(1.8);
    });
  });

  describe('equivalence to framework unprojectDepthPoint', () => {
    it('yields identical coordinates to the framework unprojector across random inputs', () => {
      const p = createPerspectiveMatrix(Math.PI / 3, 16 / 9);
      const camPos: Vector3 = [1.2, -4.5, 8.9];
      const halfAngle = Math.PI / 6;
      const camRot: Quaternion = [0.1, Math.sin(halfAngle), -0.2, Math.cos(halfAngle)];

      const testCases = [
        { screenX: 0.5, screenY: 0.5, depthM: 2.0 },
        { screenX: 0.25, screenY: 0.75, depthM: 0.5 },
        { screenX: 0.9, screenY: 0.1, depthM: 12.0 },
        { screenX: 0.1, screenY: 0.4, depthM: 4.2 },
      ];

      for (const tc of testCases) {
        const cameraPt = unprojectScreenToCamera(tc.screenX, tc.screenY, tc.depthM, p);
        expect(cameraPt).not.toBeNull();
        const customWorldPt = transformCameraToWorld(cameraPt!, camPos, camRot);

        const frameworkWorldPt = unprojectDepthPoint(tc, camPos, camRot, p);
        expect(frameworkWorldPt).not.toBeNull();

        expect(customWorldPt[0]).toBeCloseTo(frameworkWorldPt![0], 6);
        expect(customWorldPt[1]).toBeCloseTo(frameworkWorldPt![1], 6);
        expect(customWorldPt[2]).toBeCloseTo(frameworkWorldPt![2], 6);
      }
    });
  });
});
