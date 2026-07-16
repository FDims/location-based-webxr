import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTapRay } from './aiming-ray-capture';
import type { Vector3, Quaternion } from 'gps-plus-slam-app-framework/core';
import { createDepthUnprojector } from 'gps-plus-slam-app-framework/ar/depth-unprojection';

vi.mock('gps-plus-slam-app-framework/ar/depth-unprojection', () => ({
  createDepthUnprojector: vi.fn(),
}));

describe('aiming-ray-capture', () => {
  const dummyPos: Vector3 = [1, 2, 3];
  const dummyRot: Quaternion = [0, 0, 0, 1];
  const dummyProjMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // identity

  beforeEach(() => {
    vi.mocked(createDepthUnprojector).mockReset();
  });

  it('returns null if coordinates are out of bounds', () => {
    expect(
      createTapRay(dummyPos, dummyRot, dummyProjMatrix, -0.1, 0.5)
    ).toBeNull();
    expect(
      createTapRay(dummyPos, dummyRot, dummyProjMatrix, 1.1, 0.5)
    ).toBeNull();
    expect(
      createTapRay(dummyPos, dummyRot, dummyProjMatrix, 0.5, -0.1)
    ).toBeNull();
    expect(
      createTapRay(dummyPos, dummyRot, dummyProjMatrix, 0.5, 1.1)
    ).toBeNull();

    // unprojector should not even be created
    expect(createDepthUnprojector).not.toHaveBeenCalled();
  });

  it('returns null if unprojector creation fails (e.g., degenerate matrix)', () => {
    vi.mocked(createDepthUnprojector).mockReturnValue(null as any);

    expect(
      createTapRay(dummyPos, dummyRot, dummyProjMatrix, 0.5, 0.5)
    ).toBeNull();
    expect(createDepthUnprojector).toHaveBeenCalled();
  });

  it('returns null if unprojection fails', () => {
    vi.mocked(createDepthUnprojector).mockReturnValue({
      unproject: vi.fn().mockReturnValue(null),
    } as any);

    expect(
      createTapRay(dummyPos, dummyRot, dummyProjMatrix, 0.5, 0.5)
    ).toBeNull();
  });

  it('computes correct normalized direction for valid unprojection (crosshair / center tap)', () => {
    // Unprojected point is exactly 1 meter along the -Z axis relative to dummyPos
    // diff will be (0, 0, -1), normalized is (0, 0, -1)
    const targetPt: Vector3 = [1, 2, 2]; // dummyPos + (0, 0, -1)

    const unprojectMock = vi.fn().mockReturnValue(targetPt);
    vi.mocked(createDepthUnprojector).mockReturnValue({
      unproject: unprojectMock,
    } as any);

    const ray = createTapRay(dummyPos, dummyRot, dummyProjMatrix, 0.5, 0.5);

    expect(ray).not.toBeNull();
    expect(ray?.origin).toEqual(dummyPos);

    // Direction should be precisely normalized to [0, 0, -1]
    expect(ray?.direction[0]).toBeCloseTo(0);
    expect(ray?.direction[1]).toBeCloseTo(0);
    expect(ray?.direction[2]).toBeCloseTo(-1);
    const length = Math.hypot(
      ray?.direction[0] ?? 0,
      ray?.direction[1] ?? 0,
      ray?.direction[2] ?? 0
    );
    expect(length).toBeCloseTo(1);

    expect(unprojectMock).toHaveBeenCalledWith({
      screenX: 0.5,
      screenY: 0.5,
      depthM: 1.0,
    });
  });

  it('normalizes correctly for an off-center tap', () => {
    // Diff is (3, 4, 0), length = 5, normalized = (0.6, 0.8, 0)
    const targetPt: Vector3 = [1 + 3, 2 + 4, 3 + 0]; // dummyPos + (3, 4, 0)

    const unprojectMock = vi.fn().mockReturnValue(targetPt);
    vi.mocked(createDepthUnprojector).mockReturnValue({
      unproject: unprojectMock,
    } as any);

    const ray = createTapRay(dummyPos, dummyRot, dummyProjMatrix, 0.2, 0.2);

    expect(ray).not.toBeNull();
    expect(ray?.origin).toEqual(dummyPos);

    expect(ray?.direction[0]).toBeCloseTo(0.6);
    expect(ray?.direction[1]).toBeCloseTo(0.8);
    expect(ray?.direction[2]).toBeCloseTo(0);
    const length = Math.hypot(
      ray?.direction[0] ?? 0,
      ray?.direction[1] ?? 0,
      ray?.direction[2] ?? 0
    );
    expect(length).toBeCloseTo(1);
  });

  it('top-left tap points toward top-left frustum direction and remains normalized', () => {
    const targetPt: Vector3 = [
      dummyPos[0] - 1,
      dummyPos[1] + 1,
      dummyPos[2] - 1,
    ];

    const unprojectMock = vi.fn().mockReturnValue(targetPt);
    vi.mocked(createDepthUnprojector).mockReturnValue({
      unproject: unprojectMock,
    } as any);

    const ray = createTapRay(dummyPos, dummyRot, dummyProjMatrix, 0, 0);

    expect(ray).not.toBeNull();
    expect(unprojectMock).toHaveBeenCalledWith({
      screenX: 0,
      screenY: 0,
      depthM: 1.0,
    });
    expect(ray?.direction[0]).toBeLessThan(0);
    expect(ray?.direction[1]).toBeGreaterThan(0);
    expect(ray?.direction[2]).toBeLessThan(0);

    const length = Math.hypot(
      ray?.direction[0] ?? 0,
      ray?.direction[1] ?? 0,
      ray?.direction[2] ?? 0
    );
    expect(length).toBeCloseTo(1);
  });
});
