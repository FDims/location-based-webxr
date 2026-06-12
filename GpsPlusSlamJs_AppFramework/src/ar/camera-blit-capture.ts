/**
 * Camera Blit Capture Module
 *
 * Implements the "blit" technique to read WebXR opaque camera textures.
 *
 * Problem: In WebXR AR mode, the camera texture provided by
 * renderer.xr.getCameraTexture() is an "opaque texture" backed by a
 * protected GPU buffer (OES_external_image). Standard canvas.toBlob()
 * or gl.readPixels() return all-black data.
 *
 * Solution: Render the opaque texture onto a fullscreen quad targeting
 * an intermediate WebGLRenderTarget (standard RGBA). This GPU draw call
 * forces conversion from the opaque format to a readable texture.
 * Then readRenderTargetPixels() successfully extracts the pixel data.
 *
 * See: docs/2026-02-06-bug-camera-frames-black.md
 */

import * as THREE from 'three';
import { createLogger } from '../utils/logger';
import { disposeObject3D } from '../visualization/three-dispose';

const log = createLogger('CameraBlitCapture');

/**
 * Configuration for the blit capture render target dimensions.
 * Smaller = faster readPixels (less GPU stall), but lower resolution.
 */
export interface CameraBlitCaptureConfig {
  /** Width of the intermediate render target in pixels */
  width: number;
  /** Height of the intermediate render target in pixels */
  height: number;
}

/**
 * Default blit capture config.
 * 512×512 is a good balance between quality and readPixels performance on mobile.
 */
export const DEFAULT_BLIT_CONFIG: CameraBlitCaptureConfig = {
  width: 512,
  height: 512,
};

/**
 * Compute the capture dimensions from the native camera resolution
 * and a user-configurable resolution divisor.
 *
 * @param cameraWidth  - Native camera width in pixels (from XRCamera)
 * @param cameraHeight - Native camera height in pixels (from XRCamera)
 * @param divisor      - Resolution divisor: 1 = full, 2 = half, 4 = quarter, etc.
 *                        Values ≤ 0 are treated as 1. Fractional values < 1 are treated as 1.
 * @returns Integer pixel dimensions, clamped to at least 1×1.
 *          Falls back to DEFAULT_BLIT_CONFIG when inputs are invalid (≤ 0).
 */
export function computeCaptureSize(
  cameraWidth: number,
  cameraHeight: number,
  divisor: number
): { width: number; height: number } {
  // Guard: invalid camera dimensions → fallback
  if (cameraWidth <= 0 || cameraHeight <= 0) {
    return {
      width: DEFAULT_BLIT_CONFIG.width,
      height: DEFAULT_BLIT_CONFIG.height,
    };
  }

  // Guard: nonsensical divisor → treat as 1 (full resolution, no upscale)
  const safeDivisor = divisor >= 1 ? divisor : 1;

  return {
    width: Math.max(1, Math.floor(cameraWidth / safeDivisor)),
    height: Math.max(1, Math.floor(cameraHeight / safeDivisor)),
  };
}

/**
 * Number of sampled pixels to check in isBlackFrame.
 * We sample a subset rather than checking every pixel for speed.
 */
const BLACK_CHECK_SAMPLE_COUNT = 100;

/**
 * Captures readable pixel data from WebXR opaque camera textures
 * using the intermediate render target "blit" technique.
 *
 * Usage:
 * 1. Create once when AR session starts
 * 2. Call captureToBlob() when a frame needs to be captured
 * 3. Call dispose() when AR session ends
 */
export class CameraBlitCapture {
  private renderTarget: THREE.WebGLRenderTarget;
  private blitScene: THREE.Scene;
  private blitCamera: THREE.OrthographicCamera;
  private blitMaterial: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private pixelBuffer: Uint8Array;
  private width: number;
  private height: number;
  private disposed = false;

  constructor(config: CameraBlitCaptureConfig = DEFAULT_BLIT_CONFIG) {
    this.width = config.width;
    this.height = config.height;

    // 1. Create render target (standard RGBA, readable)
    this.renderTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    // 2. CPU-side pixel buffer for readRenderTargetPixels output
    this.pixelBuffer = new Uint8Array(this.width * this.height * 4);

    // 3. Blit scene: orthographic camera + fullscreen quad
    this.blitScene = new THREE.Scene();
    this.blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // 4. Shader that simply samples the camera texture
    this.blitMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    // 5. Fullscreen quad (PlaneGeometry(2,2) maps [-1,1] in clip space)
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.blitMaterial
    );
    this.blitScene.add(this.quad);
  }

  /**
   * Capture the WebXR camera texture to a JPEG Blob via the blit technique.
   *
   * IMPORTANT: Must be called within the XR animation frame callback,
   * while the camera texture is valid.
   *
   * @param renderer - The Three.js WebGL renderer
   * @param cameraTexture - The opaque camera texture from renderer.xr.getCameraTexture()
   * @param quality - JPEG quality 0.0-1.0
   * @returns JPEG Blob, or null if capture fails
   */
  async captureToBlob(
    renderer: THREE.WebGLRenderer,
    cameraTexture: THREE.Texture,
    quality: number
  ): Promise<Blob | null> {
    // --- STEPS A+B: BLIT + READ PIXELS (shared with captureToPixels) ---
    if (!this.captureToPixels(renderer, cameraTexture)) {
      return null;
    }
    try {
      // --- STEP C: ENCODE TO JPEG ---
      return await this.pixelsToJpegBlob(quality);
    } catch (error) {
      log.error('Blit capture failed:', error);
      return null;
    }
  }

  /**
   * Run the blit + readback (steps A+B of {@link captureToBlob}) and return
   * the raw RGBA pixel buffer without JPEG encoding — the cheap path for
   * per-point color sampling (occupancy-grid port plan Iter 8).
   *
   * IMPORTANT: Must be called within the XR animation frame callback, while
   * the camera texture is valid. The returned `pixels` is the INTERNAL
   * buffer — valid only until the next capture or `resizeIfNeeded`; consume
   * it synchronously (e.g. via `createRgbLookup`) or copy it.
   *
   * Note: the buffer is in WebGL readback order (bottom-row-first / RGBA);
   * `createRgbLookup` handles the y-flip.
   *
   * @returns the buffer with its dimensions, or null on failure/dispose.
   */
  captureToPixels(
    renderer: THREE.WebGLRenderer,
    cameraTexture: THREE.Texture
  ): { pixels: Uint8Array; width: number; height: number } | null {
    if (this.disposed) {
      log.warn('captureToPixels called after dispose');
      return null;
    }

    try {
      // --- STEP A: BLIT TO RENDER TARGET ---

      // Plug the camera texture into the shader
      this.blitMaterial.uniforms.tDiffuse!.value = cameraTexture;

      // Save current renderer state
      const currentRenderTarget = renderer.getRenderTarget();
      const currentXrEnabled = renderer.xr.enabled;

      // Disable XR momentarily so we can render to our internal target
      renderer.xr.enabled = false;
      renderer.setRenderTarget(this.renderTarget);

      // Render the quad (converts Opaque → Standard texture)
      renderer.render(this.blitScene, this.blitCamera);

      // --- STEP B: READ PIXELS ---
      renderer.readRenderTargetPixels(
        this.renderTarget,
        0,
        0,
        this.width,
        this.height,
        this.pixelBuffer
      );

      // Restore renderer state
      renderer.setRenderTarget(currentRenderTarget);
      renderer.xr.enabled = currentXrEnabled;

      // Clear texture reference to avoid holding onto opaque texture
      this.blitMaterial.uniforms.tDiffuse!.value = null;

      return {
        pixels: this.pixelBuffer,
        width: this.width,
        height: this.height,
      };
    } catch (error) {
      log.error('Blit capture failed:', error);
      return null;
    }
  }

  /**
   * Check if a pixel buffer is entirely black (all zeros).
   * Uses sampling for performance (checks BLACK_CHECK_SAMPLE_COUNT evenly-spaced pixels).
   *
   * This is useful to detect if the blit technique failed to convert
   * the opaque texture (different from a legitimately dark scene).
   *
   * @param pixels - RGBA pixel buffer
   * @returns true if all sampled pixels are zero
   */
  static isBlackFrame(pixels: Uint8Array): boolean {
    if (pixels.length === 0) {
      return true;
    }

    const step = Math.max(
      1,
      Math.floor(pixels.length / (BLACK_CHECK_SAMPLE_COUNT * 4))
    );
    for (let i = 0; i < pixels.length; i += step * 4) {
      // Check RGB (skip alpha) — a black RGBA pixel has R=G=B=0
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      if (r > 0 || g > 0 || b > 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Convert the internal pixel buffer to a JPEG Blob using OffscreenCanvas
   * (or fallback to regular Canvas).
   */
  private async pixelsToJpegBlob(quality: number): Promise<Blob | null> {
    // Prefer OffscreenCanvas (available in modern browsers, non-blocking)
    if (typeof OffscreenCanvas !== 'undefined') {
      return this.pixelsToJpegViaOffscreenCanvas(quality);
    }
    // Fallback: use regular canvas
    return this.pixelsToJpegViaCanvas(quality);
  }

  private getFlippedImageData(): ImageData {
    // The ImageData constructor requires a Uint8ClampedArray. This also creates a copy.
    const clampedBuffer = new Uint8ClampedArray(this.pixelBuffer);
    const imageData = new ImageData(clampedBuffer, this.width, this.height);

    // WebGL readPixels returns y-flipped data; flip it in-place.
    this.flipImageDataVertically(imageData);
    return imageData;
  }

  private async pixelsToJpegViaOffscreenCanvas(
    quality: number
  ): Promise<Blob | null> {
    const offscreen = new OffscreenCanvas(this.width, this.height);
    const ctx = offscreen.getContext('2d');
    if (!ctx) {
      return null;
    }

    const imageData = this.getFlippedImageData();
    ctx.putImageData(imageData, 0, 0);

    return offscreen.convertToBlob({ type: 'image/jpeg', quality });
  }

  private pixelsToJpegViaCanvas(quality: number): Promise<Blob | null> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = this.width;
      canvas.height = this.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      const imageData = this.getFlippedImageData();
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    });
  }

  /**
   * Flip ImageData vertically in-place.
   * WebGL readPixels returns bottom-row-first; canvas expects top-row-first.
   */
  private flipImageDataVertically(imageData: ImageData): void {
    const { data, width, height } = imageData;
    const rowSize = width * 4;
    const tempRow = new Uint8ClampedArray(rowSize);
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const topOffset = y * rowSize;
      const bottomOffset = (height - 1 - y) * rowSize;
      // Swap top and bottom rows
      tempRow.set(data.subarray(topOffset, topOffset + rowSize));
      data.copyWithin(topOffset, bottomOffset, bottomOffset + rowSize);
      data.set(tempRow, bottomOffset);
    }
  }

  /**
   * Resize the render target and pixel buffer to match new dimensions.
   * Call this when the camera resolution is first known or changes.
   *
   * No-op when dimensions already match (avoids per-frame reallocation).
   * Returns false if disposed, dimensions unchanged, or dimensions invalid.
   *
   * @param newWidth  - Desired capture width in pixels
   * @param newHeight - Desired capture height in pixels
   * @returns true if resources were actually resized
   */
  resizeIfNeeded(newWidth: number, newHeight: number): boolean {
    if (this.disposed) {
      return false;
    }
    if (newWidth <= 0 || newHeight <= 0) {
      return false;
    }
    if (newWidth === this.width && newHeight === this.height) {
      return false;
    }

    this.width = newWidth;
    this.height = newHeight;

    this.renderTarget.setSize(this.width, this.height);
    this.pixelBuffer = new Uint8Array(this.width * this.height * 4);

    log.info(`Render target resized to ${this.width}×${this.height}`);
    return true;
  }

  /**
   * Dispose GPU resources. Call when AR session ends.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    this.renderTarget.dispose();
    disposeObject3D(this.quad);
    log.info('CameraBlitCapture disposed');
  }
}
