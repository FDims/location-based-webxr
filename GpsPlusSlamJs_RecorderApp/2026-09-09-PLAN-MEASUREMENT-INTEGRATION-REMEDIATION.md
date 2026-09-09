# Measurement Integration Remediation Plan

## Scope

Bring the implemented Measurement Points feature into closer compliance with the Team 7 specification. This plan intentionally excludes the lower-priority developer-experience feedback document and process-history documentation.

The work is split into small, testable slices. Each slice must pass its focused tests before the next slice begins.

## Current Deviations

1. Confirmed measurement points have pure visualization helpers but no runtime dual-dot wiring.
2. The action log persists `addMeasurementRay`, but not the complete confirmation lifecycle.
3. No replay-driven end-to-end test proves that a recorded measurement reproduces on desktop.
4. The UI has one pointer path; crosshair-forward shooting is only an implicit fallback, not an explicit mode.
5. A first ray plus depth does not reliably produce a provisional point in the interaction contract.
6. `Save anyway` is an undocumented quality override and is currently mixed with the normal Confirm label.

## Slice 1: Confirmed Dual-Dot Visualization

### Goal

Render every confirmed measurement point as AR-local dot, GPS-world dot, and connecting line. Update the GPS dot and line every frame as alignment changes.

### Approach

- Add a small Three.js visual registry owned by the AR lifecycle.
- Create a basis group under `arWorldGroup` using `WEBXR_TO_NUE` for raw AR-local content.
- Render the AR dot and line in the AR basis group.
- Render the GPS dot in the GPS/world scene using the current alignment transform.
- Subscribe to the current store through `storeRef` so store replacement is handled.
- Add/remove visual groups as confirmed entities change.
- Hide the GPS dot and line when no alignment matrix exists.

### Tests

- Pure view tests for AR position, GPS position, null alignment, and line endpoints.
- Wiring test proving confirmed entities create/update/remove visuals.
- Typecheck and focused lint.

## Slice 2: Complete Action Persistence and Replay Semantics

### Goal

Persist and replay the complete measurement lifecycle deterministically.

### Approach

- Define the persisted action contract for request, success, failure, delete, and any final entity payload.
- Whitelist the required measurement action prefixes in `recorder-store.ts`.
- Ensure replay does not re-run live handlers or OPFS side effects.
- Ensure replaying a confirmation reconstructs the confirmed entity exactly once.
- Keep OPFS hydration deduplicated by entity ID.
- Verify action payloads contain all data needed for desktop replay.

### Tests

- Action schema tests for every persisted measurement action.
- Replay reducer test for rays -> confirm -> confirmed entity.
- Hydration plus replay deduplication test.
- Failure and retry lifecycle test.

## Slice 3: Replay-Driven End-to-End Test

### Goal

Prove the integrated feature with a realistic recorded action stream, not only synthetic reducer tests.

### Approach

- Add a small deterministic recording fixture or fixture builder containing depth samples, poses, measurement rays, and confirmation.
- Replay it through the existing recorder replay path with the null storage backend.
- Assert the final entity position, uncertainty, observation IDs, inlier IDs, and outlier IDs.
- Assert repeated replay produces identical serialized entity data.

### Tests

- Vitest integration test for the complete replay path.
- Playwright smoke coverage for measurement UI state if the existing test harness can load the fixture.

## Slice 4: Explicit Aiming Modes

### Goal

Implement the PDF's two explicit shooting modes:

- `crosshair`: shoot through normalized screen center, equivalent to device-forward aiming.
- `tap`: shoot through the tapped normalized pixel using projection unprojection.

### Approach

- Add an `AimingMode` type and store/UI state with `crosshair` as default.
- In crosshair mode, all shoot commands use `(0.5, 0.5)`.
- In tap mode, pointer coordinates are normalized and passed through the unprojector.
- Keep the framework top-left screen convention and document the coordinate mapping.
- Add a compact mode control without allowing the measurement buttons to generate rays.

### Tests

- Unit tests for mode selection and coordinate forwarding.
- Existing aiming math tests remain the source of truth for unprojection.
- UI test proving crosshair and tap produce different normalized inputs.

## Slice 5: First-Ray Depth-Dominated Provisional State

### Goal

Support the specified short-range case: one ray plus usable depth creates a provisional point with high uncertainty.

### Approach

- Extend the robust solver's single-observation path to return the depth point when the depth prior is valid.
- Mark the result as depth-dominated and keep confirmation disabled until quality gates pass.
- Display the provisional sphere and uncertainty after the first usable ray.
- Let later rays replace the depth-dominated estimate with triangulation/fusion.

### Tests

- One ray with valid depth returns a provisional point.
- One ray without depth remains unsolved.
- Additional rays refine the point and reduce uncertainty.
- UI shows the provisional state without enabling Confirm prematurely.

## Slice 6: Confirm Policy and Override Semantics

### Goal

Make normal Confirm and Save anyway behavior explicit and testable.

### Approach

- Normal `Confirm` requires the configured hard safety gates and quality readiness.
- `Save anyway` is an explicit override, not a relabeled normal Confirm.
- Persist an override marker or quality status on the entity/action.
- Show the actual blocking reason in the coaching UI.
- Save measurement points directly without opening the legacy reference-point naming dialog.

### Tests

- Quality-ready state renders and invokes Confirm.
- Below-quality solved state renders Save anyway.
- Save anyway persists the override marker.
- Confirm never opens the reference-point picker.
- Successful save clears the measurement HUD and pending rays.

## Validation Order

After every slice:

```powershell
pnpm exec tsc -p tsconfig.app.json --noEmit
pnpm exec vitest run --config config/vitest.config.ts <focused-tests>
pnpm exec eslint <touched-files> --config config/eslint.config.mjs
```

Before completion:

```powershell
pnpm run test:unit
pnpm run typecheck
pnpm run typecheck:tests
pnpm run lint
pnpm run test:e2e
```

## Completion Criteria

- Confirmed points visibly render as live dual dots with a connection line.
- Measurement actions replay deterministically without live handler side effects.
- A replay fixture proves identical measurement output.
- Crosshair and tap shooting are explicit, testable modes.
- A first ray with valid depth produces a provisional estimate.
- Confirm and Save anyway have distinct documented semantics.
- The lower-priority DX/process deviations remain intentionally out of scope.
