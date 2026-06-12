/**
 * 3D Bresenham Tests — known line traces and stop-distance semantics.
 *
 * Why this test matters:
 * bresenham3d is a direct port of the Unity PointCloudHelpers algorithm
 * that both free-space carving and grid raycasting are built on. The
 * stop-distance semantics (dominant-axis / Chebyshev steps, visitor runs
 * on the start cell BEFORE the stop check) must match the Unity original
 * exactly — the occupancy grid's carving guarantees depend on them.
 */

import { describe, it, expect } from 'vitest';
import { bresenham3d, MAX_TRACE_STEPS, type GridCell } from './bresenham3d';

function trace(start: GridCell, end: GridCell, stopDistance = 0): GridCell[] {
  const visited: GridCell[] = [];
  bresenham3d(
    start,
    end,
    (cell) => {
      visited.push(cell);
      return true;
    },
    stopDistance
  );
  return visited;
}

describe('bresenham3d', () => {
  it('traces a straight axis-aligned line including both endpoints', () => {
    expect(trace([0, 0, 0], [3, 0, 0])).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ]);
  });

  it('traces an exact 3D diagonal stepping all axes together', () => {
    expect(trace([0, 0, 0], [3, 3, 3])).toEqual([
      [0, 0, 0],
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3],
    ]);
  });

  it('traces in negative directions', () => {
    expect(trace([0, 0, 0], [-2, 0, -2])).toEqual([
      [0, 0, 0],
      [-1, 0, -1],
      [-2, 0, -2],
    ]);
  });

  it('visits only the start cell when start equals end', () => {
    expect(trace([5, -3, 7], [5, -3, 7])).toEqual([[5, -3, 7]]);
  });

  it('matches the known mixed-slope trace of the Unity reference', () => {
    // dm = 4 (x dominant), dy = 2, dz = 1, error offsets start at dm/2 = 2;
    // hand-stepped through the Unity algorithm (integer error arithmetic)
    expect(trace([0, 0, 0], [4, 2, 1])).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 1, 0],
      [3, 1, 1],
      [4, 2, 1],
    ]);
  });

  it('stops stopDistance dominant-axis steps before the endpoint', () => {
    // dm = 4; stopDistance = 2 -> visited indices 0..2 (endpoint -2)
    expect(trace([0, 0, 0], [4, 0, 0], 2)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it('still visits the start cell when stopDistance >= line length (Unity parity)', () => {
    // The visitor runs on the start cell before the stop check — this is
    // the §2 edge case the occupancy grid must compensate for by skipping
    // carving entirely when start == end.
    expect(trace([0, 0, 0], [1, 0, 0], 5)).toEqual([[0, 0, 0]]);
  });

  it('stops early when the visitor returns false', () => {
    const visited: GridCell[] = [];
    bresenham3d([0, 0, 0], [5, 0, 0], (cell) => {
      visited.push(cell);
      return cell[0] < 2;
    });
    expect(visited).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it('throws on non-integer coordinates (programmer error)', () => {
    expect(() => bresenham3d([0.5, 0, 0], [1, 0, 0], () => true)).toThrow(
      TypeError
    );
    expect(() => bresenham3d([0, 0, 0], [NaN, 0, 0], () => true)).toThrow(
      TypeError
    );
  });

  // stopDistance is validated up front because the loop terminates on a
  // counter that decrements unconditionally: a negative/fractional value still
  // terminates (it just traces past `end`), but NaN/-Infinity never satisfy
  // `i <= stopDistance` and would spin the main thread forever. The guard also
  // enforces the "non-negative dominant-axis steps before end" contract.
  it('throws RangeError on a stopDistance that breaks the contract or hangs the loop', () => {
    for (const bad of [NaN, -Infinity, Infinity, -1, 0.5]) {
      expect(() => bresenham3d([0, 0, 0], [3, 0, 0], () => true, bad)).toThrow(
        RangeError
      );
    }
  });

  // Circuit breaker: finite-but-absurd coordinates (a tracking glitch, a
  // corrupt projectionMatrix unprojecting to a huge world point) quantize to
  // safe integers, so they pass the integer check yet would spin the loop
  // for billions of synchronous iterations and freeze the main thread. The
  // dominant-axis span is bounded up front, before any visiting, by a throw.
  describe('main-thread safety cap', () => {
    it('throws RangeError when the dominant-axis span exceeds MAX_TRACE_STEPS', () => {
      expect(() =>
        bresenham3d([0, 0, 0], [MAX_TRACE_STEPS + 1, 0, 0], () => true)
      ).toThrow(RangeError);
    });

    it('throws before invoking the visitor (the loop is never entered)', () => {
      const visited: GridCell[] = [];
      expect(() =>
        bresenham3d([0, 0, 0], [MAX_TRACE_STEPS + 1, 0, 0], (cell) => {
          visited.push(cell);
          return true;
        })
      ).toThrow(RangeError);
      expect(visited).toEqual([]);
    });

    it('still traces normally exactly at the cap boundary', () => {
      let count = 0;
      bresenham3d([0, 0, 0], [MAX_TRACE_STEPS, 0, 0], () => {
        count++;
        // stop immediately — we only assert the call was allowed, not walk
        // the whole (large but bounded) line
        return false;
      });
      expect(count).toBe(1);
    });
  });
});
