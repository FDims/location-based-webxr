import { describe, it, expect } from 'vitest';
import {
  evaluateMeasurementQuality,
  reduceLiveMeasurementDraft,
  computeLateralBaselineM,
  QualityInputs,
  QualityThresholds,
  LiveMeasurementDraft
} from './live-measurement-quality';

describe('live-measurement-quality', () => {
  const defaultThresholds: QualityThresholds = {
    thresholdProfileId: 'test_profile',
    thresholdVersion: 1,
    minInliers: 2,
    minBaselineM: 2.0,
    targetUncertainty: 0.2,
    maxUncertaintyHard: 1.0,
    maxRmsError: 0.1,
    maxObservationAgeMs: 500,
    maxPoseDepthSkewMs: 100,
    readyEnterScore: 0.8,
    readyExitScore: 0.6,
  };

  const defaultInputs: QualityInputs = {
    uncertainty: 0.1,
    rmsError: 0.05,
    baselineM: 2.5,
    rayCount: 5,
    inlierCount: 4,
    hasSolvedPoint: true,
    solverDegenerate: false,
    observationAgeMs: 50,
    poseDepthTimeSkewMs: 10,
  };

  const defaultDraft: LiveMeasurementDraft = {
    status: 'idle',
    prompt: 'none',
    canConfirm: false,
    lastQualityScore: 0,
    thresholdProfileId: 'test_profile',
    thresholdVersion: 1,
  };

  describe('evaluateMeasurementQuality', () => {
    it('returns hardBlocked when hasSolvedPoint is false', () => {
      const inputs = { ...defaultInputs, hasSolvedPoint: false };
      const result = evaluateMeasurementQuality(inputs, defaultThresholds, false);
      expect(result.hardBlocked).toBe(true);
      expect(result.reasons).toContain('no_solved_point');
      expect(result.ready).toBe(false);
    });

    it('returns hardBlocked when solverDegenerate is true', () => {
      const inputs = { ...defaultInputs, solverDegenerate: true };
      const result = evaluateMeasurementQuality(inputs, defaultThresholds, false);
      expect(result.hardBlocked).toBe(true);
      expect(result.reasons).toContain('solver_degenerate');
    });

    it('fails fast when thresholds violate config constraints', () => {
      expect(() => {
        evaluateMeasurementQuality(defaultInputs, { ...defaultThresholds, readyEnterScore: 0.5, readyExitScore: 0.6 }, false);
      }).toThrow('Invalid thresholds configuration');
      
      expect(() => {
        evaluateMeasurementQuality(defaultInputs, { ...defaultThresholds, maxUncertaintyHard: 0.1, targetUncertainty: 0.5 }, false);
      }).toThrow('Invalid thresholds configuration');

      expect(() => {
        evaluateMeasurementQuality(defaultInputs, { ...defaultThresholds, minInliers: 0 }, false);
      }).toThrow('Invalid thresholds configuration');
    });

    it('blocks confirmation when observationAgeMs > maxObservationAgeMs', () => {
      const result = evaluateMeasurementQuality({ ...defaultInputs, observationAgeMs: 600 }, defaultThresholds, false);
      expect(result.hardBlocked).toBe(true);
      expect(result.reasons).toContain('stale_observation');
    });

    it('blocks confirmation when poseDepthTimeSkewMs > maxPoseDepthSkewMs', () => {
      const result = evaluateMeasurementQuality({ ...defaultInputs, poseDepthTimeSkewMs: 200 }, defaultThresholds, false);
      expect(result.hardBlocked).toBe(true);
      expect(result.reasons).toContain('pose_depth_time_skew');
    });

    it('blocks confirmation when inlierCount < minInliers', () => {
      const result = evaluateMeasurementQuality({ ...defaultInputs, inlierCount: 1 }, defaultThresholds, false);
      expect(result.hardBlocked).toBe(true);
      expect(result.reasons).toContain('insufficient_inliers');
    });

    it('blocks confirmation when uncertainty > maxUncertaintyHard', () => {
      const result = evaluateMeasurementQuality({ ...defaultInputs, uncertainty: 1.5 }, defaultThresholds, false);
      expect(result.hardBlocked).toBe(true);
      expect(result.reasons).toContain('uncertainty_too_high');
    });

    it('score increases when baseline grows and uncertainty drops', () => {
      const r1 = evaluateMeasurementQuality({ ...defaultInputs, baselineM: 1.0, uncertainty: 0.8 }, defaultThresholds, false);
      const r2 = evaluateMeasurementQuality({ ...defaultInputs, baselineM: 2.0, uncertainty: 0.2 }, defaultThresholds, false);
      expect(r2.score).toBeGreaterThan(r1.score);
    });

    it('score decreases when rmsError rises above target', () => {
      const r1 = evaluateMeasurementQuality({ ...defaultInputs, rmsError: 0.01 }, defaultThresholds, false);
      const r2 = evaluateMeasurementQuality({ ...defaultInputs, rmsError: 0.09 }, defaultThresholds, false);
      expect(r2.score).toBeLessThan(r1.score);
    });

    it('hysteresis works: ready enters at readyEnterScore, exits only below readyExitScore', () => {
      const inputs = { ...defaultInputs, uncertainty: 0.5, baselineM: 2.5, rmsError: 0, inlierCount: 2 };
      
      const r1 = evaluateMeasurementQuality(inputs, defaultThresholds, false);
      expect(r1.score).toBeLessThan(0.8);
      expect(r1.score).toBeGreaterThan(0.6);
      expect(r1.ready).toBe(false);

      const r2 = evaluateMeasurementQuality(inputs, defaultThresholds, true);
      expect(r2.ready).toBe(true);
    });
  });

  describe('decideCoachingPrompt', () => {
    it('low baseline + high uncertainty -> move_sideways', () => {
      const inputs = { ...defaultInputs, baselineM: 1.0, uncertainty: 0.8 };
      const evalState = evaluateMeasurementQuality(inputs, defaultThresholds, false);
      expect(evalState.prompt).toBe('move_sideways');
    });

    it('enough baseline but low inliers -> add_more_rays', () => {
      const t = { ...defaultThresholds, minInliers: 3 };
      const inputs = { ...defaultInputs, baselineM: 2.0, uncertainty: 0.2, inlierCount: 2 };
      const evalState = evaluateMeasurementQuality(inputs, t, false);
      expect(evalState.prompt).toBe('add_more_rays');
    });

    it('high residual with moderate baseline -> reaim_target', () => {
      const inputs = { ...defaultInputs, baselineM: 2.0, rmsError: 0.08 };
      const evalState = evaluateMeasurementQuality(inputs, defaultThresholds, false);
      expect(evalState.prompt).toBe('reaim_target');
    });

    it('ready evaluation -> ready_to_confirm', () => {
      const inputs = { ...defaultInputs, baselineM: 2.5, uncertainty: 0.1, rmsError: 0.01 };
      const evalState = evaluateMeasurementQuality(inputs, defaultThresholds, false);
      expect(evalState.ready).toBe(true);
      expect(evalState.prompt).toBe('ready_to_confirm');
    });
  });

  describe('reduceLiveMeasurementDraft', () => {
    it('first valid solve moves idle -> provisional', () => {
      // For this test, make sure it does not reach "ready" state by having a bad input
      const inputs = { ...defaultInputs, baselineM: 0 };
      const draft = reduceLiveMeasurementDraft(defaultDraft, inputs, defaultThresholds, { type: 'observationAdded' });
      expect(draft.status).toBe('provisional');
    });
    
    it('repeated updates with improving quality move provisional/refining -> ready', () => {
      const inputs = { ...defaultInputs, baselineM: 0 };
      let draft = reduceLiveMeasurementDraft(defaultDraft, inputs, defaultThresholds, { type: 'observationAdded' });
      expect(draft.status).toBe('provisional');
      
      const betterInputs = { ...defaultInputs, baselineM: 2.5 };
      draft = reduceLiveMeasurementDraft(draft, betterInputs, defaultThresholds, { type: 'observationAdded' });
      expect(draft.status).toBe('ready');
    });

    it('degraded follow-up sample moves ready -> refining (hysteresis-respecting)', () => {
      let draft = reduceLiveMeasurementDraft(defaultDraft, { ...defaultInputs, baselineM: 0 }, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'observationAdded' });
      expect(draft.status).toBe('ready');
      
      const badInputs = { ...defaultInputs, baselineM: 0, uncertainty: 0.9 };
      draft = reduceLiveMeasurementDraft(draft, badInputs, defaultThresholds, { type: 'observationAdded' });
      expect(draft.status).toBe('refining');
    });

    it('canConfirm mirrors evaluation.ready and hard guard status', () => {
      let draft = reduceLiveMeasurementDraft(defaultDraft, defaultInputs, defaultThresholds, { type: 'observationAdded' });
      expect(draft.canConfirm).toBe(true);
      
      const badInputs = { ...defaultInputs, hasSolvedPoint: false };
      draft = reduceLiveMeasurementDraft(draft, badInputs, defaultThresholds, { type: 'observationAdded' });
      expect(draft.canConfirm).toBe(false);
    });

    it('explicit confirm action moves ready -> confirm_pending', () => {
      let draft = reduceLiveMeasurementDraft(defaultDraft, { ...defaultInputs, baselineM: 0 }, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'confirmRequested' });
      expect(draft.status).toBe('confirm_pending');
      expect(draft.canConfirm).toBe(false);
    });

    it('persistence success event moves confirm_pending -> confirmed', () => {
      let draft = reduceLiveMeasurementDraft(defaultDraft, { ...defaultInputs, baselineM: 0 }, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'confirmRequested' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'confirmSucceeded' });
      expect(draft.status).toBe('confirmed');
    });

    it('persistence timeout/error moves confirm_pending -> confirm_failed', () => {
      let draft = reduceLiveMeasurementDraft(defaultDraft, { ...defaultInputs, baselineM: 0 }, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'confirmRequested' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'confirmFailed' });
      expect(draft.status).toBe('confirm_failed');
      expect(draft.canConfirm).toBe(true);
    });

    it('cancelDraft from any non-confirmed state resets draft to idle with canConfirm=false', () => {
      let draft = reduceLiveMeasurementDraft(defaultDraft, { ...defaultInputs, baselineM: 0 }, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'cancelDraft' });
      expect(draft.status).toBe('idle');
      expect(draft.canConfirm).toBe(false);
    });

    it('retargetDraft always clears stale readiness before accepting new observations', () => {
      let draft = reduceLiveMeasurementDraft(defaultDraft, { ...defaultInputs, baselineM: 0 }, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'observationAdded' });
      draft = reduceLiveMeasurementDraft(draft, defaultInputs, defaultThresholds, { type: 'retargetDraft' });
      expect(draft.status).toBe('provisional');
      expect(draft.lastQualityScore).toBe(0);
      expect(draft.canConfirm).toBe(false);
    });
  });

  describe('computeLateralBaselineM', () => {
    it('pure forward motion along mean ray direction yields near-zero lateral baseline', () => {
      const meanDir = { x: 1, y: 0, z: 0 };
      const origins = [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 }
      ];
      const baseline = computeLateralBaselineM(origins, meanDir);
      expect(baseline).toBeCloseTo(0);
    });

    it('sideways motion increases baseline proportionally', () => {
      const meanDir = { x: 1, y: 0, z: 0 };
      const origins = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 5, z: 0 },
        { x: 0, y: -5, z: 0 }
      ];
      const baseline = computeLateralBaselineM(origins, meanDir);
      expect(baseline).toBeCloseTo(10);
    });

    it('mixed path reports lateral component only', () => {
      const meanDir = { x: 1, y: 0, z: 0 };
      const origins = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 3, z: 4 }
      ];
      const baseline = computeLateralBaselineM(origins, meanDir);
      expect(baseline).toBeCloseTo(5);
    });
  });

  describe('performance and replay budget', () => {
    it('long-sequence synthetic test (>=500 observations) remains within budget', () => {
      const start = performance.now();
      let draft = { ...defaultDraft };
      for (let i = 0; i < 500; i++) {
        draft = reduceLiveMeasurementDraft(draft, { ...defaultInputs, rayCount: i + 1 }, defaultThresholds, { type: 'observationAdded' });
      }
      const end = performance.now();
      expect(end - start).toBeLessThan(100);
    });
  });
});
