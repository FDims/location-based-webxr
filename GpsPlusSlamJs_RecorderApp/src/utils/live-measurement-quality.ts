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
  thresholdProfileId: string;
  thresholdVersion: number;
  minInliers: number;
  minBaselineM: number;
  targetUncertainty: number;
  maxUncertaintyHard: number;
  maxRmsError: number;
  maxObservationAgeMs: number;
  maxPoseDepthSkewMs: number;
  readyEnterScore: number;
  readyExitScore: number;
}

export interface QualityEvaluation {
  score: number;
  ready: boolean;
  hardBlocked: boolean;
  prompt: CoachingPrompt;
  reasons: string[];
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LiveMeasurementDraft {
  status: DraftStatus;
  provisionalPointAr?: Vec3;
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

export interface BaselineCache {
  baselineM: number;
  sampleCount: number;
}

export function evaluateMeasurementQuality(
  inputs: QualityInputs,
  thresholds: QualityThresholds,
  wasReady: boolean
): QualityEvaluation {
  validateThresholds(thresholds);

  const reasons: string[] = [];
  const hardGuardReasons: string[] = [];

  if (!hasValidInputNumbers(inputs)) {
    hardGuardReasons.push('invalid_input');
  }

  if (!inputs.hasSolvedPoint) hardGuardReasons.push('no_solved_point');
  if (inputs.solverDegenerate) hardGuardReasons.push('solver_degenerate');
  if (inputs.observationAgeMs > thresholds.maxObservationAgeMs) {
    hardGuardReasons.push('stale_observation');
  }
  if (inputs.poseDepthTimeSkewMs > thresholds.maxPoseDepthSkewMs) {
    hardGuardReasons.push('pose_depth_time_skew');
  }
  if (inputs.inlierCount < thresholds.minInliers) {
    hardGuardReasons.push('insufficient_inliers');
  }
  if (
    inputs.uncertainty == null ||
    inputs.uncertainty > thresholds.maxUncertaintyHard
  ) {
    hardGuardReasons.push('uncertainty_too_high');
  }
  if (inputs.rmsError != null && inputs.rmsError > thresholds.maxRmsError) {
    hardGuardReasons.push('residual_too_high');
  }

  const safeUncertainty =
    inputs.uncertainty == null || !Number.isFinite(inputs.uncertainty)
      ? thresholds.maxUncertaintyHard
      : inputs.uncertainty;
  const safeRmsError =
    inputs.rmsError == null || !Number.isFinite(inputs.rmsError)
      ? null
      : inputs.rmsError;

  const u = clamp01(1 - safeUncertainty / thresholds.maxUncertaintyHard);
  const b = clamp01(inputs.baselineM / thresholds.minBaselineM);
  const r =
    safeRmsError == null
      ? 0.5
      : clamp01(1 - safeRmsError / thresholds.maxRmsError);
  const i = clamp01(inputs.inlierCount / thresholds.minInliers);

  const score = clamp01(0.45 * u + 0.3 * b + 0.15 * r + 0.1 * i);

  const hardBlocked = hardGuardReasons.length > 0;
  const readyFromHysteresis = wasReady
    ? score >= thresholds.readyExitScore
    : score >= thresholds.readyEnterScore;
  const ready = !hardBlocked && readyFromHysteresis;

  reasons.push(...hardGuardReasons);
  reasons.push(`u_${bucket01(u)}`);
  reasons.push(`b_${bucket01(b)}`);
  reasons.push(`r_${bucket01(r)}`);
  reasons.push(`i_${bucket01(i)}`);

  if (wasReady && !ready) {
    reasons.push('exited_ready');
  } else if (!wasReady && ready) {
    reasons.push('entered_ready');
  } else {
    reasons.push('steady');
  }

  const prompt = decidePromptFromSignals(
    hardGuardReasons,
    { u, b, r, i },
    ready
  );

  return {
    score,
    ready,
    hardBlocked,
    prompt,
    reasons,
  };
}

export function decideCoachingPrompt(
  inputs: QualityInputs,
  evaluation: QualityEvaluation
): CoachingPrompt {
  if (evaluation.hardBlocked) {
    if (
      evaluation.reasons.includes('no_solved_point') ||
      evaluation.reasons.includes('solver_degenerate')
    ) {
      return 'add_more_rays';
    }
  }

  const u = clamp01(
    1 -
      (inputs.uncertainty == null || !Number.isFinite(inputs.uncertainty)
        ? 1
        : inputs.uncertainty / Math.max(1e-9, inputs.uncertainty + 1))
  );

  if (inputs.baselineM <= 0.7 && u < 0.6) {
    return 'move_sideways';
  }

  return evaluation.prompt;
}

export function reduceLiveMeasurementDraft(
  current: LiveMeasurementDraft,
  inputs: QualityInputs,
  thresholds: QualityThresholds,
  event: LiveMeasurementEvent = { type: 'observationAdded' }
): LiveMeasurementDraft {
  const wasReady = current.status === 'ready';
  const evaluation = evaluateMeasurementQuality(inputs, thresholds, wasReady);

  if (
    event.type === 'cancelDraft' ||
    event.type === 'resetAfterConfirmFailed'
  ) {
    return {
      status: 'idle',
      prompt: 'none',
      canConfirm: false,
      lastQualityScore: 0,
      thresholdProfileId: thresholds.thresholdProfileId,
      thresholdVersion: thresholds.thresholdVersion,
    };
  }

  if (event.type === 'retargetDraft') {
    return {
      status: 'provisional',
      uncertainty: inputs.uncertainty ?? undefined,
      prompt: 'add_more_rays',
      canConfirm: false,
      lastQualityScore: evaluation.score,
      thresholdProfileId: thresholds.thresholdProfileId,
      thresholdVersion: thresholds.thresholdVersion,
    };
  }

  if (
    event.type === 'confirmSucceeded' &&
    current.status === 'confirm_pending'
  ) {
    return {
      ...current,
      status: 'confirmed',
      canConfirm: false,
      prompt: 'ready_to_confirm',
      lastQualityScore: evaluation.score,
      uncertainty: inputs.uncertainty ?? current.uncertainty,
    };
  }

  if (event.type === 'confirmFailed' && current.status === 'confirm_pending') {
    return {
      ...current,
      status: 'confirm_failed',
      canConfirm: false,
      prompt: 'add_more_rays',
      lastQualityScore: evaluation.score,
      uncertainty: inputs.uncertainty ?? current.uncertainty,
    };
  }

  if (
    event.type === 'confirmRequested' &&
    (current.status === 'ready' ||
      (current.status === 'confirm_failed' && evaluation.ready))
  ) {
    return {
      ...current,
      status: 'confirm_pending',
      canConfirm: false,
      prompt: evaluation.prompt,
      lastQualityScore: evaluation.score,
      uncertainty: inputs.uncertainty ?? current.uncertainty,
    };
  }

  if (event.type === 'removeLastRay') {
    return {
      ...current,
      status: inputs.rayCount <= 1 ? 'provisional' : 'refining',
      canConfirm: false,
      prompt: evaluation.prompt,
      lastQualityScore: evaluation.score,
      uncertainty: inputs.uncertainty ?? current.uncertainty,
      thresholdProfileId: thresholds.thresholdProfileId,
      thresholdVersion: thresholds.thresholdVersion,
    };
  }

  const nextStatus = deriveStatus(current.status, inputs, evaluation.ready);
  const nextPrompt = decideCoachingPrompt(inputs, evaluation);

  return {
    ...current,
    status: nextStatus,
    canConfirm: nextStatus === 'ready',
    prompt: nextPrompt,
    lastQualityScore: evaluation.score,
    uncertainty: inputs.uncertainty ?? current.uncertainty,
    thresholdProfileId: thresholds.thresholdProfileId,
    thresholdVersion: thresholds.thresholdVersion,
  };
}

export function computeLateralBaselineM(
  rayOrigins: readonly Vec3[],
  meanRayDirection: Vec3
): number {
  if (rayOrigins.length < 2) return 0;

  const dir = normalize(meanRayDirection);
  if (!dir) return 0;

  const projected: Vec3[] = [];
  for (const p of rayOrigins) {
    const d = dot(p, dir);
    projected.push({
      x: p.x - dir.x * d,
      y: p.y - dir.y * d,
      z: p.z - dir.z * d,
    });
  }

  const centroid = projected.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
    { x: 0, y: 0, z: 0 }
  );
  centroid.x /= projected.length;
  centroid.y /= projected.length;
  centroid.z /= projected.length;

  let maxRadius = 0;
  for (const p of projected) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dz = p.z - centroid.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > maxRadius) maxRadius = dist;
  }

  return maxRadius * 2;
}

export function updateLateralBaselineCache(
  previousCache: BaselineCache,
  event: LiveMeasurementEvent,
  _meanRayDirection: Vec3
): BaselineCache {
  // Event-only scaffolding hook for future incremental baseline stats.
  if (
    event.type === 'cancelDraft' ||
    event.type === 'resetAfterConfirmFailed'
  ) {
    return { baselineM: 0, sampleCount: 0 };
  }

  if (event.type === 'retargetDraft') {
    return { baselineM: 0, sampleCount: 0 };
  }

  return previousCache;
}

function deriveStatus(
  currentStatus: DraftStatus,
  inputs: QualityInputs,
  ready: boolean
): DraftStatus {
  if (!inputs.hasSolvedPoint) return 'idle';
  if (inputs.rayCount <= 1 || currentStatus === 'idle') return 'provisional';
  return ready ? 'ready' : 'refining';
}

function decidePromptFromSignals(
  hardGuardReasons: string[],
  signals: { u: number; b: number; r: number; i: number },
  ready: boolean
): CoachingPrompt {
  if (
    hardGuardReasons.includes('no_solved_point') ||
    hardGuardReasons.includes('solver_degenerate')
  ) {
    return 'add_more_rays';
  }

  if (signals.b < 0.7 && signals.u < 0.6) return 'move_sideways';
  if (signals.r < 0.5) return 'reaim_target';
  if (signals.i < 1) return 'add_more_rays';
  if (ready) return 'ready_to_confirm';
  return 'add_more_rays';
}

function hasValidInputNumbers(inputs: QualityInputs): boolean {
  const finiteFields = [
    inputs.baselineM,
    inputs.rayCount,
    inputs.inlierCount,
    inputs.observationAgeMs,
    inputs.poseDepthTimeSkewMs,
  ];

  if (!finiteFields.every((value) => Number.isFinite(value))) return false;
  if (inputs.uncertainty != null && !Number.isFinite(inputs.uncertainty)) {
    return false;
  }
  if (inputs.rmsError != null && !Number.isFinite(inputs.rmsError))
    return false;

  return (
    inputs.baselineM >= 0 &&
    inputs.rayCount >= 0 &&
    inputs.inlierCount >= 0 &&
    inputs.observationAgeMs >= 0 &&
    inputs.poseDepthTimeSkewMs >= 0
  );
}

function validateThresholds(thresholds: QualityThresholds): void {
  const numericThresholds = [
    thresholds.thresholdVersion,
    thresholds.minInliers,
    thresholds.minBaselineM,
    thresholds.targetUncertainty,
    thresholds.maxUncertaintyHard,
    thresholds.maxRmsError,
    thresholds.maxObservationAgeMs,
    thresholds.maxPoseDepthSkewMs,
    thresholds.readyEnterScore,
    thresholds.readyExitScore,
  ];

  const allFinite = numericThresholds.every((value) => Number.isFinite(value));
  const allNonNegative = numericThresholds.every((value) => value >= 0);

  if (!allFinite || !allNonNegative) {
    throw new Error(
      'Invalid threshold config: all numeric thresholds must be finite and non-negative.'
    );
  }

  if (thresholds.readyEnterScore <= thresholds.readyExitScore) {
    throw new Error(
      'Invalid threshold config: readyEnterScore must be greater than readyExitScore.'
    );
  }

  if (thresholds.maxUncertaintyHard <= thresholds.targetUncertainty) {
    throw new Error(
      'Invalid threshold config: maxUncertaintyHard must be greater than targetUncertainty.'
    );
  }

  if (thresholds.minInliers < 1) {
    throw new Error('Invalid threshold config: minInliers must be >= 1.');
  }

  if (thresholds.thresholdProfileId.length === 0) {
    throw new Error(
      'Invalid threshold config: thresholdProfileId must be non-empty.'
    );
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function bucket01(value: number): string {
  const bucket = Math.round(clamp01(value) * 10) / 10;
  return bucket.toFixed(1);
}

function normalize(vec: Vec3): Vec3 | null {
  const len = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);
  if (!Number.isFinite(len) || len <= 1e-9) return null;
  return { x: vec.x / len, y: vec.y / len, z: vec.z / len };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
