### DESCRIPTION

Live measurement UX + baseline coaching: drive the user from the first ray+depth shot (provisional sphere) to a confirmed measurement point with clear, real-time quality feedback. The sphere is re-solved and tightens as rays accumulate, with a live uncertainty readout. For far targets, the app actively coaches parallax-building behavior (move sideways and mark again) and shows uncertainty shrinking as lateral baseline grows. The component keeps all decision logic pure and testable while on-screen widgets remain view-layer only.

### USE CASES

1. Short-range target (depth-dominated): first ray + depth prior gives a usable provisional point quickly; extra rays reduce uncertainty.
2. Long-range target (parallax-dominated): first shots are weak; app coaches the user to move sideways and keep shooting until baseline and uncertainty become acceptable.
3. Noisy capture sequence: one or more poor rays are included; UX remains stable because quality and readiness come from robust solver outputs, not raw shot count.

### GOALS

1. Show a provisional sphere immediately after the first ray+depth observation.
2. Continuously re-solve and tighten the provisional sphere as rays accumulate.
3. Compute and expose coaching state from pure logic (no UI branching in handlers).
4. Expose a live uncertainty readout that updates on every recompute.
5. Gate confirmation with explicit quality criteria, not only minimum ray count.
6. Keep all transitions deterministic and replay-safe.

### DESIGN DECISIONS

#### Decision 1: Pure state reducer + pure evaluators

The component core is a pure reducer/evaluator layer that receives:

- current draft measurement state
- latest solver result (point, uncertainty, rmsError, inlier count, optional diagnostics)
- shot metadata (ray count, baseline metric, depth-usage ratio)

It returns a new draft state + UI intent fields. This keeps logic unit-testable and deterministic across live and replay.

#### Decision 2: Multi-signal quality scoring instead of single-threshold gating

Confirmation readiness should not depend on one metric. Use a small, explicit quality model:

- uncertainty score (primary)
- baseline adequacy score (for long-range geometry)
- residual score (rmsError / robust residual)
- observation sufficiency score (effective inlier count)

Final readiness is based on weighted score plus hard safety guards.

#### Decision 3: Hard guards for unsafe confirm

Even with a decent aggregate score, block confirm when any hard failure is present:

- no solved point
- condition marked unstable/degenerate by solver
- inlier count below minimum
- uncertainty above absolute maximum

#### Decision 4: Baseline coaching is geometry-first

Coaching prompt should be driven by baseline geometry and uncertainty trend, not only ray count.
Example policy:

- low baseline + high uncertainty -> "Move sideways and shoot again"
- baseline improved but residual still high -> "Re-aim same target and shoot again"
- quality good -> "Ready to confirm"

#### Decision 5: Hysteresis to avoid prompt flicker

Prompt changes and ready-state toggles should use hysteresis bands (enter/exit thresholds) so UI does not oscillate frame-to-frame.

#### Decision 6: Event-driven recompute with explicit budget

Quality evaluation must run on reducer events only (observation add/remove, retarget, confirm state changes), never on per-frame render ticks. The logic must satisfy a bounded runtime budget under long drafts and accelerated replay.

**Improvement Update 6 (Performance Budget):** Added event-driven recompute constraints, complexity expectations, and performance/replay budget test requirements.

### QUALITY SCORING SPECIFICATION

**Improvement Update 1 (Quality Scoring Specification):** Added a deterministic, fully specified quality model with normalization, fixed weights, hard-guard precedence, prompt tie-break order, and required diagnostics.

`evaluateMeasurementQuality` MUST implement this exact deterministic model.

#### Input validation

- Any non-finite value in `uncertainty`, `rmsError`, `baselineM`, `rayCount`, or `inlierCount` triggers `hardBlocked=true` with reason `invalid_input`.
- Any negative value for `baselineM`, `rayCount`, or `inlierCount` triggers `hardBlocked=true` with reason `invalid_input`.
- Any non-finite value in `observationAgeMs` or `poseDepthTimeSkewMs` triggers `hardBlocked=true` with reason `invalid_input`.
- Any negative value for `observationAgeMs` or `poseDepthTimeSkewMs` triggers `hardBlocked=true` with reason `invalid_input`.

#### Hard-guard precedence (evaluated first)

- If `hasSolvedPoint=false`: block with reason `no_solved_point`.
- If `solverDegenerate=true`: block with reason `solver_degenerate`.
- If `observationAgeMs > maxObservationAgeMs`: block with reason `stale_observation`.
- If `poseDepthTimeSkewMs > maxPoseDepthSkewMs`: block with reason `pose_depth_time_skew`.
- If `inlierCount < minInliers`: block with reason `insufficient_inliers`.
- If `uncertainty == null` or `uncertainty > maxUncertaintyHard`: block with reason `uncertainty_too_high`.
- If `rmsError != null` and `rmsError > maxRmsError`: block with reason `residual_too_high`.

**Improvement Update 3 (Temporal Validity Guards):** Added observation freshness and pose-depth timestamp-skew constraints as hard guards, with matching inputs/thresholds/tests.

If any hard guard fails, `ready=false` regardless of score.

#### Signal normalization (all clamped to [0, 1])

- Uncertainty signal (higher is better):
  - `u = 1 - (uncertainty / maxUncertaintyHard)`
- Baseline signal:
  - `b = min(1, baselineM / minBaselineM)`
- Residual signal:
  - If `rmsError == null`, set `r = 0.5` (neutral confidence).
  - Else `r = 1 - (rmsError / maxRmsError)`.
- Inlier sufficiency signal:
  - `i = min(1, inlierCount / minInliers)`

#### Weighted score formula

- `score = clamp01(0.45*u + 0.30*b + 0.15*r + 0.10*i)`

This default weighting prioritizes geometric certainty and baseline while still penalizing residuals and low inlier support.

#### Ready-state hysteresis

- If `wasReady=false`: `ready = score >= readyEnterScore`.
- If `wasReady=true`: `ready = score >= readyExitScore`.
- Constraint: `readyEnterScore > readyExitScore` is mandatory and validated at startup.

#### Threshold governance and validation

- Every active threshold set MUST have a stable `thresholdProfileId` and integer `thresholdVersion`.
- Startup MUST fail fast if any of these constraints are violated:
  - all numeric thresholds are finite and non-negative
  - `readyEnterScore > readyExitScore`
  - `maxUncertaintyHard > targetUncertainty`
  - `minInliers >= 1`
- Any invalid threshold config MUST produce a deterministic boot-time error (not runtime fallback to silent defaults).

**Improvement Update 4 (Threshold Governance + Replay Binding):** Added `thresholdProfileId` / `thresholdVersion`, startup config validation rules, and replay policy binding requirements.

#### Prompt precedence (deterministic tie-break)

Prompt must be selected in this order:

1. If hard blocked due to `no_solved_point` or `solver_degenerate`: `add_more_rays`.
2. If `b < 0.7` and `u < 0.6`: `move_sideways`.
3. Else if `r < 0.5`: `reaim_target`.
4. Else if `i < 1.0`: `add_more_rays`.
5. Else if `ready=true`: `ready_to_confirm`.
6. Else: `add_more_rays`.

#### Required diagnostics emitted per recompute

`QualityEvaluation.reasons` MUST include machine-readable tokens for:

- failed hard guards
- normalized signal bins (`u`, `b`, `r`, `i` bucketed to 0.1)
- readiness transition events (`entered_ready`, `exited_ready`, `steady`)

### TYPES

```typescript
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
```

**Improvement Update 5 (User Intent Edge-Case Flows):** Added explicit reducer events and transitions for cancel, retarget, undo/remove-last-ray, and reset-after-failure.

### FUNCTIONS

```typescript
/**
 * Computes a normalized quality score and confirm readiness from solver + geometry inputs.
 * Pure function. No store access, no timestamps, no randomness.
 */
export function evaluateMeasurementQuality(
  inputs: QualityInputs,
  thresholds: QualityThresholds,
  wasReady: boolean
): QualityEvaluation;

/**
 * Maps quality evaluation to user-facing coaching prompt.
 * Pure and side-effect free.
 */
export function decideCoachingPrompt(
  inputs: QualityInputs,
  evaluation: QualityEvaluation
): CoachingPrompt;

/**
 * Applies one logical update tick after an observation is added or recomputed.
 * Returns next draft state consumed by UI rendering and action gating.
 */
export function reduceLiveMeasurementDraft(
  current: LiveMeasurementDraft,
  inputs: QualityInputs,
  thresholds: QualityThresholds
): LiveMeasurementDraft;

/**
 * Computes lateral baseline metric from captured ray origins.
 * Baseline should represent sideways parallax, not forward walking distance.
 */
export function computeLateralBaselineM(
  rayOrigins: readonly { x: number; y: number; z: number }[],
  meanRayDirection: { x: number; y: number; z: number }
): number;

/**
 * Optional performance path for long drafts: incrementally updates cached baseline stats
 * when one observation is appended or removed, avoiding full O(n) recompute each time.
 */
export function updateLateralBaselineCache(
  previousCache: unknown,
  event: LiveMeasurementEvent,
  meanRayDirection: { x: number; y: number; z: number }
): unknown;
```

### STATE FLOW

1. idle: no rays captured.
2. provisional: first ray+depth observation created a provisional sphere/point estimate.
3. refining: additional rays update solver result; coaching active.
4. ready: quality passes enter thresholds and hard guards.
5. confirm_pending: user pressed confirm; waiting for persistence ack from Component 6.
6. confirm_failed: persistence failed or timed out; user can retry or continue refining.
7. confirmed: persistence succeeded.

**Improvement Update 2 (Confirm Lifecycle Safety):** Added `confirm_pending` and `confirm_failed` states with explicit persistence-ack transitions and retry/error handling semantics.

Transitions:

- idle -> provisional when first ray+depth solve produces hasSolvedPoint.
- provisional/refining -> ready when readiness enters hysteresis band.
- ready -> refining when quality drops below exit band or hard guard fails.
- ready -> confirm_pending only through explicit confirm action.
- confirm_pending -> confirmed on persistence success ack.
- confirm_pending -> confirm_failed on persistence error or timeout.
- confirm_failed -> ready on retry if quality still passes guards.
- confirm_failed -> refining if new observations are added and quality is not ready.
- provisional/refining/ready/confirm_failed -> idle on cancelDraft.
- provisional/refining/ready -> provisional on retargetDraft (clear rays, quality score, and prompt history).
- provisional/refining/ready -> provisional/refining on removeLastRay after mandatory recompute.
- confirm_failed -> idle on resetAfterConfirmFailed.

### TEST

Unit-test pure decision logic with synthetic sequences.

#### evaluateMeasurementQuality

- returns hardBlocked when hasSolvedPoint is false.
- returns hardBlocked when solverDegenerate is true.
- fails fast when thresholds violate config constraints (profile invalid).
- blocks confirmation when observationAgeMs > maxObservationAgeMs.
- blocks confirmation when poseDepthTimeSkewMs > maxPoseDepthSkewMs.
- blocks confirmation when inlierCount < minInliers.
- blocks confirmation when uncertainty > maxUncertaintyHard.
- score increases when baseline grows and uncertainty drops.
- score decreases when rmsError rises above target.
- hysteresis works: ready enters at readyEnterScore, exits only below readyExitScore.
- remains O(1) with respect to observation count.

#### decideCoachingPrompt

- low baseline + high uncertainty -> move_sideways ("needs more baseline").
- enough baseline but low inliers -> add_more_rays.
- high residual with moderate baseline -> reaim_target.
- ready evaluation -> ready_to_confirm ("good enough").
- uncertainty-to-prompt mapping is monotonic for fixed baseline (higher uncertainty cannot produce a more optimistic prompt).

#### reduceLiveMeasurementDraft

- first valid solve moves idle -> provisional.
- repeated updates with improving quality move provisional/refining -> ready.
- degraded follow-up sample moves ready -> refining (hysteresis-respecting).
- canConfirm mirrors evaluation.ready and hard guard status.
- explicit confirm action moves ready -> confirm_pending.
- persistence success event moves confirm_pending -> confirmed.
- persistence timeout/error moves confirm_pending -> confirm_failed.
- retry from confirm_failed is idempotent and returns to confirm_pending.
- cancelDraft from any non-confirmed state resets draft to idle with canConfirm=false.
- retargetDraft always clears stale readiness before accepting new observations.
- removeLastRay can never keep status=ready without recompute passing guards again.
- resetAfterConfirmFailed clears error state and returns to idle.

#### synthetic sequence coverage

- far-target sequence with increasing lateral baseline shows shrinking uncertainty and prompt transition from move_sideways to ready_to_confirm.
- short-range sequence with strong initial depth starts provisional and reaches ready quickly.

#### computeLateralBaselineM

- pure forward motion along mean ray direction yields near-zero lateral baseline.
- sideways motion increases baseline proportionally.
- mixed path reports lateral component only.
- runtime is O(n) per full recompute; cached incremental path preserves equivalent result.

#### performance and replay budget

- quality recompute is event-driven only and executes at most once per reducer event.
- p95 reducer update time stays below 2 ms on target desktop replay hardware.
- long-sequence synthetic test (>=500 observations) remains within budget.
- accelerated replay test (4x speed) preserves deterministic prompt/readiness transitions without dropped state changes.

### REPLAY DETERMINISM

- All functions in this component are pure and deterministic.
- Inputs come from deterministic action replay (captured rays, solver outputs, thresholds).
- Measurement draft and confirm actions MUST persist `thresholdProfileId` and `thresholdVersion` so replay uses the exact policy active at capture time.
- No dependence on wall-clock time, animation frame order, or random sampling.
- Therefore prompt transitions and canConfirm decisions replay identically to live capture.

### DEMO

1. Near target demo:

- first shot creates provisional sphere
- second/third shot tighten uncertainty
- prompt becomes ready_to_confirm quickly

2. Far target replay demo (no phone required):

- replay a recorded walk that marks one far point from several lateral positions
- initial prompt requests move_sideways
- baseline metric increases as the replayed vantage points spread laterally
- uncertainty readout shrinks and sphere visibly tightens over the sequence
- readiness unlocks only after baseline + uncertainty conditions are satisfied

3. Noisy demo:

- inject a poor ray
- prompt temporarily shifts to reaim_target or add_more_rays
- after additional good rays, draft returns to ready

### IMPLEMENTATION PLAN

1. Add new pure utility file `src/utils/live-measurement-quality.ts` implementing:

- evaluateMeasurementQuality
- decideCoachingPrompt
- reduceLiveMeasurementDraft
- computeLateralBaselineM

2. Add tests in `src/utils/live-measurement-quality.test.ts` covering all scenarios above.

3. Add policy-governance tests:

- invalid threshold config fails fast at startup
- replay with captured `thresholdProfileId` + `thresholdVersion` reproduces readiness transitions even if current defaults changed

4. Wire into measurement draft flow (future integration target):

- after every addMeasurementRay and re-solve step, call reduceLiveMeasurementDraft
- expose prompt/canConfirm/uncertainty to UI selectors
- persist `thresholdProfileId` and `thresholdVersion` on measurement draft/confirm actions

5. UI integration contract (view-layer only):

- render prompt text by CoachingPrompt enum
- show provisional sphere using provisionalPointAr
- enable Confirm button only when canConfirm=true
- disable Confirm while status=confirm_pending to prevent duplicate submits
- show non-blocking error feedback while status=confirm_failed and allow retry

6. Keep thresholds configurable via one central object to allow tuning from field tests without changing reducer logic.

### INTEGRATION NOTE

This component consumes outputs from:

- Component 1 + 3: solved point, uncertainty, residual/inlier diagnostics
- Component 4: captured rays and their origins (for baseline)
- Component 2: depth prior influence already reflected in solver output

It does not persist entities itself. Confirmation dispatches to Component 6 (measurement-point persistence and dual-frame visualization).
