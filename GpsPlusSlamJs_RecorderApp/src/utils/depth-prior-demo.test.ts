/**
 * @file depth-prior-demo.test.ts
 *
 * Executable demo for the DepthPriorProvider system.
 *
 * Aims at a NEAR object and a FAR object, prints the depth point and its
 * confidence, and produces a distance-sweep table showing confidence
 * collapsing at range.
 *
 * Run with:
 *   npx vitest run src/utils/depth-prior-demo.test.ts --reporter=verbose
 */
import { describe, it, expect } from 'vitest';
import {
  sampleDepthPrior,
  computeDepthWeight,
  type DepthSampleInput,
} from './depth-prior-provider';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-app-framework/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a column-major WebXR-style perspective matrix.
 * Same element layout as Three.js PerspectiveCamera.projectionMatrix.elements.
 */
function makePerspectiveMatrix(fovYDeg: number, aspect: number): Matrix4 {
  const fovYRad = (fovYDeg * Math.PI) / 180;
  const f = 1.0 / Math.tan(fovYRad / 2.0);
  const near = 0.1;
  const far = 100.0;
  const nf = 1.0 / (near - far);
  // column-major, 16 elements
  return [
    f / aspect, 0,  0,                     0,
    0,          f,  0,                     0,
    0,          0,  (far + near) * nf,    -1,
    0,          0,  2 * far * near * nf,   0,
  ] as unknown as Matrix4;
}

/** Build a flat-surface DepthSampleInput centred on the crosshair (0.5, 0.5). */
function makeFlatSample(
  depthM: number,
  projectionMatrix: Matrix4,
  cameraPos: Vector3,
  cameraRot: Quaternion,
): DepthSampleInput {
  return {
    points: [
      { screenX: 0.500, screenY: 0.500, depthM },
      { screenX: 0.490, screenY: 0.500, depthM },
      { screenX: 0.510, screenY: 0.500, depthM },
      { screenX: 0.500, screenY: 0.490, depthM },
      { screenX: 0.500, screenY: 0.510, depthM },
    ],
    projectionMatrix,
    cameraPos,
    cameraRot,
  };
}

/** Right-pad a string to a fixed width. */
function pad(s: string, w: number): string {
  return s.padEnd(w);
}

/** Render an ASCII confidence bar scaled 0..1 -> `width` chars. */
function confidenceBar(weight: number, width = 20): string {
  const filled = Math.round(weight * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ---------------------------------------------------------------------------
// Shared scene constants
// ---------------------------------------------------------------------------

const PROJ: Matrix4       = makePerspectiveMatrix(60, 16 / 9); // 60° FoV, 16:9 phone
const CAM_POS: Vector3    = [0, 1.6, 0];                       // standing height, 1.6 m
const CAM_ROT: Quaternion = [0, 0, 0, 1];                      // identity, looking -Z
const REF_RANGE_M         = 2.0;                                // ToF knee distance

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Depth Prior Provider — interactive demo', () => {
  // -------------------------------------------------------------------------
  it('TARGET A — aims at a NEAR object (1.2 m) and reports depth + confidence', () => {
    const NEAR_DEPTH = 1.2;
    const sample = makeFlatSample(NEAR_DEPTH, PROJ, CAM_POS, CAM_ROT);
    const obs = sampleDepthPrior(sample, 0.5, 0.5, { referenceRangeM: REF_RANGE_M });

    expect(obs).not.toBeNull();

    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('  TARGET A — NEAR OBJECT  (1.2 m)');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`  Aimed screen position : (0.500, 0.500)`);
    console.log(`  Raw depth reading     : ${obs!.depthM.toFixed(3)} m`);
    const p = obs!.point;
    console.log(
      `  Unprojected 3D point  : (${p[0].toFixed(4)}, ${p[1].toFixed(4)}, ${p[2].toFixed(4)})  [world/WebXR frame]`,
    );
    console.log(`  Confidence weight     : ${obs!.weight.toFixed(5)}  ${confidenceBar(obs!.weight)}`);
    console.log('  ✓ Near object -> HIGH confidence (well inside knee distance)');
    console.log('════════════════════════════════════════════════════════════════');

    expect(obs!.depthM).toBeCloseTo(NEAR_DEPTH, 4);
    expect(obs!.weight).toBeGreaterThan(0.85);   // 1.2 m < 2 m knee -> weight ≈ 0.885
    expect(obs!.point[2]).toBeLessThan(0);       // camera looks -Z in WebXR frame
  });

  // -------------------------------------------------------------------------
  it('TARGET B — aims at a FAR object (6.0 m) and reports depth + collapsed confidence', () => {
    const FAR_DEPTH = 6.0;
    const sample = makeFlatSample(FAR_DEPTH, PROJ, CAM_POS, CAM_ROT);
    const obs = sampleDepthPrior(sample, 0.5, 0.5, { referenceRangeM: REF_RANGE_M });

    expect(obs).not.toBeNull();

    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('  TARGET B — FAR OBJECT  (6.0 m)');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`  Aimed screen position : (0.500, 0.500)`);
    console.log(`  Raw depth reading     : ${obs!.depthM.toFixed(3)} m`);
    const p = obs!.point;
    console.log(
      `  Unprojected 3D point  : (${p[0].toFixed(4)}, ${p[1].toFixed(4)}, ${p[2].toFixed(4)})  [world/WebXR frame]`,
    );
    console.log(`  Confidence weight     : ${obs!.weight.toFixed(5)}  ${confidenceBar(obs!.weight)}`);
    console.log('  ✓ Far object -> LOW confidence (quartic collapse 3× past knee)');
    console.log('════════════════════════════════════════════════════════════════');

    expect(obs!.depthM).toBeCloseTo(FAR_DEPTH, 4);
    expect(obs!.weight).toBeLessThan(0.05);   // 6 m = 3× knee -> weight ≈ 0.012
  });

  // -------------------------------------------------------------------------
  it('CONFIDENCE TABLE — sweeps 0.5 m to 10 m and shows quartic weight collapse', () => {
    const distances = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0];

    console.log('\n════════════════════════════════════════════════════════════════════════════════════');
    console.log('  CONFIDENCE COLLAPSE TABLE  —  referenceRangeM = 2.0 m');
    console.log('  Camera: identity pose (0, 1.6, 0), aimed at crosshair (0.5, 0.5)');
    console.log('════════════════════════════════════════════════════════════════════════════════════');
    console.log(
      pad('  Depth', 10) +
      pad('Weight', 10) +
      pad('Bar (20 chars)', 26) +
      'World point  [x, y, z]',
    );
    console.log('  ' + '─'.repeat(76));

    let prevWeight = Infinity;
    for (const depthM of distances) {
      const sample = makeFlatSample(depthM, PROJ, CAM_POS, CAM_ROT);
      const obs = sampleDepthPrior(sample, 0.5, 0.5, { referenceRangeM: REF_RANGE_M });

      if (!obs) {
        console.log(`  ${pad(depthM.toFixed(1) + ' m', 8)}  null  (no usable depth)`);
        continue;
      }

      const bar = confidenceBar(obs.weight);
      const ptStr = `(${obs.point[0].toFixed(3)}, ${obs.point[1].toFixed(3)}, ${obs.point[2].toFixed(3)})`;
      const knee = depthM === REF_RANGE_M ? '  ← knee' : '';

      console.log(
        `  ${pad(depthM.toFixed(1) + ' m', 8)}` +
        `  ${pad(obs.weight.toFixed(5), 10)}` +
        `  ${bar}  ` +
        ptStr + knee,
      );

      // Strictly monotonically decreasing
      expect(obs.weight).toBeLessThan(prevWeight);
      prevWeight = obs.weight;

      // Weights always in (0, 1]
      expect(obs.weight).toBeGreaterThan(0);
      expect(obs.weight).toBeLessThanOrEqual(1);
    }

    // Analytical check: weight at knee must be exactly 0.5
    const kneeWeight = computeDepthWeight(REF_RANGE_M, REF_RANGE_M);
    console.log('\n  ► Analytical knee check: computeDepthWeight(2.0, 2.0) =', kneeWeight.toFixed(6));
    console.log('════════════════════════════════════════════════════════════════════════════════════\n');

    expect(kneeWeight).toBe(0.5);
  });

  // -------------------------------------------------------------------------
  it('EDGE REJECTION — depth discontinuity at crosshair suppresses the prior', () => {
    const edgeSample: DepthSampleInput = {
      points: [
        { screenX: 0.500, screenY: 0.500, depthM: 0.5 },  // foreground object
        { screenX: 0.490, screenY: 0.500, depthM: 2.5 },  // background bleed
        { screenX: 0.510, screenY: 0.500, depthM: 2.5 },  // background bleed
      ],
      projectionMatrix: PROJ,
      cameraPos: CAM_POS,
      cameraRot: CAM_ROT,
    };

    const obs = sampleDepthPrior(edgeSample, 0.5, 0.5, {
      referenceRangeM: REF_RANGE_M,
      maxAllowedDepthStdDevM: 0.5,
    });

    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('  EDGE REJECTION  —  depth discontinuity at crosshair');
    console.log('  Neighbourhood depths: 0.5 m | 2.5 m | 2.5 m  (σ ≈ 0.97 m > 0.5 m limit)');
    console.log('════════════════════════════════════════════════════════════════');
    if (obs === null) {
      console.log('  Result : null — prior correctly SUPPRESSED on edge boundary ✓');
    } else {
      console.log(`  Result : weight = ${obs.weight.toFixed(5)}  ← should have been rejected!`);
    }
    console.log('════════════════════════════════════════════════════════════════\n');

    expect(obs).toBeNull();
  });
});
