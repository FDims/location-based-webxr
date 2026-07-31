### DESCRIPTION
Integrate features (Ray Triangulation, Depth Prior Provider, Robust Triangulation, Aiming Ray Capture, Live Measurement Quality, and Measurement Points) into the recorder's record/replay loop: the new actions persist to disk like every other recorder action, so a recorded session (which already logs depth) deterministically replays the entire marking flow on desktop. This is what proves the feature is plugged in correctly, not just that a live demo happened to work once.

### GOALS
Fully integrating all the features:
- Ray Triangulation 
- Depth Prior Provider
- Robust Triangulation
- Aiming Ray Capture
- Live Measurement Quality
- Measurement Points
into the recorder's AR system.

Apply created calculation into the recorder's captured points. Apply created UI feature into the AR UI.

Avoid duplication of code, and make every file integrated into the existing system.

### IMPLEMENTATION STATUS

The following components are already implemented and unit-tested:
- `src/utils/ray-triangulation-core.ts` — closest-point-of-approach solver ✅
- `src/utils/depth-prior-provider.ts` — bilinear depth sampling + quartic weight ✅
- `src/utils/aiming-ray-capture.ts` — screen-to-ray unprojection ✅
- `src/utils/robust-triangulation.ts` — MSAC fusion solver ✅
- `src/utils/live-measurement-quality.ts` — quality scoring, coaching, hysteresis ✅
- `src/state/measurement-points-slice.ts` — Redux slice + selectors ✅
- `src/storage/measurement-point-loader.ts` — OPFS read/write + validation ✅
- `src/measurement-points/measurement-point-handlers.ts` — side-effect orchestration ✅
- `src/state/recorder-store.ts` — slice registered in `extraReducers` + `persistedExtraPrefixes` ✅

What remains is:
- Fixing critical bugs in the handler (V1–V5 below)
- Wiring the quality/coaching evaluator into the handler flow (V6)
- Wiring measurement-point loading into the scenario lifecycle (V5)
- Creating the Three.js visualization layer (Phase 4)
- Creating the React UI layer (Phase 4)
- Adding integration/e2e tests (V8)

---

### CRITICAL FIXES REQUIRED BEFORE INTEGRATION

#### FIX 1 — Replace `buildRayFromPose` with `createAimedRay` (V1)

**Problem**: `handleShootRay` in `measurement-point-handlers.ts` builds rays via an internal `buildRayFromPose()` that always shoots the camera forward vector `(0, 0, -1)`, regardless of `aimedScreenX`/`aimedScreenY`. This means:
- Tap-to-aim is completely broken — tapping a specific pixel always shoots the crosshair ray.
- The depth prior IS sampled at the tapped pixel, but the ray direction points elsewhere → ray/depth misalignment corrupts the solver.
- The purpose-built `createAimedRay` module (which correctly handles off-axis projection matrices via `createDepthUnprojector`) is never called.

**Fix**: Replace `buildRayFromPose` with `createAimedRay` from `aiming-ray-capture.ts`.

**Cascading concern — projection matrix availability**: `createAimedRay` requires a `projectionMatrix`. The handler currently only accesses `state.recording.latestDepthSample`. If the depth sample is `null` (e.g., AR session just started, no depth dispatched yet), there is no projection matrix. The fix must handle this:
- If `latestDepthSample?.projectionMatrix` exists, use it for both ray creation and depth sampling (ensures perfect alignment).
- If no projection matrix is available, fall back to `buildRayFromPose` for crosshair-only mode (center `[0.5, 0.5]`), but block tap-aim and log a warning. This matches the degraded single-ray-no-depth use case.

**Files to modify**:
- `src/measurement-points/measurement-point-handlers.ts` — replace `buildRayFromPose` call with `createAimedRay`, add projection matrix sourcing.

#### FIX 2 — Guard against handler re-invocation during replay (V2)

**Problem**: `generateRayId()` uses `Date.now()` + a module counter. During replay, actions are replayed from the action log with their original payloads (including the original `id`), so `handleShootRay` should NOT be called again. But if it is (e.g., due to a wiring bug), the new IDs won't match the original, breaking `inlierIds`/`outlierIds` references.

**Fix**:
- Add an explicit guard at the top of `handleShootRay`: if the app is in replay mode, log a warning and return immediately. This prevents double-dispatch.
- The replay mode flag is already available via the recorder's session state (check how `ref-point-handlers.ts` gates recording-only actions).

**Files to modify**:
- `src/measurement-points/measurement-point-handlers.ts` — add replay guard.

#### FIX 3 — Make GPS snapshot nullable (V3)

**Problem**: When no alignment matrix exists, `gpsPositionSnapshot` falls back to `[0, 0, 0]`, which is indistinguishable from a valid position. On reload, this renders a ghost dot at the world origin.

**Fix**: Change `gpsPositionSnapshot: Vector3` → `gpsPositionSnapshot: Vector3 | null` in the entity interface. Update the type guard in `isMeasurementPointEntity` to accept `null`. Update the visualization layer to skip the GPS dot when the snapshot is `null`. Since `schemaVersion` is already `1` and this is additive (null was never stored before), no version bump is strictly needed, but the type guard must accept both `Vector3` and `null`.

**Cascading concern — visualization layer**: The planned dual-dot renderer (`updateGpsDot`) must check `gpsPositionSnapshot !== null` before rendering. If the snapshot is `null` AND no live alignment matrix is available, the GPS dot is simply not rendered (only the AR-local dot shows).

**Files to modify**:
- `src/storage/measurement-point-loader.ts` — update `MeasurementPointEntity.gpsPositionSnapshot` type and `isMeasurementPointEntity` guard.
- `src/measurement-points/measurement-point-handlers.ts` — change fallback from `[0, 0, 0]` to `null`.
- `src/view/measurement-point-view.ts` (future) — null-check before rendering GPS dot.

#### FIX 4 — Standardize selector to use `RootState` (V4)

**Problem**: `selectProvisionalMeasurement` takes `MeasurementPointsState` (the sub-state), not `CombinedRootState`. This is inconsistent with RTK conventions and fragile — passing the full root state silently returns `null` instead of erroring.

**Fix**: Change the selector input to `(state: CombinedRootState) => state.measurementPoints.pendingRays`. Update the call site in `measurement-point-handlers.ts` to pass `state` instead of `state.measurementPoints`. Do the same for `selectPendingRays` and `selectConfirmedMeasurementPoints`.

**Files to modify**:
- `src/state/measurement-points-slice.ts` — update all three selectors' input type.
- `src/measurement-points/measurement-point-handlers.ts` — update call sites.

#### FIX 5 — Wire measurement-point loading into scenario lifecycle (V5)

**Problem**: `loadAllMeasurementPoints` exists but is only assigned to `window.__loadAllMeasurementPoints` as a debug tool — it's never called during normal app startup or scenario switching. Confirmed measurement points vanish after page refresh.

**Fix**: Mirror the ref-point loading pattern in `folder-manager.ts`:
1. Import `loadAllMeasurementPoints` into `folder-manager.ts`.
2. Call it alongside `loadAllRefPoints` in the scenario-selection flow (`selectScenario` / scenario initialization).
3. Add a `hydrateMeasurementPoints` reducer action to the slice that bulk-sets `confirmed` from loaded entities.
4. Dispatch `hydrateMeasurementPoints` with the loaded data after the scenario handle is acquired.

**Cascading concern — duplicate loading**: If a recording replay also re-dispatches `confirmMeasurementPoint` actions from the action log, the same point could end up in `confirmed` twice (once from OPFS hydration, once from replayed action). The `hydrateMeasurementPoints` reducer must deduplicate by `id`, or the hydration should be skipped during replay mode (when the action log will rebuild state anyway).

**Files to modify**:
- `src/state/measurement-points-slice.ts` — add `hydrateMeasurementPoints` reducer.
- `src/storage/folder-manager.ts` — add `loadAllMeasurementPoints` call in scenario init flow.
- `src/measurement-points/measurement-point-handlers.ts` — remove the `window.__` debug assignment from `main.ts` (it's no longer needed once proper loading exists).

#### FIX 6 — Wire live measurement quality directly into the Redux slice (V6)

**Problem**: The draft UI coaching loop is unwired. If the handler manually evaluates quality and dispatches an `updateDraft` action, it breaks replay determinism because the handler is skipped during replay (meaning coaching UI would remain blank). Furthermore, `LiveMeasurementEvent` perfectly maps to the lifecycle of Redux actions.

**Fix**: 
1. Add `draft: LiveMeasurementDraft` to `MeasurementPointsState` (initialized to `idle`).
2. Do NOT dispatch `updateDraft` from the handler. Instead, call `reduceLiveMeasurementDraft` directly inside the slice's reducers (`addMeasurementRay`, `undoMeasurementRay`).
3. For time-dependent inputs (`observationAgeMs`), compute them purely *in the slice* using the `action.payload.timestamp` as `currentTime`. Because the action payload is frozen and replayed exactly as recorded, the draft state will identically reconstruct during replay!
4. **Confirm Async Flow**: Redux needs to know when an OPFS write starts, succeeds, or fails, to advance the draft state through `confirm_pending` → `confirmed` or `confirm_failed`. Split `confirmMeasurementPoint` into three actions:
   - `requestConfirmMeasurement` (draft → `confirm_pending`, UI blocks confirm button)
   - `confirmMeasurementSuccess` (draft → `confirmed`, moves pending rays to confirmed)
   - `confirmMeasurementFailure` (draft → `confirm_failed`, UI allows retry)

The handler orchestrates the OPFS write and dispatches these three actions.

**Files to modify**:
- `src/state/measurement-points-slice.ts` — add `draft` state, integrate `reduceLiveMeasurementDraft` into reducers, split confirm actions.
- `src/measurement-points/measurement-point-handlers.ts` — use the new confirm actions around the async OPFS write.

---

### IMPLEMENTATION PHASES

#### Phase 1: Critical Fixes (FIX 1–6 above)
Apply all 6 fixes to the existing handler, slice, and loader code. Run existing unit tests to verify no regressions.

#### Phase 2: Integration Test
Create `src/measurement-points/measurement-point-integration.test.ts`:
1. Dispatch `addMeasurementRay` × N with synthetic observations.
2. Call `handleConfirmPoint` → verify OPFS file written.
3. Call `loadAllMeasurementPoints` → verify loaded entity matches confirmed entity.
4. Verify `inlierIds` / `outlierIds` reference valid ray IDs.
5. Verify `gpsPositionSnapshot` is `null` when no alignment matrix exists.
6. Verify draft state transitions through `idle → provisional → refining → ready`.

#### Phase 3: Visualization Layer
1. Create `src/view/measurement-point-view.ts`:
    - `createDualDotGroup()` — Two spheres + connecting line in Three.js.
    - `updateArDot(group, arPosition)` — Position the AR-local sphere.
    - `updateGpsDot(group, arPosition, alignmentMatrix)` — Recompute GPS dot every frame. Skip if `gpsPositionSnapshot === null` and no live alignment available.
    - `updateConnectionLine(group)` — Redraw the gap line.
2. Create provisional sphere listener:
    - Subscribe to `selectProvisionalMeasurement`.
    - Render a semi-transparent sphere at the solved point.
    - Scale opacity/size by `1 - (uncertainty / maxUncertaintyHard)`.
3. Wire into the main render loop:
    - On each frame, iterate `state.measurementPoints.confirmed` and call `updateGpsDot` with the current alignment matrix.

#### Phase 4: React UI Layer
1. Subscribe to `selectMeasurementDraft` from the store.
2. Render coaching prompt text based on `draft.prompt`:
    - `move_sideways` → "Move sideways and mark again"
    - `add_more_rays` → "Add more rays from different angles"
    - `reaim_target` → "Re-aim at the same target and shoot again"
    - `ready_to_confirm` → "Ready to confirm ✓"
3. Show live uncertainty readout (e.g., a shrinking ring or numeric display).
4. Conditionally enable/disable the "Confirm" button based on `draft.canConfirm`.
5. Add "Undo Last Ray" button wired to `handleUndoRay()`.
6. Add a crosshair overlay (fixed center reticle) for the default aiming mode.
7. Wire tap events: normalize screen coordinates to `[0, 1]` camera texture space, call `handleShootRay(normX, normY)`.

---

### END-TO-END DATA FLOW

1. **Aim & Shoot**: User aims via fixed crosshair or screen tap. View layer normalizes coordinates to `[0, 1]` camera texture space.
2. **Capture (Atomic)**: Handler reads `getCurrentArPose()` and `state.recording.latestDepthSample` in the same synchronous tick. Invokes `createAimedRay` (Component 4) for ray construction and `sampleDepthPrior` (Component 2) for depth — both using the same projection matrix and aimed coordinates.
3. **Dispatch**: The assembled `MeasurementRayRecord` (containing frozen ray + depth) is dispatched via `addMeasurementRay`.
4. **Replay Capture**: Redux middleware persists the action to the action log (via `persistedExtraPrefixes`).
5. **State Update**: Slice appends to `pendingRays` AND internally calls `reduceLiveMeasurementDraft` to update its `draft` state (evaluating MSAC + quality purely).
6. **UI Update**: React reads `state.measurementPoints.draft` → renders coaching prompt, uncertainty readout, confirm button state.
7. **Visualization**: Three.js reads `selectProvisionalMeasurement` → updates provisional sphere position + transparency.
8. **Confirm**: User clicks "Confirm" (enabled only when `canConfirm === true`). Handler dispatches `requestConfirmMeasurement` (draft goes to `confirm_pending`).
9. **Storage & Render**: Handler triggers OPFS persistence asynchronously.
   - If success: Handler dispatches `confirmMeasurementSuccess`. Point migrates to `confirmed` array. Three.js renders dual dots.
   - If fail: Handler dispatches `confirmMeasurementFailure`. Draft goes to `confirm_failed`, allowing user to retry.
12. **Scenario Load**: On app startup or scenario switch, `loadAllMeasurementPoints` is called → `hydrateMeasurementPoints` dispatched → confirmed points restored → dual dots rendered.

---

### REPLAY & DETERMINISM GUIDELINES

- **Action payloads are frozen snapshots**: `addMeasurementRay` contains the already-computed ray origin, direction, depth point, and weight. During replay, only the serialized action is dispatched — the handler is NOT re-invoked. This eliminates `Date.now()`, projection matrix availability, and depth sample timing as replay concerns.
- **Handler replay guard**: `handleShootRay` checks for replay mode and returns immediately. Only action-log replay creates ray records during playback.
- **Seeded PRNG**: MSAC uses `createSeededRng(42)` by default. The seed is deterministic.
- **Policy binding**: `thresholdProfileId` and `thresholdVersion` are persisted on the measurement draft so coaching transitions replay identically even if default thresholds change.
- **Draft state is transient**: `updateDraft` is NOT whitelisted in `persistedExtraPrefixes`. During replay, it is recomputed from replayed `addMeasurementRay` actions and the deterministic quality evaluator.
- **Hydration dedup**: `hydrateMeasurementPoints` deduplicates by `id` to prevent double-counting if both OPFS load and action replay produce the same confirmed entity.

---

### POTENTIAL INTEGRATION RISKS AND MITIGATIONS

| # | Risk | Mitigation |
| :--- | :--- | :--- |
| 1 | **Coordinate Frame Mismatch** | All ray origins, directions, and depth unprojections use the AR-local frame. GPS-world conversion happens only at render-time via `arPosition × currentAlignmentMatrix`. |
| 2 | **Aspect Ratio Skew** | The UI tap handler normalizes screen coords to `[0, 1]` camera texture space using `normalizeAimingCoordinates` from `aiming-ray-capture.ts` (with `outOfBoundsPolicy: 'clamp'`). |
| 3 | **Performance during Replay** | `selectProvisionalMeasurement` is memoized. MSAC iterations are capped (default 100). Quality evaluation is O(1). Performance budget tests in Component 5 enforce p95 < 2ms. |
| 4 | **Temporal Disconnect (Pose vs Depth)** | Handler reads `arPose` and `latestDepthSample` synchronously in the same tick. Both use the same `projectionMatrix`. |
| 5 | **No Projection Matrix Early in Session** | If `latestDepthSample` is null (no depth dispatched yet), the handler falls back to crosshair-only `buildRayFromPose` and logs a warning. Tap-aim is blocked until a projection matrix arrives. |
| 6 | **Duplicate Entities on Hydration + Replay** | `hydrateMeasurementPoints` deduplicates by `id`. Replay-dispatched `confirmMeasurementPoint` actions that match already-hydrated entities are no-ops. |
| 7 | **OPFS Write Failure Leaves State Inconsistent** | `confirmMeasurementPoint` dispatches to Redux before the async OPFS write. If write fails, the entity exists in Redux but not on disk. On next reload, it vanishes. The `confirm_failed` state in the draft lifecycle handles this — the user is prompted to retry. |
| 8 | **Schema Evolution** | `schemaVersion: 1` in the entity allows future migrations. `isMeasurementPointEntity` rejects unknown versions at load time. |

---

### IMPLEMENTATION CONSTRAINTS
- Maximum function cyclomatic complexity: 10 (enforced by ESLint).
- All pure math functions must remain framework-free (no Three.js, no DOM, no WebXR).
- All view-layer code must be decomposed into small helper functions (≤ 10 CC each).

### TEST PLAN

#### Unit Tests (already exist, verify after fixes)
- `src/utils/ray-triangulation-core.test.ts` — solver geometry + weights + normalization.
- `src/utils/depth-prior-provider.test.ts` — quartic weight, edge penalty, bilinear lookup.
- `src/utils/aiming-ray-capture.test.ts` — ray construction, coordinate validation.
- `src/utils/robust-triangulation.test.ts` — MSAC, decoupled scoring, degeneracy prevention.
- `src/utils/live-measurement-quality.test.ts` — quality scoring, hysteresis, coaching prompts.
- `src/state/measurement-points-slice.test.ts` — Redux reducers + selectors.
- `src/storage/measurement-point-loader.test.ts` — OPFS round-trip, schema validation.

#### Integration Tests (to be created)
- `src/measurement-points/measurement-point-integration.test.ts`:
  - Shoot N rays → confirm → persist → load → verify entity equality.
  - Verify draft state machine transitions match quality evaluator output.
  - Verify replay guard prevents handler re-invocation during replay.
  - Verify hydration + replay deduplication.

#### E2E Replay Test
- Record a session that marks a point → replay on desktop → assert the identical `MeasurementPointEntity` (position within tolerance, uncertainty) is reproduced deterministically.

### DEMO
- The feature running inside the recorder on a phone outdoors and the same session replayed on desktop producing the identical point.
- Mark and confirm a point, reload the page, and see it come back as two connected dots.
- The gap between the dots reacts live as the alignment matrix updates.
