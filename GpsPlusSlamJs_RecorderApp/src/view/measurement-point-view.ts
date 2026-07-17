/**
 * Measurement Point View — dual-dot visualization.
 *
 * Renders each confirmed measurement point as two connected dots:
 *   - AR dot: the solved position in AR-local frame
 *   - GPS dot: recomputed every frame from arPosition × currentAlignmentMatrix
 *
 * The gap between them is a live alignment-error probe. The GPS dot
 * position is NEVER read from the stored gpsPositionSnapshot — it is
 * always recomputed live so the gap reacts as the alignment matrix updates.
 *
 * All functions have cyclomatic complexity ≤ 10.
 */

import type { Vector3, Matrix4 } from 'gps-plus-slam-app-framework/core';
import type { MeasurementPointEntity } from '../storage/measurement-point-loader';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AR_DOT_COLOR = 0x00ff88; // Green — AR-local
const GPS_DOT_COLOR = 0xff8800; // Orange — GPS-world
const LINE_COLOR = 0xffffff;
const DOT_RADIUS = 0.05;
const LINE_WIDTH = 2;
const PROVISIONAL_DOT_COLOR = 0xffff00; // Yellow — provisional
const PROVISIONAL_DOT_OPACITY = 0.6;

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

/**
 * Convert an AR-local position to GPS-world coordinates
 * using the current alignment matrix (column-major 4×4).
 *
 * Returns [0, 0, 0] if the alignment matrix is null/undefined
 * (fallback for when no SLAM session is active).
 */
export function arLocalToGpsWorld(
  arPosition: Vector3,
  alignmentMatrix: Matrix4 | null | undefined
): Vector3 {
  if (!alignmentMatrix) return [0, 0, 0];
  const m = alignmentMatrix;
  const [x, y, z] = arPosition;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// ---------------------------------------------------------------------------
// THREE.js helpers (lazy-imported to keep the module testable without Three)
// ---------------------------------------------------------------------------

// These functions use the global THREE namespace (available via the recorder's
// Three.js import). Type annotations are structural to avoid a hard import
// dependency in this file — the caller passes Three objects through.

interface ThreeVector3 {
  set(x: number, y: number, z: number): void;
}

interface ThreeMesh {
  position: ThreeVector3;
  visible: boolean;
  material: { opacity?: number; transparent?: boolean; color?: { set(c: number): void } };
}

interface ThreeLine {
  geometry: {
    setFromPoints(points: ThreeVector3[]): void;
    attributes?: { position?: { needsUpdate: boolean } };
  };
  visible: boolean;
}

interface ThreeGroup {
  add(child: unknown): void;
  children: unknown[];
  visible: boolean;
  userData: Record<string, unknown>;
}

/**
 * Build a measurement point visualization descriptor.
 * The actual Three.js objects are created by the caller (main.ts or a
 * wiring module) using this descriptor's parameters, keeping this module
 * free of hard Three.js constructor imports.
 */
export interface MeasurementPointVisualDescriptor {
  arDotColor: number;
  gpsDotColor: number;
  lineColor: number;
  dotRadius: number;
  lineWidth: number;
}

/** Returns the visual parameters for a confirmed measurement point. */
export function getConfirmedVisualParams(): MeasurementPointVisualDescriptor {
  return {
    arDotColor: AR_DOT_COLOR,
    gpsDotColor: GPS_DOT_COLOR,
    lineColor: LINE_COLOR,
    dotRadius: DOT_RADIUS,
    lineWidth: LINE_WIDTH,
  };
}

/** Returns the visual parameters for a provisional (pre-confirm) point. */
export function getProvisionalVisualParams(): MeasurementPointVisualDescriptor {
  return {
    arDotColor: PROVISIONAL_DOT_COLOR,
    gpsDotColor: PROVISIONAL_DOT_COLOR,
    lineColor: LINE_COLOR,
    dotRadius: DOT_RADIUS * 0.8,
    lineWidth: LINE_WIDTH,
  };
}

// ---------------------------------------------------------------------------
// Update helpers (operate on structural Three.js interfaces)
// ---------------------------------------------------------------------------

/**
 * Update the AR-local dot position in a measurement point group.
 * The group is expected to have userData.arDot referencing the mesh.
 */
export function updateArDotPosition(
  arDot: ThreeMesh,
  arPosition: Vector3
): void {
  arDot.position.set(arPosition[0], arPosition[1], arPosition[2]);
}

/**
 * Recompute and update the GPS-world dot position from
 * arPosition × alignmentMatrix. This is what makes the gap react live.
 */
export function updateGpsDotPosition(
  gpsDot: ThreeMesh,
  arPosition: Vector3,
  alignmentMatrix: Matrix4 | null | undefined
): void {
  const gpsPos = arLocalToGpsWorld(arPosition, alignmentMatrix);
  gpsDot.position.set(gpsPos[0], gpsPos[1], gpsPos[2]);
}

/**
 * Update the line connecting the AR and GPS dots.
 * Reads positions from the two dot meshes.
 */
export function updateConnectionLinePositions(
  lineGeometry: { setFromPoints(points: { x: number; y: number; z: number }[]): void },
  arPosition: Vector3,
  gpsPosition: Vector3
): void {
  lineGeometry.setFromPoints([
    { x: arPosition[0], y: arPosition[1], z: arPosition[2] },
    { x: gpsPosition[0], y: gpsPosition[1], z: gpsPosition[2] },
  ]);
}

/**
 * Full update of a measurement point's visualization.
 * Called every frame for each confirmed point.
 */
export function updateMeasurementPointVisual(
  arDot: ThreeMesh,
  gpsDot: ThreeMesh,
  lineGeometry: { setFromPoints(points: { x: number; y: number; z: number }[]): void },
  entity: MeasurementPointEntity,
  alignmentMatrix: Matrix4 | null | undefined
): void {
  updateArDotPosition(arDot, entity.arPosition);
  updateGpsDotPosition(gpsDot, entity.arPosition, alignmentMatrix);
  const gpsPos = arLocalToGpsWorld(entity.arPosition, alignmentMatrix);
  updateConnectionLinePositions(lineGeometry, entity.arPosition, gpsPos);
}
