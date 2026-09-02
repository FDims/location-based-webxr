# Measurement Points Feature Integration

This document outlines the changes made during the integration of the Measurement Points feature into the `GpsPlusSlamJs_RecorderApp` main system, and provides instructions on how to test it.

## 🚀 Summary of Changes

The Measurement Points feature was successfully integrated through a series of critical fixes and the addition of the final UI layer.

### 1. State Management (`measurement-points-slice.ts`)
*   **Draft State Machine:** Implemented the `draft` state (`LiveMeasurementDraft`) to drive the UI coaching banner and confirm gating.
*   **Selectors:** Updated all selectors to take the full `CombinedRootState` to ensure compatibility with the application's root Redux store.
*   **Hydration:** Added the `hydrateMeasurementPoints` reducer with ID-based deduplication to safely load persisted data.

### 2. Side-Effect Handlers (`measurement-point-handlers.ts`)
*   **Ray Capture:** `handleShootRay` now correctly constructs an off-axis ray using `createAimedRay()` when a projection matrix is available, enabling tap-to-aim.
*   **Replay Guard:** Added an `isReplayMode` guard to prevent double-counting rays when replaying a serialized action log.
*   **Async Persistence:** The confirm flow now spans three actions to properly handle the asynchronous OPFS file writes.

### 3. Data Persistence (`measurement-point-loader.ts` & `folder-manager.ts`)
*   **Nullable GPS Snapshot:** Changed `gpsPositionSnapshot` to be nullable (`Vector3 | null`). Prevents ghost dots at the `[0,0,0]` world origin if no GPS alignment exists yet.
*   **Scenario Loading:** Wired `loadAllMeasurementPoints` into `folder-manager.ts`.

### 4. 3D Visualization & UI Layer
*   **Provisional Sphere:** Opacity scales based on the solver's uncertainty metric (more transparent = high uncertainty, solid = confident).
*   **Coaching UI:** Framework-free UI module that renders a central crosshair, an uncertainty readout (`± X.X cm`), and a dynamic coaching banner.
*   **Main App Integration:** Mounted the UI into the `#app` DOM overlay during AR session initialization.

---

## 👀 How to Notice the Feature is Implemented

When you open the application and enter the AR recording mode, you will immediately notice the following new elements that signify the feature is active:

1.  **Central Crosshair:** A clear SVG reticle/crosshair will be present in the center of your screen.
2.  **Top Coaching Banner:** A dynamic text banner at the top of the screen providing instructions (e.g., "⊕ Tap to add observation ray").
3.  **UI Overlay Buttons:** In the measurement flow, you'll see actionable "Confirm" (often disabled initially) and "Undo Ray" buttons appearing dynamically.
4.  **Visual Feedback (Spheres & Dots):** During usage, you will see a yellow, partially transparent "Provisional Sphere" appearing in 3D space where your rays intersect. After confirming, it changes into a persistent solid green dot (AR space) accompanied by an orange dot (GPS space, if aligned).

---

## 🧪 How to Test in Real-Life AR

To truly test the robust triangulation and depth sensing, you must use a compatible WebXR device (e.g., a modern Android smartphone with ARCore or a compatible AR headset) in a physical environment. 

### Step-by-Step Field Test:

1.  **Preparation:**
    *   Deploy the app to your device or access the local dev server over a secure HTTPS connection (WebXR requires HTTPS).
    *   Go to an open space with distinct visual features (like corners of furniture or distinct patterns on the ground).
2.  **Start Recording:** Open the app and tap "Start AR Session".
3.  **Aim and Capture the First Ray:**
    *   Aim your device's crosshair exactly at a specific, easily identifiable physical feature (e.g., the corner of a table).
    *   Tap the screen to shoot an observation ray.
    *   *Notice:* The coaching banner will update, usually suggesting you move to get better parallax ("↔ Move sideways for better parallax").
4.  **Create Parallax (Crucial Step):**
    *   Walk sideways (left or right) about 1 to 2 meters. Keep your camera pointed at the **exact same physical feature** you aimed at in step 3.
    *   Tap the screen again to shoot a second ray.
5.  **Observe the Triangulation:**
    *   If your rays intersect cleanly, the system's MSAC solver will triangulate the point in 3D space.
    *   A **yellow Provisional Sphere** will materialize in the AR view exactly over the physical feature you were aiming at.
    *   Look at the uncertainty readout (e.g., `± 5.2 cm`). The lower the number, the more solid the yellow sphere becomes.
6.  **Refine the Measurement:**
    *   Walk to a third vantage point, aim at the same feature, and tap again. 
    *   *Notice:* The uncertainty should decrease, the yellow sphere should become more opaque, and the coaching banner will indicate "✓ Ready — tap Confirm to save" when the baseline is sufficient.
7.  **Confirm the Point:**
    *   Tap the newly enabled "Confirm" button on the UI.
    *   The provisional yellow sphere will disappear, replaced by a permanent **Green AR Dot** anchored perfectly to the physical feature you measured.
8.  **Verify GPS Alignment (If applicable):**
    *   If your device has acquired a valid GPS fix and alignment matrix during the session, an **Orange GPS Dot** will also appear at the location, proving the local AR coordinates were successfully projected into global GPS coordinates.

---

### Automated Tests

The integration test suite comprehensively verifies the state transitions, MSAC solver integration, Redux determinism, and persistence flows. You can run them locally via:

```bash
# Run specifically the integration tests
pnpm exec vitest run --config config/vitest.config.ts src/measurement-points/measurement-point-integration.test.ts

# Run all unit tests
pnpm run test:unit
```
