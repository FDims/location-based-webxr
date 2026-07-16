import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import { solveClosestPointOfApproach, perpendicularDistanceToRay, type Observation } from './ray-triangulation-core';

export interface MeasurementRayObservation {
  id: string;
  timestamp: number;
  rayOrigin: Vector3;
  rayDirection: Vector3;
  rayWeight: number;
  depthPoint?: Vector3;
  depthWeight?: number;
}

export interface RobustTriangulationResult {
  point: Vector3;
  uncertainty: number;
  rmsError: number;
  msacScore: number;
  inlierIds: string[];
  outlierIds: string[];
  hasSufficientBaseline: boolean;
}

export interface RobustTriangulationOptions {
  baseDistanceThreshold?: number;
  angularThresholdRadians?: number;
  iterations?: number;
  seed?: number;
  minBaselineM?: number;
}

/**
 * Calculates pure geometric error and weighted MSAC score for an observation.
 * @returns { isInlier: boolean, msacScore: number }
 */
export function evaluateObservation(
  point: Vector3,
  obs: Observation,
  threshold: number
): { isInlier: boolean; msacScore: number } {
  const rayDist = perpendicularDistanceToRay(point, obs.ray.origin, obs.ray.direction);
  let depthDist = 0;

  if (obs.depthPoint) {
    const pox = point[0] - obs.depthPoint[0];
    const poy = point[1] - obs.depthPoint[1];
    const poz = point[2] - obs.depthPoint[2];
    depthDist = Math.abs(pox * obs.ray.direction[0] + poy * obs.ray.direction[1] + poz * obs.ray.direction[2]);
  }

  const isRayInlier = rayDist <= threshold;
  const isDepthInlier = !obs.depthPoint || depthDist <= threshold;
  const isInlier = isRayInlier && isDepthInlier;

  const rayScore = obs.rayWeight * Math.min(rayDist * rayDist, threshold * threshold);
  const depthScore = (obs.depthPoint && obs.depthWeight)
    ? obs.depthWeight * Math.min(depthDist * depthDist, threshold * threshold)
    : 0;

  return { isInlier, msacScore: rayScore + depthScore };
}

export function computeAdaptiveThreshold(
  hypothesisPoint: Vector3,
  cameraOrigins: Vector3[],
  baseTolerance: number,
  angularThresholdRadians: number
): number {
  if (cameraOrigins.length === 0) return baseTolerance;
  let sumRange = 0;
  for (const origin of cameraOrigins) {
    const dx = hypothesisPoint[0] - origin[0];
    const dy = hypothesisPoint[1] - origin[1];
    const dz = hypothesisPoint[2] - origin[2];
    sumRange += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const avgRange = sumRange / cameraOrigins.length;
  return baseTolerance + avgRange * Math.tan(angularThresholdRadians);
}

export function createSeededRng(seed: number): () => number {
  let state = seed || 1;
  return function () {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function computeBaseline(origins: Vector3[]): number {
  let maxDistSq = 0;
  for (let i = 0; i < origins.length; i++) {
    for (let j = i + 1; j < origins.length; j++) {
      const dx = origins[i][0] - origins[j][0];
      const dy = origins[i][1] - origins[j][1];
      const dz = origins[i][2] - origins[j][2];
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > maxDistSq) maxDistSq = distSq;
    }
  }
  return Math.sqrt(maxDistSq);
}

function angleBetween(dirA: Vector3, dirB: Vector3): number {
  const dot = dirA[0] * dirB[0] + dirA[1] * dirB[1] + dirA[2] * dirB[2];
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/**
 * Main robust estimation function using MSAC.
 */
export function solveRobustTriangulation(
  observations: MeasurementRayObservation[],
  options?: RobustTriangulationOptions
): RobustTriangulationResult | null {
  if (observations.length === 0) return null;

  const baseThreshold = options?.baseDistanceThreshold ?? 0.2;
  const angularThreshold = options?.angularThresholdRadians ?? 0.017;
  const iterations = options?.iterations ?? 100;
  const minBaselineM = options?.minBaselineM ?? 0.5;
  const rng = createSeededRng(options?.seed ?? 12345);

  const coreObs = observations.map(o => ({
    id: o.id,
    obs: {
      ray: { origin: o.rayOrigin, direction: o.rayDirection },
      rayWeight: o.rayWeight,
      depthPoint: o.depthPoint,
      depthWeight: o.depthWeight
    }
  }));

  const cameraOrigins = observations.map(o => o.rayOrigin);

  // Early exit: 1 observation
  if (coreObs.length === 1) {
    if (!coreObs[0].obs.depthPoint || !coreObs[0].obs.depthWeight) return null;
    const res = solveClosestPointOfApproach([coreObs[0].obs]);
    if (!res) return null;
    return {
      point: res.point,
      uncertainty: res.uncertainty,
      rmsError: res.rmsError,
      msacScore: 0,
      inlierIds: [coreObs[0].id],
      outlierIds: [],
      hasSufficientBaseline: false
    };
  }

  // Early exit: 2 observations
  if (coreObs.length === 2) {
    const res = solveClosestPointOfApproach(coreObs.map(o => o.obs));
    if (!res) return null;
    const baseline = computeBaseline(cameraOrigins);
    return {
      point: res.point,
      uncertainty: res.uncertainty,
      rmsError: res.rmsError,
      msacScore: 0,
      inlierIds: coreObs.map(o => o.id),
      outlierIds: [],
      hasSufficientBaseline: baseline >= minBaselineM
    };
  }

  // MSAC Loop
  const depthObs = coreObs.filter(o => o.obs.depthPoint && (o.obs.depthWeight ?? 0) > 0);

  let bestScore = Infinity;
  let bestInliers: string[] = [];
  let bestHypothesis: Vector3 | null = null;

  for (let i = 0; i < iterations; i++) {
    // Generate Hypothesis (Dual Mode)
    // Try Strategy A (1 depth ray) 50% of the time if depth obs exist, else Strategy B (2 rays)
    const useStrategyA = depthObs.length > 0 && rng() < 0.5;
    let hypObs: Observation[] = [];

    if (useStrategyA) {
      const idx = Math.floor(rng() * depthObs.length);
      hypObs = [depthObs[idx].obs];
    } else {
      let validPair = false;
      let attempts = 0;
      while (!validPair && attempts < 10) {
        const idx1 = Math.floor(rng() * coreObs.length);
        let idx2 = Math.floor(rng() * coreObs.length);
        while (idx1 === idx2) idx2 = Math.floor(rng() * coreObs.length);

        const dir1 = coreObs[idx1].obs.ray.direction;
        const dir2 = coreObs[idx2].obs.ray.direction;
        if (angleBetween(dir1, dir2) >= 0.017) { // ~1 degree
          validPair = true;
          hypObs = [coreObs[idx1].obs, coreObs[idx2].obs];
        }
        attempts++;
      }
      if (!validPair) continue; // Skip if we couldn't find a good pair
    }

    const res = solveClosestPointOfApproach(hypObs);
    if (!res) continue;

    const threshold = computeAdaptiveThreshold(res.point, cameraOrigins, baseThreshold, angularThreshold);

    let currentScore = 0;
    let currentInliers: string[] = [];

    for (const item of coreObs) {
      const evalRes = evaluateObservation(res.point, item.obs, threshold);
      currentScore += evalRes.msacScore;
      if (evalRes.isInlier) currentInliers.push(item.id);
    }

    if (currentScore < bestScore) {
      bestScore = currentScore;
      bestInliers = currentInliers;
      bestHypothesis = res.point;
    }
  }

  if (bestInliers.length === 0 || !bestHypothesis) return null;

  // Final Refine
  const finalObs = coreObs.filter(o => bestInliers.includes(o.id)).map(o => o.obs);
  const finalRes = solveClosestPointOfApproach(finalObs);
  if (!finalRes) return null;

  const inlierOrigins = finalObs.map(o => o.ray.origin);
  const baseline = computeBaseline(inlierOrigins);
  const outlierIds = coreObs.filter(o => !bestInliers.includes(o.id)).map(o => o.id);

  return {
    point: finalRes.point,
    uncertainty: finalRes.uncertainty,
    rmsError: finalRes.rmsError,
    msacScore: bestScore,
    inlierIds: bestInliers,
    outlierIds,
    hasSufficientBaseline: baseline >= minBaselineM
  };
}
