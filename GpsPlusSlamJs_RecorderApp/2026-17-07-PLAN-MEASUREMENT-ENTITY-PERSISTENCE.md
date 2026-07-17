### DESCRIPTION
Persist a confirmed Measurement Point to disk, reusing the recorder's per-scenario point storage and dual-frame (AR-local vs GPS-world) visualization infrastructure. Wire this persistence into the Redux action model so that the entire marking flow can be deterministically replayed on desktop from a recorded session.

### GOALS
- Create the MeasurementPoint entity to be persisted.
- Reuse existing `RefPointDefinition` / `RefPointObservation` storage and visualization patterns.
- Solve in the AR-local frame, then store both the AR-local position and the GPS-world position (via the alignment matrix).
- Render as two connected dots to show alignment error (similar to raw-GPS vs fused markers).
- Wire Redux actions for adding/confirming/deleting, along with undo/redo support.
- Ensure deterministic replay of the measurement flow on desktop using recorded sessions.

### DESIGN DECISIONS

#### Storage Location
Measurement points will live in a sibling `measurementPoints/` directory inside the scenario folder, rather than mixing with `refPoints/` using a type discriminator. This keeps the schema clean and avoids complicating the existing RefPoint parsing logic.

#### Redux Action Model — RTK `createSlice` Pattern
Create a new `measurement-points-slice.ts` using RTK's `createSlice`, consistent with the existing `ref-points-slice.ts` and `scenario-slice.ts` pattern. The slice owns:
- `addMeasurementRay`: capture the pose + depth observation into a pending list.
- `confirmMeasurementPoint`: commit the solved point to the confirmed list.
- `deleteMeasurementPoint`: remove the point.
- `undoMeasurementRay`: remove the last added ray from the pending list (for the marking flow undo/redo).
- `resetMeasurementPoints`: clear all state (lifecycle reset).

Undo/redo uses the recorder's existing undo stack.

#### Replay Determinism — `persistedExtraPrefixes` Registration
The new measurement-points slice **must** be registered in `recorder-store.ts`:

```typescript
// In createRecorderStore:
persistedExtraPrefixes: [
  slicePrefixOf(addRefPointEntry.type),
  slicePrefixOf(recordQrDetection.type),
  slicePrefixOf(addMeasurementRay.type),   // ← NEW
],
extraReducers: {
  refPoints: refPointsReducer,
  routing: routingReducer,
  scenario: scenarioReducer,
  qrDetected: qrDetectedReducer,
  measurementPoints: measurementPointsReducer,  // ← NEW
},
```

Without this, every measurement action is **silently discarded** during recording and replay produces zero measurement points.

#### GPS Position: Stored Snapshot vs Live Recomputation
The entity stores `gpsPositionSnapshot` — the GPS-world position computed at confirm-time via the alignment matrix. This snapshot is used only for cross-session recovery (when loading persisted data without an active SLAM session).

The **visualization layer** must **not** render this stored snapshot directly. Instead, it recomputes the GPS-world position every frame from `arPosition × currentAlignmentMatrix`. This is what makes the gap between the two dots react live as the alignment matrix improves, fulfilling the demo requirement. The stored snapshot is a fallback for when no live alignment matrix is available.

#### Schema Version for Forward Compatibility
The entity carries a `schemaVersion: 1` field. The loader validates and rejects unknown versions. This prevents the migration debt seen with `RefPointDefinition` (legacy data missing `fusedGpsPoint`, per-field fallback logic in `flattenRefPointsToMarks`).

#### Ray Record: No Redundant `arPose` Matrix
Each `MeasurementRayRecord` stores only `rayOrigin` + `rayDirection` (6 numbers), not the full `arPose` 4×4 matrix (16 numbers). The origin and direction are the load-bearing inputs for the triangulation solver; storing both would create a divergence risk if the derivation logic changes. The full AR pose is already captured in the action log for replay.

#### OPFS Write Pattern — Abort on Failure
All OPFS writes must use the "abort writable on failure" pattern from `writeRefPointDefinitionFile` in `ref-point-loader.ts`: if `write()` or `close()` throws, explicitly call `abort()` to release the lock. Factor this into a shared `writeJsonToOpfs(handle, filename, data)` utility to avoid reimplementing the pattern.

#### ZIP Export — Scoped Out for v1
Measurement points are **not** included in ZIP exports for v1. A `measurement-points-zip-contributor.ts` can be added in a follow-up when the feature stabilises. This is explicitly scoped out to avoid coupling the initial implementation to the ZIP pipeline.

### ARCHITECTURE
- **Storage Layer**: Models the `RefPointDefinition` / `RefPointObservation` pattern exactly. A new `measurement-point-loader.ts` in `src/storage/` reads/writes from a `measurementPoints/` directory inside the scenario handle. Includes an `isMeasurementPointEntity` type guard for load-time validation.
- **Redux Slice**: A new `measurement-points-slice.ts` in `src/state/` using `createSlice`. Registered in `recorder-store.ts` via `extraReducers` and `persistedExtraPrefixes`.
- **Provisional Solver (Selector)**: A memoized Reselect selector (`selectProvisionalMeasurement`) computes the live MSAC solution from `state.measurementPoints.pendingRays`. This single source of truth prevents the React UI and Three.js view from running duplicate, out-of-sync heavy computations.
- **Visualization Layer**: Small Three.js helper functions draw the dual-dot representation + connecting line. The GPS dot position is recomputed from `arPosition × currentAlignmentMatrix` every frame. The provisional sphere is rendered by listening to `selectProvisionalMeasurement`.
- **Replay Layer**: The `MeasurementPoint` actions are whitelisted in `persistedExtraPrefixes` so they appear in the action log and replay faithfully.

### INTERFACES

```typescript
import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import type { ArPoseTuples } from 'gps-plus-slam-app-framework/types/ar-types';

/**
 * A single ray observation recorded at "shoot" time.
 * Models the RefPointObservation pattern by storing the raw device arPose,
 * while ALSO storing the derived ray geometry to support tap unprojections.
 */
export interface MeasurementRayRecord {
  readonly id: string;
  readonly timestamp: number;
  
  /** The raw device pose at capture */
  readonly arPose: ArPoseTuples;
  
  /** Derived ray origin in AR-local space */
  readonly rayOrigin: Vector3;
  /** Derived ray direction in AR-local space (unit vector) */
  readonly rayDirection: Vector3;
  
  /** Ray weight (e.g. 1.0 for manual crosshair) */
  readonly rayWeight: number;
  /** Unprojected depth point in AR-local space, if available */
  readonly depthPoint?: Vector3;
  /** Depth weight decaying with distance, if available */
  readonly depthWeight?: number;
}

/**
 * A confirmed measurement point persisted to disk.
 * Schema-versioned for forward compatibility.
 */
export interface MeasurementPointEntity {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly scenarioId: string;

  /** The rays used to triangulate this point */
  readonly observations: MeasurementRayRecord[];

  /** Ground truth: solved position in AR-local frame */
  readonly arPosition: Vector3;
  /**
   * Snapshot of GPS-world position at confirm time (via alignment matrix).
   * Used for cross-session recovery only.
   * The LIVE visualization recomputes from arPosition × currentAlignmentMatrix.
   */
  readonly gpsPositionSnapshot: Vector3;

  readonly uncertainty: number;
  readonly rmsError: number;

  /** IDs of observations classified as inliers by the robust solver */
  readonly inlierIds: string[];
  /** IDs of observations classified as outliers by the robust solver */
  readonly outlierIds: string[];
}
```

### FUNCTIONS

```typescript
// ── Redux Slice (src/state/measurement-points-slice.ts) ───────────────────
// Uses RTK createSlice, consistent with ref-points-slice.ts pattern.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface MeasurementPointsState {
  /** Rays accumulated for the currently-being-measured point (pre-confirm) */
  readonly pendingRays: MeasurementRayRecord[];
  /** Confirmed, persisted measurement points */
  readonly confirmed: MeasurementPointEntity[];
}

const measurementPointsSlice = createSlice({
  name: 'measurementPoints',
  initialState: { pendingRays: [], confirmed: [] } as MeasurementPointsState,
  reducers: {
    addMeasurementRay(state, action: PayloadAction<MeasurementRayRecord>) {
      // Append ray to pending list
    },
    confirmMeasurementPoint(state, action: PayloadAction<MeasurementPointEntity>) {
      // Move pending → confirmed, clear pending
    },
    deleteMeasurementPoint(state, action: PayloadAction<{ id: string }>) {
      // Remove from confirmed by id
    },
    undoMeasurementRay(state) {
      // Pop the last ray from pending list
    },
    resetMeasurementPoints(state) {
      // Clear all state
    },
  },
});

export const {
  addMeasurementRay,
  confirmMeasurementPoint,
  deleteMeasurementPoint,
  undoMeasurementRay,
  resetMeasurementPoints,
} = measurementPointsSlice.actions;

export const measurementPointsReducer = measurementPointsSlice.reducer;

/**
 * Memoized selector that runs the MSAC solver on the pending rays.
 * Provides the single source of truth for the provisional UI coaching
 * banner and the live Three.js provisional sphere.
 */
export const selectProvisionalMeasurement = createSelector(
  [(state: RootState) => state.measurementPoints.pendingRays],
  (pendingRays) => solveRobustTriangulation(pendingRays)
);


// ── Storage (src/storage/measurement-point-loader.ts) ─────────────────────
// Takes FileSystemDirectoryHandle (the scenario handle), NOT FolderManager.

/**
 * Type guard: validates parsed JSON matches MeasurementPointEntity shape.
 * Prevents runtime crashes from malformed or legacy JSON files.
 * Validates schemaVersion, nested observations, and required fields.
 */
export function isMeasurementPointEntity(
  value: unknown
): value is MeasurementPointEntity;

/**
 * Load all measurement points from the scenario's measurementPoints/ directory.
 * Returns [] if the directory does not exist yet.
 */
export async function loadAllMeasurementPoints(
  scenarioHandle: FileSystemDirectoryHandle
): Promise<MeasurementPointEntity[]>;

/**
 * Persist a confirmed measurement point to the measurementPoints/ directory.
 * Creates the directory if it doesn't exist.
 * Uses the shared OPFS "abort writable on failure" pattern.
 */
export async function writeMeasurementPoint(
  scenarioHandle: FileSystemDirectoryHandle,
  entity: MeasurementPointEntity
): Promise<void>;

/**
 * Delete a measurement point file from the measurementPoints/ directory.
 */
export async function deleteMeasurementPointFile(
  scenarioHandle: FileSystemDirectoryHandle,
  pointId: string
): Promise<void>;


// ── Shared OPFS utility (src/storage/opfs-write-helpers.ts) ───────────────
// Factored out from ref-point-loader.ts writeRefPointDefinitionFile.

/**
 * Atomically write a JSON object to an OPFS file.
 * Uses the "abort writable on failure" pattern: if write() or close()
 * throws, explicitly abort() to release the lock.
 */
export async function writeJsonToOpfs(
  directoryHandle: FileSystemDirectoryHandle,
  filename: string,
  data: unknown
): Promise<void>;


// ── Visualization (src/view/measurement-point-view.ts) ────────────────────
// Decomposed into small functions (each ≤ 10 cyclomatic complexity).

/** Create the Three.js group for one measurement point (two spheres + line). */
export function createDualDotGroup(): THREE.Group;

/** Update the AR-local dot position. */
export function updateArDot(
  group: THREE.Group,
  arPosition: Vector3
): void;

/**
 * Recompute and update the GPS-world dot position from arPosition × alignmentMatrix.
 * This is what makes the gap react live to alignment updates.
 */
export function updateGpsDot(
  group: THREE.Group,
  arPosition: Vector3,
  alignmentMatrix: Matrix4
): void;

/** Redraw the connecting line between the two dots. */
export function updateConnectionLine(
  group: THREE.Group
): void;

/**
 * Convert an AR-local position to GPS-world coordinates
 * using the current alignment matrix.
 */
export function arLocalToGpsWorld(
  arPosition: Vector3,
  alignmentMatrix: Matrix4
): Vector3;
```

### INTEGRATION
1. **Redux Store**: Add `measurementPoints: measurementPointsReducer` to `extraReducers` in `createRecorderStore`. Add `slicePrefixOf(addMeasurementRay.type)` to `persistedExtraPrefixes`. Add `MeasurementPointsState` to `CombinedRootState`.
2. **Storage**: Call `writeMeasurementPoint` as a side-effect of `confirmMeasurementPoint` dispatch (mirroring how `saveRefPointObservation` is called from `ref-point-handlers.ts`). Use `FileSystemDirectoryHandle` from `getCurrentScenarioHandle()`.
3. **Replay**: No extra wiring needed — `persistedExtraPrefixes` registration (step 1) ensures actions are recorded and replayed automatically.
4. **Visualization**: Subscribe to `state.measurementPoints.confirmed` in the main render loop. For each entity, call `updateGpsDot(group, entity.arPosition, currentAlignmentMatrix)` every frame to recompute the GPS dot position live.

### IMPLEMENTATION CONSTRAINTS
- **Maximum Function Complexity**: Any function implemented must have a cyclomatic complexity of 10 or less to ensure maintainability and testability.

### IMPLEMENTATION
- Create `src/state/measurement-points-slice.ts` — RTK slice, reducers, and the `selectProvisionalMeasurement` selector.
- Create `src/storage/measurement-point-loader.ts` — Entity types, OPFS read/write with validation guard (modeled after `ref-point-loader.ts`).
- Create `src/storage/opfs-write-helpers.ts` — Shared `writeJsonToOpfs` extracted from `ref-point-loader.ts`.
- Update `src/state/recorder-store.ts` — Register slice in `extraReducers` + `persistedExtraPrefixes` + `CombinedRootState`.
- Create `src/measurement-points/measurement-point-handlers.ts` — Side-effect orchestration (capture, persist).
- Create `src/view/measurement-point-view.ts` — Decomposed dual-dot rendering.

### TEST
- **Unit Tests**:
  - `measurement-points-slice.test.ts`: Verify state updates for add, confirm, delete, and reset reducers.
  - `measurement-point-loader.test.ts`: Verify JSON serialization and deserialization round-trips correctly. Verify `isMeasurementPointEntity` rejects malformed data (missing fields, wrong schemaVersion, invalid observations).
  - `measurement-point-view.test.ts`: Verify `arLocalToGpsWorld` produces correct GPS coordinates against a known alignment matrix.
- **Integration Tests**:
  - A round-trip test (confirm a point → persist → reload → recover an equivalent entity, with both frames intact); the AR↔GPS conversion is correct against a known alignment matrix; undo/redo restores prior state.
- **e2e Replay Test**: 
  - Replay a recorded session that marks a point, and assert the identical Measurement Point is reproduced deterministically.

### DEMO
- Mark and confirm a point, reload, and see it come back as the two connected dots; show the gap reacting as the alignment matrix updates.
- Replay the session on desktop and show the exact same point generated.
