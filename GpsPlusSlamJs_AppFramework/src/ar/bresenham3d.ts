/**
 * 3D Bresenham Line Tracer
 *
 * Direct port of the Unity occupancy-grid helper
 * (`PointCloudHelpers.BresenhamsLineAlgorithm`, after
 * http://members.chello.at/~easyfilter/bresenham.html): walks integer grid
 * cells from `start` to `end`, invoking a visitor per cell. Used by the
 * occupancy grid for free-space carving and raycasting.
 *
 * Semantics preserved from the Unity original:
 * - The visitor runs on the start cell BEFORE the stop-distance check.
 * - `stopDistance` is measured in dominant-axis (Chebyshev) steps from the
 *   end cell: tracing stops once the remaining distance reaches it, so the
 *   end cell and its `stopDistance`-neighborhood are not visited (except
 *   the unconditional start visit).
 * - Error offsets use integer division (`floor(dm / 2)`).
 *
 * @see bresenham3d.ts.md for detailed documentation
 */

/** Integer grid cell coordinate triple. */
export type GridCell = readonly [number, number, number];

/**
 * Main-thread safety cap: the maximum dominant-axis (Chebyshev) span a single
 * trace may cover. The trace runs synchronously, one iteration per
 * dominant-axis step, so an unbounded span freezes the UI. Finite-but-absurd
 * coordinates (a tracking glitch, a corrupt projectionMatrix unprojecting to a
 * huge world point) quantize to safe integers and pass the integer check, so
 * this is the only thing standing between such input and a multi-second
 * (potentially multi-billion-iteration) freeze.
 *
 * Chosen generously — at the grid's 0.15 m cells this is ~150 km, far beyond
 * any real AR scene, so it never trips on legitimate carving or raycasting.
 * It is a circuit breaker against programmer/data error, not a ray-length
 * policy: exceeding it throws (loud — surfaces the upstream bug) rather than
 * silently truncating the trace.
 */
export const MAX_TRACE_STEPS = 1_000_000;

/**
 * Trace the line from `start` to `end`, calling `visitCell` per cell.
 *
 * @param visitCell - return `false` to stop the trace early.
 * @param stopDistance - dominant-axis steps before `end` at which to stop
 *   (default 0 = trace all the way to `end`).
 * @throws TypeError when a coordinate is not a safe integer (cells must be
 *   quantized before tracing — programmer error, not a data error).
 * @throws RangeError when `stopDistance` is not a non-negative safe integer.
 *   The loop terminates on a counter (`i--`) that decrements unconditionally,
 *   so a negative or fractional value still terminates (it merely traces past
 *   `end`); but `NaN`/`-Infinity` never satisfy `i <= stopDistance` and would
 *   spin forever. Rejecting up front both prevents that freeze and enforces
 *   the "dominant-axis steps before end" contract.
 * @throws RangeError when the dominant-axis span exceeds {@link MAX_TRACE_STEPS}
 *   (circuit breaker against a synchronous main-thread freeze from
 *   finite-but-absurd coordinates).
 */
export function bresenham3d(
  start: GridCell,
  end: GridCell,
  visitCell: (cell: GridCell) => boolean,
  stopDistance = 0
): void {
  assertIntegerCell(start);
  assertIntegerCell(end);
  if (!Number.isSafeInteger(stopDistance) || stopDistance < 0) {
    throw new RangeError(
      `bresenham3d stopDistance must be a non-negative safe integer, got ${stopDistance}`
    );
  }

  let [x, y, z] = start;
  const dx = Math.abs(end[0] - x);
  const sx = x < end[0] ? 1 : -1;
  const dy = Math.abs(end[1] - y);
  const sy = y < end[1] ? 1 : -1;
  const dz = Math.abs(end[2] - z);
  const sz = z < end[2] ? 1 : -1;

  const dm = Math.max(dx, dy, dz);
  if (dm > MAX_TRACE_STEPS) {
    throw new RangeError(
      `bresenham3d dominant-axis span ${dm} exceeds MAX_TRACE_STEPS ${MAX_TRACE_STEPS}; ` +
        `cells [${start.join(', ')}]→[${end.join(', ')}] are too far apart to trace synchronously`
    );
  }
  let i = dm;
  let errX = Math.floor(dm / 2);
  let errY = errX;
  let errZ = errX;

  for (;;) {
    if (!visitCell([x, y, z])) {
      return;
    }
    if (i-- <= stopDistance) {
      return;
    }
    errX -= dx;
    if (errX < 0) {
      errX += dm;
      x += sx;
    }
    errY -= dy;
    if (errY < 0) {
      errY += dm;
      y += sy;
    }
    errZ -= dz;
    if (errZ < 0) {
      errZ += dm;
      z += sz;
    }
  }
}

function assertIntegerCell(cell: GridCell): void {
  if (!cell.every((v) => Number.isSafeInteger(v))) {
    throw new TypeError(
      `bresenham3d requires integer cell coordinates, got [${cell.join(', ')}]`
    );
  }
}
