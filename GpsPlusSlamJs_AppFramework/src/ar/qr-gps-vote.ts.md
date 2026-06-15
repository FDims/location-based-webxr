# qr-gps-vote.ts

**Purpose:** Turn a solved QR pose into synthetic high-weight GPS observation(s)
for the existing weighted-Kabsch/RANSAC fusion — Phase 5 / §6 of the
[QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).
A QR does **not** rigidly re-anchor the scene; it votes (heavily) via the normal
`recordGpsEvent` path, so a bad detection is still rejectable as a RANSAC
outlier.

## Public API

- `buildQrGpsVotes(input): RecordGpsEventPayload[]` — the payloads for one
  detection. 4 corner correspondences by default (`multiCorrespondence`), or 1
  center correspondence. Each pairs the corner's odom position (solved pose) with
  its absolute geo position (level file), stamped with `syntheticAccuracyM`.
  Throws `RangeError` on non-positive `sizeM` / `syntheticAccuracyM`.
- `localPlaneToEnu(localX, localY, headingDeg): Enu` — QR-plane offset → ENU
  meters (vertical-QR convention: +y = up, +x along `headingDeg` clockwise from
  North → `east = x·sin h`, `north = x·cos h`).
- `offsetGeo(center, enu): {latitude, longitude, altitude}` — apply an ENU meter
  offset to a geo pose (equirectangular; exact enough for sub-meter corners;
  guards the cos(lat)→0 pole case).
- `QrGeoPose`, `QrGpsVoteInput`, `Enu`, `METERS_PER_DEG_LAT` (111320).

## Invariants & assumptions

- **`weight = 1/accuracy^gpsAccuracyExponent`** is computed by the core library
  from `latLongAccuracy`; this module only sets the tiny `syntheticAccuracyM`
  (e.g. 0.05 m → ≈10× a normal 5 m fix). Pick & validate it against the fusion,
  don't hardcode blindly.
- **4 corners are coplanar.** They constrain the in-plane axes and translation
  well; the QR-normal (depth) DOF stays weakest — exactly what
  [qr-occupancy-check.ts.md](qr-occupancy-check.ts.md) guards. Do not treat the
  4 corners as a substitute for the size sanity check.
- **Vertical-QR geo convention:** local +Y = world up (altitude), local +X =
  horizontal at `headingDeg`. A flat-on-floor QR would need a different mapping;
  the demonstrator assumes wall-mounted.
- **Frame split:** `odomPosition` is raw-WebXR/odom (the reducer applies
  `webxrToNUE` on store); `rawGpsPoint` is absolute lat/lon/alt. The library
  computes the derived NUE coordinates + weight on dispatch.
- Pure: builds payloads only. Dispatching is the caller's job (Phase 6).

## Examples

```ts
const votes = buildQrGpsVotes({
  qrPoseWorld: solution.qrPoseWorld,
  sizeM: level.qr.physicalSizeM,
  qrGeo: level.qr.geo,
  syntheticAccuracyM: 0.05,
});
for (const v of votes) store.dispatch(recordGpsEvent(v));
```

## Tests

- `qr-gps-vote.test.ts` — ENU/geo conversions, 4-vs-1 correspondence, odom
  positions match the transformed object points, altitude spread, accuracy
  stamping, rotation override, input validation.
- `qr-gps-vote.property.test.ts` — for any size/heading/location the geo corners
  back-convert to a centered square of side `sizeM` whose centroid is the QR
  center (so the fusion sees the same rigid square in both frames).
- `qr-gps-vote.integration.test.ts` — the votes flow through the real
  `createSlamAppStore` + `recordGpsEvent` fusion and yield a finite alignment;
  a lone grossly-wrong high-weight vote does not produce a non-finite alignment
  (RANSAC robustness — the magnitude of the "shift toward QR" is validated by
  the Phase 6 demonstrator).

## Related

- Consumes `qrPoseWorld` from [qr-pose.ts.md](qr-pose.ts.md).
- Mirrors the normal GPS path in
  [gps-event-coordinator.ts.md](../state/gps-event-coordinator.ts.md).
