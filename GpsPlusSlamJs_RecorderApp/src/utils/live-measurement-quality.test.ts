import { describe, expect, test } from 'vitest';
import {
  computeLateralBaselineM,
  evaluateMeasurementQuality,
  reduceLiveMeasurementDraft,
  type LiveMeasurementDraft,
  type QualityInputs,
  type QualityThresholds,
} from './live-measurement-quality';

function makeThresholds(
  overrides: Partial<QualityThresholds> = {}
): QualityThresholds {
  return {
    thresholdProfileId: 'default-short-range',
    thresholdVersion: 1,
    minInliers: 2,
    minBaselineM: 2,
    targetUncertainty: 0.8,
    maxUncertaintyHard: 2.0,
    maxRmsError: 1.0,
    maxObservationAgeMs: 500,
    maxPoseDepthSkewMs: 120,
    readyEnterScore: 0.75,
    readyExitScore: 0.65,
    ...overrides,
  };
}

function makeInputs(overrides: Partial<QualityInputs> = {}): QualityInputs {
  return {
    uncertainty: 0.8,
    rmsError: 0.3,
    baselineM: 2.5,
    rayCount: 3,
    inlierCount: 3,
    hasSolvedPoint: true,
    solverDegenerate: false,
    observationAgeMs: 80,
    poseDepthTimeSkewMs: 20,
    ...overrides,
  };
}

function makeDraft(
  overrides: Partial<LiveMeasurementDraft> = {}
): LiveMeasurementDraft {
  return {
    status: 'idle',
    prompt: 'none',
    canConfirm: false,
    lastQualityScore: 0,
    thresholdProfileId: 'default-short-range',
    thresholdVersion: 1,
    ...overrides,
  };
}

describe('evaluateMeasurementQuality', () => {
  test('blocks when no solved point exists', () => {
    const result = evaluateMeasurementQuality(
      makeInputs({ hasSolvedPoint: false }),
      makeThresholds(),
      false
    );
    expect(result.hardBlocked).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('no_solved_point');
  });

  test('blocks when solver is degenerate', () => {
    const result = evaluateMeasurementQuality(
      makeInputs({ solverDegenerate: true }),
      makeThresholds(),
      false
    );
    expect(result.hardBlocked).toBe(true);
    expect(result.reasons).toContain('solver_degenerate');
  });

  test('blocks when observation is stale', () => {
    const result = evaluateMeasurementQuality(
      makeInputs({ observationAgeMs: 900 }),
      makeThresholds({ maxObservationAgeMs: 500 }),
      false
    );
    expect(result.hardBlocked).toBe(true);
    expect(result.reasons).toContain('stale_observation');
  });

  test('blocks when pose-depth time skew is too high', () => {
    const result = evaluateMeasurementQuality(
      makeInputs({ poseDepthTimeSkewMs: 300 }),
      makeThresholds({ maxPoseDepthSkewMs: 120 }),
      false
    );
    expect(result.hardBlocked).toBe(true);
    expect(result.reasons).toContain('pose_depth_time_skew');
  });

  test('fails fast on invalid threshold config', () => {
    expect(() =>
      evaluateMeasurementQuality(
        makeInputs(),
        makeThresholds({ readyEnterScore: 0.5, readyExitScore: 0.6 }),
        false
      )
    ).toThrow(/readyEnterScore/);
  });

  test('score improves with larger baseline and lower uncertainty', () => {
    const low = evaluateMeasurementQuality(
      makeInputs({ baselineM: 1.0, uncertainty: 1.4 }),
      makeThresholds(),
      false
    );
    const high = evaluateMeasurementQuality(
      makeInputs({ baselineM: 2.5, uncertainty: 0.7 }),
      makeThresholds(),
      false
    );
    expect(high.score).toBeGreaterThan(low.score);
  });

  test('hysteresis keeps ready true until exit threshold is crossed', () => {
    const thresholds = makeThresholds({
      readyEnterScore: 0.8,
      readyExitScore: 0.6,
    });

    const enter = evaluateMeasurementQuality(
      makeInputs({ uncertainty: 0.6, baselineM: 3 }),
      thresholds,
      false
    );
    expect(enter.ready).toBe(true);

    const stay = evaluateMeasurementQuality(
      makeInputs({ uncertainty: 0.9, baselineM: 2.2 }),
      thresholds,
      true
    );
    expect(stay.ready).toBe(true);

    const exit = evaluateMeasurementQuality(
      makeInputs({ uncertainty: 1.6, baselineM: 0.8 }),
      thresholds,
      true
    );
    expect(exit.ready).toBe(false);
  });

  test('uses deterministic prompt precedence', () => {
    const result = evaluateMeasurementQuality(
      makeInputs({ baselineM: 0.4, uncertainty: 1.4, inlierCount: 3 }),
      makeThresholds(),
      false
    );
    expect(result.prompt).toBe('move_sideways');
  });
});

describe('reduceLiveMeasurementDraft', () => {
  test('first valid solve moves idle to provisional', () => {
    const next = reduceLiveMeasurementDraft(
      makeDraft({ status: 'idle' }),
      makeInputs({ rayCount: 1 }),
      makeThresholds()
    );
    expect(next.status).toBe('provisional');
  });

  test('improving sequence reaches ready', () => {
    const thresholds = makeThresholds();
    const afterFirst = reduceLiveMeasurementDraft(
      makeDraft({ status: 'idle' }),
      makeInputs({ rayCount: 1, baselineM: 1.2, uncertainty: 1.1 }),
      thresholds
    );
    const afterThird = reduceLiveMeasurementDraft(
      afterFirst,
      makeInputs({
        rayCount: 3,
        baselineM: 3,
        uncertainty: 0.6,
        inlierCount: 3,
      }),
      thresholds
    );
    expect(afterThird.status).toBe('ready');
    expect(afterThird.canConfirm).toBe(true);
  });

  test('degraded sample can move ready back to refining', () => {
    const thresholds = makeThresholds();
    const ready = reduceLiveMeasurementDraft(
      makeDraft({ status: 'ready', canConfirm: true }),
      makeInputs({ rayCount: 4, baselineM: 3, uncertainty: 0.6 }),
      thresholds
    );
    expect(ready.status).toBe('ready');

    const degraded = reduceLiveMeasurementDraft(
      ready,
      makeInputs({
        rayCount: 4,
        baselineM: 0.4,
        uncertainty: 1.7,
        inlierCount: 1,
      }),
      thresholds
    );
    expect(degraded.status).toBe('refining');
    expect(degraded.canConfirm).toBe(false);
  });

  test('confirm lifecycle transitions through pending to confirmed', () => {
    const thresholds = makeThresholds();
    const readyDraft = makeDraft({
      status: 'ready',
      canConfirm: true,
      prompt: 'ready_to_confirm',
    });

    const pending = reduceLiveMeasurementDraft(
      readyDraft,
      makeInputs(),
      thresholds,
      { type: 'confirmRequested' }
    );
    expect(pending.status).toBe('confirm_pending');

    const confirmed = reduceLiveMeasurementDraft(
      pending,
      makeInputs(),
      thresholds,
      { type: 'confirmSucceeded' }
    );
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.canConfirm).toBe(false);
  });

  test('confirm failure transitions to confirm_failed and supports retry', () => {
    const thresholds = makeThresholds();
    const pending = makeDraft({ status: 'confirm_pending' });

    const failed = reduceLiveMeasurementDraft(
      pending,
      makeInputs(),
      thresholds,
      { type: 'confirmFailed' }
    );
    expect(failed.status).toBe('confirm_failed');

    const retried = reduceLiveMeasurementDraft(
      failed,
      makeInputs({ baselineM: 3, uncertainty: 0.5, inlierCount: 3 }),
      thresholds,
      { type: 'confirmRequested' }
    );
    expect(retried.status).toBe('confirm_pending');
  });

  test('cancel resets non-confirmed state to idle', () => {
    const next = reduceLiveMeasurementDraft(
      makeDraft({ status: 'confirm_failed', canConfirm: false }),
      makeInputs(),
      makeThresholds(),
      { type: 'cancelDraft' }
    );
    expect(next.status).toBe('idle');
    expect(next.canConfirm).toBe(false);
    expect(next.prompt).toBe('none');
  });

  test('retarget clears stale readiness and returns to provisional', () => {
    const next = reduceLiveMeasurementDraft(
      makeDraft({
        status: 'ready',
        canConfirm: true,
        prompt: 'ready_to_confirm',
      }),
      makeInputs(),
      makeThresholds(),
      { type: 'retargetDraft' }
    );
    expect(next.status).toBe('provisional');
    expect(next.canConfirm).toBe(false);
    expect(next.prompt).toBe('add_more_rays');
  });

  test('removeLastRay cannot remain ready without recompute', () => {
    const next = reduceLiveMeasurementDraft(
      makeDraft({ status: 'ready', canConfirm: true }),
      makeInputs({ rayCount: 2, baselineM: 0.8, uncertainty: 1.2 }),
      makeThresholds(),
      { type: 'removeLastRay' }
    );
    expect(next.status).not.toBe('ready');
    expect(next.canConfirm).toBe(false);
  });

  test('propagates threshold policy id/version into draft state', () => {
    const thresholds = makeThresholds({
      thresholdProfileId: 'long-range-v2',
      thresholdVersion: 2,
    });

    const next = reduceLiveMeasurementDraft(
      makeDraft(),
      makeInputs({ rayCount: 2 }),
      thresholds
    );

    expect(next.thresholdProfileId).toBe('long-range-v2');
    expect(next.thresholdVersion).toBe(2);
  });
});

describe('computeLateralBaselineM', () => {
  test('forward motion along mean direction has near-zero baseline', () => {
    const baseline = computeLateralBaselineM(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      { x: 1, y: 0, z: 0 }
    );

    expect(baseline).toBeCloseTo(0, 6);
  });

  test('sideways motion increases baseline', () => {
    const small = computeLateralBaselineM(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0.5, z: 0 },
      ],
      { x: 1, y: 0, z: 0 }
    );

    const large = computeLateralBaselineM(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 2.5, z: 0 },
      ],
      { x: 1, y: 0, z: 0 }
    );

    expect(large).toBeGreaterThan(small);
  });

  test('mixed path reports only lateral component', () => {
    const baseline = computeLateralBaselineM(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 4, y: 2, z: 0 },
      ],
      { x: 1, y: 0, z: 0 }
    );

    expect(baseline).toBeGreaterThan(0);
    expect(baseline).toBeLessThan(4);
  });
});
