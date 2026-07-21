export type CoachingPrompt =
  | 'none'
  | 'move_sideways'
  | 'add_more_rays'
  | 'reaim_target'
  | 'ready_to_confirm';

export type DraftStatus =
  | 'idle'
  | 'provisional'
  | 'refining'
  | 'ready'
  | 'confirm_pending'
  | 'confirm_failed'
  | 'confirmed';

export interface QualityInputs {
  uncertainty: number | null;
  rmsError: number | null;
  baselineM: number;
  rayCount: number;
  inlierCount: number;
  hasSolvedPoint: boolean;
  solverDegenerate: boolean;
  observationAgeMs: number;
  poseDepthTimeSkewMs: number;
}

export interface QualityThresholds {
  thresholdProfileId: string; // stable policy id used for replay binding
  thresholdVersion: number; // monotonic policy version
  minInliers: number; // e.g. 2 or 3
  minBaselineM: number; // e.g. 1.5m short-range, 5m long-range profile
  targetUncertainty: number; // desired confidence band
  maxUncertaintyHard: number; // absolute confirm block
  maxRmsError: number; // residual quality cap
  maxObservationAgeMs: number; // freshness bound for the latest observation bundle
  maxPoseDepthSkewMs: number; // allowed pose-depth timestamp skew
  readyEnterScore: number; // hysteresis enter
  readyExitScore: number; // hysteresis exit
}

export interface QualityEvaluation {
  score: number; // [0,1]
  ready: boolean;
  hardBlocked: boolean;
  prompt: CoachingPrompt;
  reasons: string[];
}

export interface LiveMeasurementDraft {
  status: DraftStatus;
  provisionalPointAr?: { x: number; y: number; z: number };
  uncertainty?: number;
  prompt: CoachingPrompt;
  canConfirm: boolean;
  lastQualityScore: number;
  thresholdProfileId: string;
  thresholdVersion: number;
}

export type LiveMeasurementEvent =
  | { type: 'observationAdded' }
  | { type: 'confirmRequested' }
  | { type: 'confirmSucceeded' }
  | { type: 'confirmFailed' }
  | { type: 'cancelDraft' }
  | { type: 'retargetDraft' }
  | { type: 'removeLastRay' }
  | { type: 'resetAfterConfirmFailed' };

function clamp01(val: number) {
  return Math.max(0, Math.min(1, val));
}

export function evaluateMeasurementQuality(
  inputs: QualityInputs,
  thresholds: QualityThresholds,
  wasReady: boolean
): QualityEvaluation {
  const reasons: string[] = [];
  
  if (
    !isFinite(thresholds.minInliers) || thresholds.minInliers < 1 ||
    !isFinite(thresholds.minBaselineM) || thresholds.minBaselineM < 0 ||
    !isFinite(thresholds.targetUncertainty) || thresholds.targetUncertainty < 0 ||
    !isFinite(thresholds.maxUncertaintyHard) || thresholds.maxUncertaintyHard < 0 ||
    !isFinite(thresholds.maxRmsError) || thresholds.maxRmsError < 0 ||
    !isFinite(thresholds.maxObservationAgeMs) || thresholds.maxObservationAgeMs < 0 ||
    !isFinite(thresholds.maxPoseDepthSkewMs) || thresholds.maxPoseDepthSkewMs < 0 ||
    !isFinite(thresholds.readyEnterScore) || thresholds.readyEnterScore < 0 ||
    !isFinite(thresholds.readyExitScore) || thresholds.readyExitScore < 0 ||
    thresholds.readyEnterScore <= thresholds.readyExitScore ||
    thresholds.maxUncertaintyHard <= thresholds.targetUncertainty
  ) {
    throw new Error('Invalid thresholds configuration');
  }

  let hasInvalidInput = false;
  if (
    (inputs.uncertainty !== null && !isFinite(inputs.uncertainty)) ||
    (inputs.rmsError !== null && !isFinite(inputs.rmsError)) ||
    !isFinite(inputs.baselineM) || inputs.baselineM < 0 ||
    !isFinite(inputs.rayCount) || inputs.rayCount < 0 ||
    !isFinite(inputs.inlierCount) || inputs.inlierCount < 0 ||
    !isFinite(inputs.observationAgeMs) || inputs.observationAgeMs < 0 ||
    !isFinite(inputs.poseDepthTimeSkewMs) || inputs.poseDepthTimeSkewMs < 0
  ) {
    hasInvalidInput = true;
  }

  if (hasInvalidInput) {
    reasons.push('invalid_input');
    const evalState = {
      score: 0,
      ready: false,
      hardBlocked: true,
      prompt: 'none' as CoachingPrompt,
      reasons,
    };
    evalState.prompt = decideCoachingPrompt(inputs, evalState);
    return evalState;
  }

  let hardBlocked = false;
  
  if (!inputs.hasSolvedPoint) {
    hardBlocked = true;
    reasons.push('no_solved_point');
  } else if (inputs.solverDegenerate) {
    hardBlocked = true;
    reasons.push('solver_degenerate');
  } else if (inputs.observationAgeMs > thresholds.maxObservationAgeMs) {
    hardBlocked = true;
    reasons.push('stale_observation');
  } else if (inputs.poseDepthTimeSkewMs > thresholds.maxPoseDepthSkewMs) {
    hardBlocked = true;
    reasons.push('pose_depth_time_skew');
  } else if (inputs.inlierCount < thresholds.minInliers) {
    hardBlocked = true;
    reasons.push('insufficient_inliers');
  } else if (inputs.uncertainty === null || inputs.uncertainty > thresholds.maxUncertaintyHard) {
    hardBlocked = true;
    reasons.push('uncertainty_too_high');
  } else if (inputs.rmsError !== null && inputs.rmsError > thresholds.maxRmsError) {
    hardBlocked = true;
    reasons.push('residual_too_high');
  }

  const uRaw = inputs.uncertainty === null ? 0 : 1 - (inputs.uncertainty / thresholds.maxUncertaintyHard);
  const u = clamp01(uRaw);
  const b = clamp01(inputs.baselineM / thresholds.minBaselineM);
  
  let r = 0.5;
  if (inputs.rmsError !== null) {
    r = clamp01(1 - (inputs.rmsError / thresholds.maxRmsError));
  }
  
  const i = clamp01(inputs.inlierCount / thresholds.minInliers);

  reasons.push(`u:${(Math.floor(u * 10) / 10).toFixed(1)}`);
  reasons.push(`b:${(Math.floor(b * 10) / 10).toFixed(1)}`);
  reasons.push(`r:${(Math.floor(r * 10) / 10).toFixed(1)}`);
  reasons.push(`i:${(Math.floor(i * 10) / 10).toFixed(1)}`);

  const score = clamp01(0.45 * u + 0.30 * b + 0.15 * r + 0.10 * i);

  let ready = false;
  if (hardBlocked) {
    ready = false;
  } else {
    if (!wasReady) {
      ready = score >= thresholds.readyEnterScore;
    } else {
      ready = score >= thresholds.readyExitScore;
    }
  }

  if (!wasReady && ready) {
    reasons.push('entered_ready');
  } else if (wasReady && !ready) {
    reasons.push('exited_ready');
  } else {
    reasons.push('steady');
  }

  const evalState = {
    score,
    ready,
    hardBlocked,
    prompt: 'none' as CoachingPrompt,
    reasons
  };

  evalState.prompt = decideCoachingPrompt(inputs, evalState);

  return evalState;
}

export function decideCoachingPrompt(
  inputs: QualityInputs,
  evaluation: QualityEvaluation
): CoachingPrompt {
  const reasons = evaluation.reasons || [];
  const noSolvedPoint = reasons.includes('no_solved_point');
  const solverDegenerate = reasons.includes('solver_degenerate');
  
  if (evaluation.hardBlocked && (noSolvedPoint || solverDegenerate)) {
    return 'add_more_rays';
  }

  const getSignal = (prefix: string): number => {
    const reason = reasons.find(r => r.startsWith(prefix));
    return reason ? parseFloat(reason.split(':')[1]) : 1.0;
  };

  const b = getSignal('b:');
  const u = getSignal('u:');
  const r = getSignal('r:');
  const i = getSignal('i:');

  if (b < 0.7 && u < 0.6) {
    return 'move_sideways';
  }

  if (r < 0.5) {
    return 'reaim_target';
  }

  if (i < 1.0) {
    return 'add_more_rays';
  }

  if (evaluation.ready) {
    return 'ready_to_confirm';
  }

  return 'add_more_rays';
}

export function reduceLiveMeasurementDraft(
  current: LiveMeasurementDraft,
  inputs: QualityInputs,
  thresholds: QualityThresholds,
  event: LiveMeasurementEvent = { type: 'observationAdded' }
): LiveMeasurementDraft {
  const next: LiveMeasurementDraft = { ...current };

  if (event.type === 'cancelDraft') {
    if (current.status !== 'confirmed') {
      return {
        status: 'idle',
        prompt: 'none',
        canConfirm: false,
        lastQualityScore: 0,
        thresholdProfileId: thresholds.thresholdProfileId,
        thresholdVersion: thresholds.thresholdVersion,
      };
    }
    return next;
  }

  if (event.type === 'resetAfterConfirmFailed') {
    if (current.status === 'confirm_failed') {
      return {
        status: 'idle',
        prompt: 'none',
        canConfirm: false,
        lastQualityScore: 0,
        thresholdProfileId: thresholds.thresholdProfileId,
        thresholdVersion: thresholds.thresholdVersion,
      };
    }
    return next;
  }

  if (event.type === 'confirmRequested') {
    if (current.status === 'ready') {
      next.status = 'confirm_pending';
      next.canConfirm = false;
    }
    return next;
  }

  if (event.type === 'confirmSucceeded') {
    if (current.status === 'confirm_pending') {
      next.status = 'confirmed';
      next.canConfirm = false;
    }
    return next;
  }

  if (event.type === 'confirmFailed') {
    if (current.status === 'confirm_pending') {
      next.status = 'confirm_failed';
      next.canConfirm = true;
    }
    return next;
  }

  if (event.type === 'retargetDraft') {
    if (['provisional', 'refining', 'ready'].includes(current.status)) {
      next.status = 'provisional';
      next.lastQualityScore = 0;
      next.prompt = 'none';
      next.canConfirm = false;
    }
    return next;
  }

  const wasReady = current.status === 'ready' || current.status === 'confirm_pending' || current.status === 'confirm_failed';
  
  const evaluation = evaluateMeasurementQuality(inputs, thresholds, wasReady);

  next.lastQualityScore = evaluation.score;
  next.prompt = evaluation.prompt;
  next.canConfirm = evaluation.ready && !evaluation.hardBlocked;
  next.thresholdProfileId = thresholds.thresholdProfileId;
  next.thresholdVersion = thresholds.thresholdVersion;

  if (inputs.hasSolvedPoint && inputs.uncertainty !== null) {
    next.uncertainty = inputs.uncertainty;
  }

  if (event.type === 'observationAdded' || event.type === 'removeLastRay') {
    if (current.status === 'idle') {
      if (inputs.hasSolvedPoint) {
        next.status = 'provisional';
      }
    } else if (['provisional', 'refining', 'ready', 'confirm_failed'].includes(current.status)) {
      if (evaluation.ready && !evaluation.hardBlocked) {
        next.status = 'ready';
      } else {
        next.status = 'refining';
      }
    }
  }

  return next;
}

export function computeLateralBaselineM(
  rayOrigins: readonly { x: number; y: number; z: number }[],
  meanRayDirection: { x: number; y: number; z: number }
): number {
  if (rayOrigins.length < 2) return 0;
  
  const len = Math.sqrt(
    meanRayDirection.x * meanRayDirection.x +
    meanRayDirection.y * meanRayDirection.y +
    meanRayDirection.z * meanRayDirection.z
  );
  
  if (len === 0) return 0;

  const dir = {
    x: meanRayDirection.x / len,
    y: meanRayDirection.y / len,
    z: meanRayDirection.z / len
  };

  let maxDistSq = 0;
  for (let i = 0; i < rayOrigins.length; i++) {
    for (let j = i + 1; j < rayOrigins.length; j++) {
      const dx = rayOrigins[i].x - rayOrigins[j].x;
      const dy = rayOrigins[i].y - rayOrigins[j].y;
      const dz = rayOrigins[i].z - rayOrigins[j].z;

      const dot = dx * dir.x + dy * dir.y + dz * dir.z;

      const latX = dx - dot * dir.x;
      const latY = dy - dot * dir.y;
      const latZ = dz - dot * dir.z;

      const distSq = latX * latX + latY * latY + latZ * latZ;
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
      }
    }
  }
  return Math.sqrt(maxDistSq);
}

export function updateLateralBaselineCache(
  previousCache: unknown,
  event: LiveMeasurementEvent,
  meanRayDirection: { x: number; y: number; z: number }
): unknown {
  return null;
}
