/**
 * Live depth occluder — unit tests for the {@link DepthOccluder} class and the
 * full-screen shader source.
 *
 * Why this test matters: the on-device occlusion is device-gated (plan §8 Iter
 * 2–3) and cannot run headless, but the class's CPU-observable contract CAN be
 * pinned in jsdom — and must be, because the wiring (main.ts) depends on it:
 *  - a frame missing the occluder metadata must NOT enable occlusion (frame-level
 *    holes policy) — otherwise virtual content would occlude against stale/absent
 *    depth;
 *  - the upload format is chosen from the resolved byte layout;
 *  - the uniforms are shared BY REFERENCE so a per-frame `update` reaches the
 *    mounted full-screen material (the whole point of the shared uniform block);
 *  - dispose is clean (no leaks across sessions).
 * The pure occlusion math has its own property tests (`*.property.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  DepthOccluder,
  buildFullscreenOcclusionShader,
  OCCLUDER_RENDER_ORDER,
} from './depth-occluder.js';
import type { DepthInfo } from './depth-sampler.js';

const IDENTITY16 = new THREE.Matrix4().identity()
  .elements as unknown as number[];

/** A wrapped-depth frame carrying the full occluder metadata. */
function makeDepthInfo(
  width: number,
  height: number,
  format: 'r32f' | 'luminance-alpha',
  overrides: Partial<DepthInfo> = {}
): DepthInfo {
  const bytesPerTexel = format === 'r32f' ? 4 : 2;
  return {
    width,
    height,
    getDepthInMeters: () => 1,
    data: new ArrayBuffer(width * height * bytesPerTexel),
    rawValueToMeters: 0.001,
    normDepthBufferFromNormView: IDENTITY16,
    projectionMatrix: IDENTITY16,
    ...overrides,
  } as unknown as DepthInfo;
}

describe('DepthOccluder', () => {
  it('starts disabled with no texture format until the first update', () => {
    const occ = new DepthOccluder();
    expect(occ.isEnabled()).toBe(false);
    expect(occ.getTextureFormat()).toBeNull();
    occ.dispose();
  });

  it('enables and selects r32f for a 4-bytes/texel frame', () => {
    const occ = new DepthOccluder();
    occ.update(makeDepthInfo(8, 6, 'r32f'));
    expect(occ.isEnabled()).toBe(true);
    expect(occ.getTextureFormat()).toBe('r32f');
    occ.dispose();
  });

  it('selects luminance-alpha for a 2-bytes/texel frame', () => {
    const occ = new DepthOccluder();
    occ.update(makeDepthInfo(8, 6, 'luminance-alpha'));
    expect(occ.getTextureFormat()).toBe('luminance-alpha');
    occ.dispose();
  });

  it('does NOT enable occlusion for a frame missing the occluder metadata', () => {
    const occ = new DepthOccluder();
    // A sparse-only frame: width/height/getDepthInMeters but no data/metadata.
    const sparse = {
      width: 8,
      height: 6,
      getDepthInMeters: () => 1,
    } as unknown as DepthInfo;
    occ.update(sparse);
    expect(occ.isEnabled()).toBe(false);
    occ.dispose();
  });

  it('disables again if a later frame degrades (drops its data)', () => {
    const occ = new DepthOccluder();
    occ.update(makeDepthInfo(8, 6, 'r32f'));
    expect(occ.isEnabled()).toBe(true);
    occ.update(makeDepthInfo(8, 6, 'r32f', { data: undefined }));
    expect(occ.isEnabled()).toBe(false);
    occ.dispose();
  });

  it('reuses the texture across same-size frames and recreates on a size change', () => {
    const occ = new DepthOccluder();
    occ.update(makeDepthInfo(8, 6, 'r32f'));
    // Same size/format → no throw, stays enabled, format stable.
    occ.update(makeDepthInfo(8, 6, 'r32f'));
    expect(occ.getTextureFormat()).toBe('r32f');
    // Different size → recreates without error.
    occ.update(makeDepthInfo(16, 12, 'r32f'));
    expect(occ.isEnabled()).toBe(true);
    occ.dispose();
  });

  it('dispose clears enablement and is idempotent', () => {
    const occ = new DepthOccluder();
    occ.update(makeDepthInfo(8, 6, 'r32f'));
    occ.dispose();
    expect(occ.isEnabled()).toBe(false);
    expect(() => occ.dispose()).not.toThrow();
    // Post-dispose update is a no-op (no re-enable).
    occ.update(makeDepthInfo(8, 6, 'r32f'));
    expect(occ.isEnabled()).toBe(false);
  });
});

describe('full-screen depth-write occluder (v1)', () => {
  it('builds a clip-space quad mesh that writes depth but no color', () => {
    const occ = new DepthOccluder();
    const mesh = occ.getOcclusionMesh();
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    // Depth-only writer that composes with the persistent mesh + lays depth
    // before content (nearer wins): colorWrite off, depthWrite+depthTest on.
    expect(mat.colorWrite).toBe(false);
    expect(mat.depthWrite).toBe(true);
    expect(mat.depthTest).toBe(true);
    expect(mesh.renderOrder).toBe(OCCLUDER_RENDER_ORDER);
    expect(mesh.frustumCulled).toBe(false);
    occ.dispose();
  });

  it('caches the mesh (one instance per occluder)', () => {
    const occ = new DepthOccluder();
    expect(occ.getOcclusionMesh()).toBe(occ.getOcclusionMesh());
    occ.dispose();
  });

  it('shares the live uniform block so update() reaches the full-screen material', () => {
    const occ = new DepthOccluder();
    const mat = occ.getOcclusionMesh().material as THREE.ShaderMaterial;
    expect(mat.uniforms['uOccluderEnabled']?.value).toBe(0);

    // A packed (RG8) frame: enables occlusion AND flags the packed unpack path.
    occ.update(makeDepthInfo(8, 6, 'luminance-alpha'));
    expect(mat.uniforms['uOccluderEnabled']?.value).toBe(1);
    expect(mat.uniforms['uPackedDepth']?.value).toBe(1);

    // A float (R32F) frame flips the unpack flag back to the float path.
    occ.update(makeDepthInfo(8, 6, 'r32f'));
    expect(mat.uniforms['uPackedDepth']?.value).toBe(0);
    occ.dispose();
  });

  it('dispose detaches the mesh and frees it', () => {
    const occ = new DepthOccluder();
    const parent = new THREE.Group();
    const mesh = occ.getOcclusionMesh();
    parent.add(mesh);
    occ.dispose();
    expect(mesh.parent).toBeNull();
    expect(() => occ.dispose()).not.toThrow();
  });
});

describe('buildFullscreenOcclusionShader', () => {
  it('writes gl_FragDepth from the projection matrix (mirrors metricDepthToWindowDepth)', () => {
    const { fragmentShader } = buildFullscreenOcclusionShader();
    expect(fragmentShader).toContain('gl_FragDepth');
    // metres → window depth uses P[10]/P[14]/P[11]/P[15] (column-major [col][row]).
    expect(fragmentShader).toContain('uProjectionMatrix[2][2]');
    expect(fragmentShader).toContain('uProjectionMatrix[3][2]');
    expect(fragmentShader).toContain('uProjectionMatrix[2][3]');
    expect(fragmentShader).toContain('uProjectionMatrix[3][3]');
    expect(fragmentShader).toContain('0.5 * (zClip / wClip) + 0.5');
  });

  it('applies the holes policy (discard on no/invalid depth or when disabled)', () => {
    const { fragmentShader } = buildFullscreenOcclusionShader();
    expect(fragmentShader).toContain(
      'if (uOccluderEnabled < 0.5) { discard; }'
    );
    expect(fragmentShader).toContain(
      'if (!(realDepthMeters > 0.0)) { discard; }'
    );
  });

  it('reconstructs metres for both the packed and float formats', () => {
    const { fragmentShader } = buildFullscreenOcclusionShader();
    expect(fragmentShader).toContain('uPackedDepth > 0.5'); // packed branch
    expect(fragmentShader).toContain(
      'texel.r * 255.0 + texel.g * 255.0 * 256.0'
    );
    expect(fragmentShader).toContain('texel.r * uRawValueToMeters'); // float branch
  });

  it('derives the screen UV from the clip-space quad (no resolution uniform)', () => {
    const { vertexShader, fragmentShader } = buildFullscreenOcclusionShader();
    expect(vertexShader).toContain('vScreenUv = position.xy * 0.5 + 0.5');
    expect(vertexShader).toContain('gl_Position = vec4(position.xy, 0.0, 1.0)');
    // Screen UV → depth-buffer UV via normDepthBufferFromNormView + persp divide.
    expect(fragmentShader).toContain('uDepthUvFromScreenUv * vec4(vScreenUv');
    expect(fragmentShader).toContain('duv.xy / duv.w');
  });
});
