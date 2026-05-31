# `frame-conversions.ts`

## Purpose

Small, pure coordinate-frame helpers for the AR scene graph. Today it exposes
one function — `nueToArLocal` — that converts a **GPS-world NUE** point into
the **AR-odometry local** frame of `arWorldGroup`, i.e. computes
`alignment⁻¹ · nue`. This is the conversion a direct child of `arWorldGroup`
needs so that its WORLD position lands exactly on a GPS-world point.

It exists to give the `alignment⁻¹ · nue` math a single, named, tested home.
Omitting this conversion (writing raw `nue` into a child of `arWorldGroup`)
was the alignment-frame bug
([2026-05-31-gps-anchor-alignment-frame-bug.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md)).

## Public API

- `nueToArLocal(alignment, nue, out?) → THREE.Vector3`
  - `alignment` — 16-element **column-major** matrix array (AR-odometry NUE →
    GPS-world NUE), as produced by `getAlignmentMatrix()` /
    `THREE.Matrix4.toArray()`. **Read-only; not mutated.**
  - `nue` — GPS-world NUE point `[north, up, east]` in metres. **Not mutated.**
  - `out` — optional `THREE.Vector3` to write into and return (pass a reused
    scratch on hot paths to avoid allocation). Defaults to a fresh vector.
  - Returns `out`, set to `alignment⁻¹ · nue` (the AR-local position).
  - Error modes: none thrown. A singular/degenerate `alignment` yields the
    result of `THREE.Matrix4.invert()` on a non-invertible matrix (Three.js
    sets it to the zero matrix and warns), which is the caller's
    responsibility to avoid — real alignment matrices are rigid and always
    invertible.

## Invariants & assumptions

- **Explicit matrix, not the scene graph.** The helper takes the alignment
  array directly and never reads `Object3D.matrixWorld`. This is deliberate:
  reading the live group matrix (e.g. via `Object3D.worldToLocal`) would
  couple the result to the mid-lerp pose and break replay determinism. Full
  rationale: [2026-05-31-worldtolocal-frame-helper-review.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-worldtolocal-frame-helper-review.md).
- **Pure.** Same inputs → same output. Inputs are not mutated.
- **Positions only.** No quaternion/pose variant — no current caller sets a
  GPS-world rotation (YAGNI). Add one only when a caller needs it.
- **Rigid alignment ⇒ distance-preserving.** Real alignment matrices are
  rotation + translation with unit scale, so the inverse preserves Euclidean
  distances. This is what keeps `GpsAnchor`'s metre-based threshold gate
  meaningful after the change of frame.
- **No per-call allocation when `out` is supplied.** A module-private scratch
  `Matrix4` is reused; not reentrant (single-threaded JS makes that safe).

## Examples

```ts
import { nueToArLocal } from './frame-conversions.js';

// GpsAnchor steady-state: place a child of arWorldGroup at a GPS-world point.
const local = nueToArLocal(getAlignmentMatrix(), nue, scratchTarget);
object3D.position.copy(local); // object3D.getWorldPosition() === nue

// One-off (allocates):
const p = nueToArLocal(alignmentArray, [north, up, east]);
```

## Tests

- [frame-conversions.test.ts](frame-conversions.test.ts) — example-based:
  round-trip (`alignment · nueToArLocal(alignment, nue) ≈ nue`), bit-for-bit
  parity with the open-coded invert-and-apply it replaced, identity
  degenerate case, pure-translation and pure-rotation direction checks,
  `out`-reuse / fresh-allocation, input-immutability, distance preservation.
- [frame-conversions.property.test.ts](frame-conversions.property.test.ts) —
  property-based: round-trip and pairwise-distance preservation over fuzzed
  rigid alignments and points.
- The full AppFramework unit suite staying green after
  [gps-anchor.ts](gps-anchor.ts) was routed through this helper is the proof
  that the extraction introduced no behaviour change.
