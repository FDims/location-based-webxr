/**
 * OccluderMeshDriver — coalescing + synchronous-fallback + error-recovery tests.
 *
 * The driver is the main-thread half of the Web Worker occluder offload. These
 * pin the policies that make it safe under a growing grid: at most one job in
 * flight with the NEWEST request winning (intermediates dropped), a synchronous
 * fallback when no worker is available, and — critically — **recovery from a
 * worker that never replies** (an uncaught throw in the worker, or a module that
 * fails to load). Without recovery the in-flight slot would stay set forever and
 * the occluder would silently freeze for the rest of the session (the 2026-07-01
 * "Phase 1 gap"). A fake poster stands in for a real Worker so the seam is
 * unit-tested without a worker environment.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  OccluderMeshDriver,
  type MeshWorkerPoster,
} from './occluder-mesh-driver';
import {
  runMeshRequest,
  type MeshWorkerRequest,
} from '../ar/occlusion-mesh-worker';
import { meshOccupiedCells } from '../ar/occupancy-mesher';
import type { GridCell } from '../ar/bresenham3d';

const CELL = 0.15;

function box(n: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) cells.push([x, 0, z]);
  return cells;
}

/**
 * A fake worker: records posted requests. `respond(i)` meshes one and fires
 * `onmessage`; `error()` fires `onerror` (a worker that threw / failed to load).
 */
function makeFakePoster() {
  const posted: MeshWorkerRequest[] = [];
  const poster: MeshWorkerPoster = {
    postMessage: vi.fn((message: MeshWorkerRequest) => {
      posted.push(message);
    }),
    onmessage: null,
    onerror: null,
  };
  const respond = (i: number): void => {
    const { response } = runMeshRequest(posted[i]!);
    poster.onmessage?.({ data: response });
  };
  const error = (): void => {
    poster.onerror?.(new Error('worker boom'));
  };
  return { poster, posted, respond, error };
}

describe('OccluderMeshDriver', () => {
  it('meshes synchronously (matching a direct mesh) when constructed without a worker', () => {
    const driver = new OccluderMeshDriver(null);
    const cells = box(4);
    let positions: Float32Array | null = null;
    let indices: Uint32Array | null = null;
    driver.request(cells, CELL, 'per-face', undefined, (p, i) => {
      positions = p;
      indices = i;
    });
    const direct = meshOccupiedCells(cells, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    expect(Array.from(positions!)).toEqual(Array.from(direct.positions));
  });

  it('posts to the worker and delivers the geometry on response', () => {
    const { poster, posted, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const cells = box(3);
    const results: number[] = [];
    driver.request(cells, CELL, 'greedy', undefined, (_p, i) => {
      results.push(i.length);
    });
    expect(posted).toHaveLength(1); // posted, not yet delivered
    expect(driver.busy).toBe(true);
    expect(results).toEqual([]);

    respond(0);
    expect(results).toHaveLength(1);
    expect(driver.busy).toBe(false);
  });

  it('coalesces to the LATEST request while a job is in flight (drops intermediates)', () => {
    const { poster, posted, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const done: string[] = [];
    driver.request(box(2), CELL, 'per-face', undefined, () => done.push('A'));
    driver.request(box(3), CELL, 'per-face', undefined, () => done.push('B'));
    driver.request(box(4), CELL, 'per-face', undefined, () => done.push('C'));

    // Only A is in flight; B and C coalesced (C is the survivor).
    expect(posted).toHaveLength(1);

    respond(0); // A completes → its callback fires, then C is posted
    expect(done).toEqual(['A']);
    expect(posted).toHaveLength(2);

    respond(1); // C completes; B was dropped
    expect(done).toEqual(['A', 'C']);
    expect(posted).toHaveLength(2);
  });

  it('recovers from a worker error (after a prior success): clears the wedge and re-posts the pending snapshot', () => {
    const { poster, posted, respond, error } = makeFakePoster();
    const onWorkerUnusable = vi.fn();
    const driver = new OccluderMeshDriver(poster, { onWorkerUnusable });
    const done: string[] = [];

    // Prove the worker works once, so a later error is transient (not a load failure).
    driver.request(box(2), CELL, 'per-face', undefined, () => done.push('A'));
    respond(0);
    expect(done).toEqual(['A']);

    // B goes in flight; C coalesces behind it as the pending (newest) job.
    driver.request(box(3), CELL, 'per-face', undefined, () => done.push('B'));
    driver.request(box(4), CELL, 'per-face', undefined, () => done.push('C'));
    expect(driver.busy).toBe(true);

    error(); // B's worker job fails and never replies
    // The driver must NOT wedge: it drops B, keeps the worker (already proven
    // good), and re-posts the pending C.
    expect(onWorkerUnusable).not.toHaveBeenCalled();
    expect(driver.busy).toBe(true); // C now in flight
    expect(posted).toHaveLength(3); // A, B, C  (C re-posted after the error)

    respond(2); // C completes; B was dropped (it failed)
    expect(done).toEqual(['A', 'C']);
    expect(driver.busy).toBe(false);
  });

  it('does not freeze after a worker error with nothing queued: the next request posts again', () => {
    const { poster, posted, respond, error } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    driver.request(box(2), CELL, 'per-face', undefined, () => {});
    respond(0); // prove the worker works → the next error is transient
    driver.request(box(3), CELL, 'per-face', undefined, () => {});
    expect(driver.busy).toBe(true);

    error(); // fails with nothing queued
    expect(driver.busy).toBe(false); // ← the bug was: `busy` stayed true forever

    // The next refresh must post again (the bug made every later request a
    // silently-dropped `pending` overwrite).
    const done: string[] = [];
    driver.request(box(2), CELL, 'per-face', undefined, () =>
      done.push('next')
    );
    expect(posted).toHaveLength(3);
    respond(2);
    expect(done).toEqual(['next']);
  });

  it('falls back to synchronous meshing when the worker errors before ever meshing (module load failure)', () => {
    const { poster, error } = makeFakePoster();
    const onWorkerUnusable = vi.fn();
    const driver = new OccluderMeshDriver(poster, { onWorkerUnusable });
    const cells = box(3);

    // The very first job is in flight when the worker's module fails to load →
    // onerror fires before any successful mesh.
    driver.request(cells, CELL, 'per-face', undefined, () => {});
    error();
    expect(onWorkerUnusable).toHaveBeenCalledTimes(1); // driver gives up on the worker

    // Subsequent requests now mesh synchronously on the main thread — the
    // occluder keeps working instead of freezing.
    let indices: Uint32Array | null = null;
    driver.request(cells, CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    const direct = meshOccupiedCells(cells, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    expect(driver.busy).toBe(false); // sync completes immediately
  });

  it('falls back to synchronous meshing when the worker errors BEFORE the first request (module load failure races ahead of the first post)', () => {
    const { poster, posted, error } = makeFakePoster();
    const onWorkerUnusable = vi.fn();
    const onError = vi.fn();
    const driver = new OccluderMeshDriver(poster, {
      onWorkerUnusable,
      onError,
    });
    const cells = box(3);

    // The realistic module-load-failure ordering: the worker's module fails to
    // load within a few ms of construction — BEFORE the first refresh posts any
    // job (inFlightId === null). Posting to a load-failed worker is silently
    // dropped (no second error), so if the driver ignored this error it would
    // wedge the in-flight slot forever on the first post (the residual freeze).
    error();
    expect(onWorkerUnusable).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(0); // never posted to the dead worker

    // The first (and every later) request now meshes synchronously.
    let indices: Uint32Array | null = null;
    driver.request(cells, CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    const direct = meshOccupiedCells(cells, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    expect(posted).toHaveLength(0); // still never posted to the worker
    expect(driver.busy).toBe(false);
  });

  it('ignores a stray worker error with no job in flight after a prior success (keeps the proven-good worker)', () => {
    const { poster, posted, respond, error } = makeFakePoster();
    const onWorkerUnusable = vi.fn();
    const driver = new OccluderMeshDriver(poster, { onWorkerUnusable });

    driver.request(box(2), CELL, 'per-face', undefined, () => {});
    respond(0); // worker proven good; the slot is now clear (inFlightId === null)
    expect(driver.busy).toBe(false);

    error(); // a stray / late error while nothing is in flight
    // The worker meshed once, so it must NOT be declared unusable over a stray
    // error — the fix for the pre-first-post freeze only fires when the worker
    // has never succeeded.
    expect(onWorkerUnusable).not.toHaveBeenCalled();

    // The next request still posts to the (kept) worker, not synchronously.
    driver.request(box(3), CELL, 'per-face', undefined, () => {});
    expect(posted).toHaveLength(2);
    expect(driver.busy).toBe(true);
  });

  it('does not wedge when synchronous meshing throws (bad cellSize): reports via onError and recovers', () => {
    const onError = vi.fn();
    const driver = new OccluderMeshDriver(null, { onError });
    // cellSizeM <= 0 makes meshOccupiedCells throw inside runMeshRequest.
    expect(() =>
      driver.request(box(2), 0, 'per-face', undefined, () => {})
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(driver.busy).toBe(false); // slot cleared, not wedged

    // A subsequent valid request still meshes.
    let indices: Uint32Array | null = null;
    driver.request(box(2), CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    expect(indices).not.toBeNull();
  });

  it('delivers nothing after dispose()', () => {
    const { poster, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const onMesh = vi.fn();
    driver.request(box(3), CELL, 'per-face', undefined, onMesh);
    driver.dispose();
    respond(0);
    expect(onMesh).not.toHaveBeenCalled();
    expect(poster.onmessage).toBeNull();
  });
});
