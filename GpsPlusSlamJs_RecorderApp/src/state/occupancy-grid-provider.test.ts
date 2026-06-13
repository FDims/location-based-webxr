/**
 * Tests for the occupancy-grid provider (COLMAP export plan Iter 2.5).
 *
 * Why this test file matters:
 * The COLMAP contributor and future grid consumers read the live grid through
 * this single accessor instead of a threaded reference. These tests pin the
 * registry contract: get returns exactly the instance that was set (same
 * reference, one shared grid), and clearing with null is honored (the
 * session-swap reset path).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getOccupancyGrid, setOccupancyGrid } from './occupancy-grid-provider';
import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';

afterEach(() => {
  // Module-level state — reset so tests don't leak into each other.
  setOccupancyGrid(null);
});

describe('occupancy-grid provider', () => {
  it('returns null before any grid is published', () => {
    expect(getOccupancyGrid()).toBeNull();
  });

  it('returns the exact instance that was set (same reference)', () => {
    const grid = new OccupancyGrid();
    setOccupancyGrid(grid);
    expect(getOccupancyGrid()).toBe(grid);
  });

  it('clears the reference when set to null (session swap / teardown)', () => {
    setOccupancyGrid(new OccupancyGrid());
    setOccupancyGrid(null);
    expect(getOccupancyGrid()).toBeNull();
  });

  it('replaces the reference on a new session, keeping a single instance', () => {
    const first = new OccupancyGrid();
    const second = new OccupancyGrid();
    setOccupancyGrid(first);
    setOccupancyGrid(second);
    expect(getOccupancyGrid()).toBe(second);
    expect(getOccupancyGrid()).not.toBe(first);
  });
});
