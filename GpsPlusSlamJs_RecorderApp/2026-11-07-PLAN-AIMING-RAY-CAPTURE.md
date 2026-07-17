**Improvement Update 1 (Unify Crosshair and Tap):** Removed `createCrosshairRay` in favor of reusing `createTapRay` with center coordinates `[0.5, 0.5]` to fix asymmetric camera offsets.
**Improvement Update 3 (Coordinate Clamping):** Explicitly mandated that out-of-bounds taps (e.g. on letterbox bars) must be clamped or rejected before calling the math utility.
**Improvement Update 4 (Explicit Failure Handling):** Required the view layer to gracefully abort the shoot action and warn the user if `createTapRay` fails (returns null).

### DESCRIPTION
Aiming + ray capture in AR (crosshair + tap). Turns a user "shoot" action into a mathematical ray in 3D space. It captures the device pose at that instant and builds the ray through a targeted pixel on the screen (unprojecting via the camera intrinsics). This pure utility provides the rays that are fed into the triangulation solver (Component 1).

### GOALS
- Compute a 3D ray through a specific screen pixel (tap, or crosshair fixed at `[0.5, 0.5]`) by unprojecting via the WebXR projection matrix.
- Guarantee consistency by routing all aiming (both crosshair and tap) through a single mathematical pathway, avoiding asymmetric camera offset bugs.
- Reuse the framework's existing unprojection infrastructure (`createDepthUnprojector`) to ensure consistency with depth prior mapping.
- Keep the math pure and testable (no DOM, no Three.js, no WebXR APIs directly inside the math functions).

#### File placement
The implementation (`aiming-ray-capture.ts` + `aiming-ray-capture.test.ts`) lives in **`src/utils/`** — it is a pure utility. The future `measurement-point-handlers.ts` will call these functions at shoot-time.

#### Viewport Alignment & Coordinates
The caller MUST map screen-space touch coordinates to the normalized camera texture coordinate frame `[0, 1]` matching the projection matrix before passing them to the provider. This prevents skew from aspect ratio differences between the screen and the camera feed. Furthermore, the caller MUST clamp or discard coordinates that fall outside `[0, 1]` (e.g., tapping on a letterboxed area) before invoking the unprojector.

#### Types

```typescript
import { createDepthUnprojector } from 'gps-plus-slam-app-framework/ar/depth-unprojection';

/**
 * A mathematical ray in 3D world space representing a user's measurement "shoot".
 */
export interface MeasurementRay {
  readonly origin: Vector3;
  /** Normalized direction vector. */
  readonly direction: Vector3; 
}
```

#### Functions

```typescript
// Using three.js or gl-matrix math would depend on the project's vector library.
// Assuming gps-plus-slam-js Vector3/Quaternion provide standard math operations.
// The recorder uses gl-matrix internally but exposes Vector3 objects.
// For the sake of the plan, we will use standard math functions assuming the
// Vector3 / Quaternion objects have methods or we use a math utility.

/**
 * Creates a ray originating at the camera and passing through a specific normalized
 * screen pixel (tap).
 * 
 * Uses the framework's createDepthUnprojector to handle inverse projection and
 * top-left coordinate conventions consistently with the depth grid.
 * 
 * @param cameraPos The world-space camera position
 * @param cameraRot The world-space camera rotation (quaternion)
 * @param projectionMatrix The camera's projection matrix
 * @param screenX Normalized [0, 1] screen X coordinate (top-left origin)
 * @param screenY Normalized [0, 1] screen Y coordinate (top-left origin)
 * @returns A MeasurementRay or null if the projection matrix is degenerate
 */
export function createTapRay(
  cameraPos: Vector3,
  cameraRot: Quaternion,
  projectionMatrix: number[] | Float32Array,
  screenX: number,
  screenY: number
): MeasurementRay | null {
  // Step 1: Create the unprojector. This handles the complex WebXR projection
  // inversion and top-left NDC Y-flip conventions.
  const unprojector = createDepthUnprojector(cameraPos, cameraRot, projectionMatrix);
  if (!unprojector) return null;

  // Step 2: Unproject a point at an arbitrary depth (e.g., 1.0 meters)
  // along the tapped pixel's line of sight.
  const targetPt = unprojector.unproject({ screenX, screenY, depthM: 1.0 });
  if (!targetPt) return null;

  // Step 3: Compute the direction vector from the camera origin to the unprojected target.
  const diffX = targetPt.x - cameraPos.x;
  const diffY = targetPt.y - cameraPos.y;
  const diffZ = targetPt.z - cameraPos.z;

  const length = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);
  if (length === 0) return null; // Degenerate tap ray

  const direction = {
    x: diffX / length,
    y: diffY / length,
    z: diffZ / length
  };

  return { origin: cameraPos, direction };
}
```

### TEST
Unit-test the pure ray-construction math. The framework tests `createDepthUnprojector` itself, so we focus on the ray assembly.

#### `createTapRay`
- Returns null if the projection matrix is invalid/degenerate.
- Center tap (`screenX=0.5, screenY=0.5`) on a symmetric projection matrix yields `(0, 0, -1)` if the camera rotation is identity (this handles the crosshair case).
- Top-left tap (`screenX=0, screenY=0`) yields a ray pointing toward the top-left of the camera frustum (positive Y, negative X in typical right-handed world coordinates if camera is identity).
- Direction is always exactly normalized length = 1.

### REPLAY DETERMINISM
`createTapRay` is a **pure function**. At shoot-time (live or during replay), the action handler reads the current `cameraPos`, `cameraRot`, and `projectionMatrix` from the deterministic WebXR pose stream, computes the `MeasurementRay`, and attaches it to the `addMeasurementRay` payload. Since the inputs are deterministic, the ray generation is perfectly deterministic.

### DEMO
The Component 4 demo should show:
1. **Crosshair Ray**: A scene (AR or desktop replay) where pressing a "Shoot Crosshair" button draws a long line originating from the camera and pointing straight into the scene center. As the camera moves, the line persists in world space.
2. **Tap Ray**: Tapping anywhere on the screen draws a line from the camera through that exact tapped pixel.
3. **Visual Verification**: The user can walk to the side and look back at the rays they just shot to visually confirm they originate from the past camera positions and point in the correct directions.

### INTEGRATION NOTE

#### Integration with Previous Components
This component (Component 4) forms the geometric half of a measurement "shoot". It must integrate seamlessly with **Component 2** (Depth-prior provider) and feed data into **Component 1** (Ray-triangulation core):

1. **Aiming Coordinates**: When the user shoots, the view layer determines the aimed pixel `(screenX, screenY)` (either a tapped pixel or `[0.5, 0.5]` for the crosshair).
2. **Ray Generation & Failure Handling (Component 4)**: The view layer calls `getCurrentArPose()` and passes the pose + clamped coordinates to this component (`createTapRay`) to generate a `MeasurementRay`. If it returns `null` (e.g., due to a degenerate matrix), the view layer must gracefully abort the action and warn the user.
3. **Depth Prior Generation (Component 2)**: Using the **exact same** `(screenX, screenY)` coordinates, the view layer calls `sampleDepthPrior()` (from Component 2) against the latest `DepthSample`. This ensures the depth reading perfectly aligns with the mathematical ray we just shot.
4. **State Action**: The `MeasurementRay` (from Comp 4) and the `DepthPriorObservation` (from Comp 2) are bundled together into the payload of the `addMeasurementRay` Redux action.
5. **Triangulation (Component 1 & 3)**: The triangulation solver (Component 1) consumes the list of dispatched `MeasurementRay`s to compute the closest-point-of-approach, folding in the depth priors as a distance-weighted soft prior.

This design ensures that the raw WebXR / Three.js state is captured purely at shoot-time, and the downstream core solver remains entirely framework-free.
