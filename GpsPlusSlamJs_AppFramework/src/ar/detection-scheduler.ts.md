# detection-scheduler.ts

**Purpose:** A **generic** throttle + coalesce + N-consecutive-lock state machine
over any async detector — Phase 2 / §9 + research2 runtime stability of the
[QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md),
generalized per **Note 1** of the
[follow-up plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-followup-qr-tracking-generalization-overlay-and-north.md)
so a future object detector (YOLO) reuses it unchanged. It gates nothing on QR.

## Public API

- `createDetectionScheduler<TResult, TImage = RgbaImage>(config): DetectionScheduler<TImage>`
  — `offerFrame(image)` (call per render frame), plus read-only `inFlight`,
  `consecutiveLocks`, `locked`.
- `DetectionSchedulerConfig<TResult, TImage>` — `detect(image) => Promise<TResult|null>`
  (the injected detect→solve step), `minIntervalMs`, `requiredLockCount` (3),
  `now` (injectable clock), `onLocked(result)`, `onMiss`, `onError`.
- **QR specialization (back-compat):** `createQrDetectionScheduler`,
  `QrDetectionScheduler`, `QrDetectionSchedulerConfig` — `TResult = QrPoseSolution`.

## Invariants & assumptions

- **Throttle:** at most one detection START per `minIntervalMs` (100 ms ≈ 10 Hz);
  the first frame always passes (`lastStart = −∞`).
- **Coalesce:** `offerFrame` is a no-op while `inFlight` — stale frames are
  dropped, not queued, so the heavy WASM solve never backs up.
- **Lock gate:** `consecutiveLocks` increments on success (capped at
  `requiredLockCount`), resets to 0 on a miss or a rejected `detect`. `onLocked`
  fires on every success once `locked` (so a locked detection keeps voting —
  fresh, time-decayed votes per §12), `onMiss`/`onError` on the respective settle.
- **Transport-agnostic, device-free, detection-agnostic:** `detect` and the clock
  are injected; the result and frame types are generic. The same scheduler drives
  a worker-hosted or main-thread pipeline and is fully deterministic in tests.

## Tests

- `detection-scheduler.test.ts` — throttle, coalesce, lock-after-N + cap +
  miss-reset, error-resets + clears in-flight (via the QR specialization); plus a
  generality test proving a non-QR result type + custom frame type work.

## Related

- Drives [qr-frontend.ts.md](qr-frontend.ts.md) + [qr-pose.ts.md](qr-pose.ts.md)
  (`solveQrPose`) + [opencv-pnp.ts.md](opencv-pnp.ts.md); locked solutions feed
  the occupancy self-check ([qr-occupancy-check.ts.md](qr-occupancy-check.ts.md))
  and the GPS-vote bridge ([qr-gps-vote.ts.md](qr-gps-vote.ts.md)). Consumed by
  [qr-tracking-controller.ts.md](qr-tracking-controller.ts.md).
