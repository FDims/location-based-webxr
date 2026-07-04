/**
 * Surface-nets coverage probe on a REAL recording (2026-06-30, local-only).
 *
 * Why this test matters: the user reported that on a real recorded session the
 * voxel grid (cubes) was nice and dense but the `'smooth'` surface-nets occluder
 * "had barely any surfaces". This probe loads that exact recording through the
 * real `loadRecording` → `OccupancyGrid.addSample` path, meshes the grid with
 * each strategy, and reports occupied-cell count + triangle coverage so the
 * sparsity is measured (not guessed). It is the executable record of the bug.
 *
 * Skip-if-missing: the zip is local-only test data (absent in CI), so this
 * enriches local runs and never gates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { meshOccupiedCells } from 'gps-plus-slam-app-framework/ar/occupancy-mesher';
import type { DepthSample } from 'gps-plus-slam-app-framework/types';
import { loadRecording } from '../storage/recording-loader';

const ZIP = path.resolve(
  __dirname,
  '../../../../gps-plus-slam/TestDataJs-Other/2026-06-30_20-18-08utc-sparse-surfacenets.zip'
);
const HAS_ZIP = fs.existsSync(ZIP);

describe.skipIf(!HAS_ZIP)(
  'surface-nets coverage on the 2026-06-30 sparse recording',
  () => {
    it('measures per-face vs corner-fit vs smooth coverage at the real grid', async () => {
      const loaded = await loadRecording(new Uint8Array(fs.readFileSync(ZIP)));
      const depthSamples = loaded.actions
        .map((e) => e.action)
        .filter((a) => a.type === 'recording/recordDepthSample')
        .map((a) => a.payload as DepthSample);
      expect(depthSamples.length).toBeGreaterThan(0);

      const grid = new OccupancyGrid({ cellSizeM: 0.15 });
      for (const s of depthSamples) grid.addSample(s);
      const getCellPoint = (c: Parameters<typeof grid.getCellPoint>[0]) =>
        grid.getCellPoint(c);

      const rows: Record<string, unknown>[] = [];
      for (const minConfidence of [1, 3, 5]) {
        const cells = grid.getOccupiedCells(minConfidence);
        if (cells.length === 0) continue;
        const perFace = meshOccupiedCells(cells, grid.cellSizeM);
        const cornerFit = meshOccupiedCells(cells, grid.cellSizeM, {
          mode: 'corner-fit',
          getCellPoint,
        });
        const smooth = meshOccupiedCells(cells, grid.cellSizeM, {
          mode: 'smooth',
          getCellPoint,
        });
        const t = (m: { indices: { length: number } }) => m.indices.length / 3;
        rows.push({
          minConfidence,
          occupiedCells: cells.length,
          perFaceTris: t(perFace),
          cornerFitTris: t(cornerFit),
          smoothTris: t(smooth),
          smoothVsPerFace: +(t(smooth) / Math.max(1, t(perFace))).toFixed(3),
        });
      }

      console.info(
        '[smooth coverage probe]\n' +
          JSON.stringify({ depthSamples: depthSamples.length, rows }, null, 2)
      );

      // The grid is dense (cubes cover it) — pin that we have real data here.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => (r.perFaceTris as number) > 0)).toBe(true);
      // Regression gate for the 2026-06-30 surface-nets rewrite: 'smooth' now
      // covers the full boundary like the cubes (it was 10–18 % with the old
      // 2×2-patch heuristic — the "barely any surfaces" bug). One quad per
      // crossing == one per exposed cube face ⇒ ~parity.
      expect(rows.every((r) => (r.smoothVsPerFace as number) >= 0.9)).toBe(
        true
      );
    });
  }
);
