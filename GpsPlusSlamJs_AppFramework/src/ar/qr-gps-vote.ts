/**
 * QR pose → synthetic GPS-vote bridge — Phase 5 of the QR-code detection &
 * tracking plan (§6).
 *
 * A detected QR is NOT a rigid re-anchor. Instead its solved pose is turned into
 * one (or, by default, four) very-high-weight synthetic GPS observation(s) and
 * injected into the existing weighted-Kabsch/RANSAC fusion via the normal
 * `recordGpsEvent` path. "Mostly but not entirely overrides the other votes"
 * then falls out of the existing accuracy→weight curve for free, and a single
 * bad detection is still rejectable as a RANSAC outlier rather than teleporting
 * the scene.
 *
 * Multi-correspondence (default): a single QR gives a full 6-DoF pose, but the
 * fusion is point-based. We know the QR's 4 corners in BOTH odom space (from the
 * solved pose + size) and geo space (corner offsets from the geo center via its
 * heading + size), so injecting the 4 corners as 4 observations lets ONE
 * detection immediately constrain rotation + translation. The corners are
 * coplanar, so the QR-normal (depth) DOF stays the least-constrained — exactly
 * what the occupancy self-check (`qr-occupancy-check.ts`, §7) guards.
 *
 * This module only BUILDS the payloads (pure, fully testable). Dispatching them
 * to the store is the caller's job (Phase 6 wiring).
 *
 * @see qr-pose.ts for the pose; gps-event-coordinator.ts for the normal path.
 */

import type {
  Quaternion,
  RawGpsPoint,
  RecordGpsEventPayload,
} from 'gps-plus-slam-js';
import type { Vector3 } from 'gps-plus-slam-js';
import { buildObjectPoints, transformPoint, type Pose } from './qr-pose.js';

/** Mean meters per degree of latitude (WGS-84 average). */
export const METERS_PER_DEG_LAT = 111320;

/** Absolute geo pose of the printed QR, from the level file. */
export interface QrGeoPose {
  lat: number;
  lon: number;
  /** Altitude of the QR center, meters. */
  alt: number;
  /**
   * Compass bearing (degrees clockwise from true North) that the QR's local +X
   * axis points toward. The QR is assumed vertical (wall-mounted): local +Y =
   * world up, local +X = horizontal along the wall at this bearing.
   */
  headingDeg: number;
}

export interface QrGpsVoteInput {
  /** Solved QR pose in raw-WebXR/odom space (`solveQrPose().qrPoseWorld`). */
  qrPoseWorld: Pose;
  /** Printed physical side length, meters. */
  sizeM: number;
  /** Absolute geo pose from the level file. */
  qrGeo: QrGeoPose;
  /**
   * Synthetic GPS accuracy in meters. Small → very high weight (the core
   * library computes `weight = 1/accuracy^gpsAccuracyExponent`). Pick & validate
   * against the fusion rather than hardcoding blindly (plan §6).
   */
  syntheticAccuracyM: number;
  /**
   * Device/odom rotation to stamp on each payload. Defaults to the QR's world
   * rotation; the fusion uses this only for the device-rotation derivation, not
   * for the positional correspondence.
   */
  odomRotation?: Quaternion;
  /** 4 corner observations (default) vs. a single center observation. */
  multiCorrespondence?: boolean;
  /** Epoch ms stamped on every synthetic point. Defaults to `Date.now()`. */
  timestamp?: number;
  /** Id prefix for the synthetic points. Default `'qr'`. */
  idPrefix?: string;
}

/** East/North/Up offset (meters) of a QR-plane point from the QR center. */
export interface Enu {
  east: number;
  north: number;
  up: number;
}

/**
 * Map a QR-local plane offset (meters; +x right, +y up on the printed face) to
 * an East/North/Up offset, given the QR's compass heading. Vertical-QR
 * convention: +y is world up; +x is horizontal at `headingDeg` (clockwise from
 * North), so east = x·sin(h), north = x·cos(h).
 */
export function localPlaneToEnu(
  localX: number,
  localY: number,
  headingDeg: number
): Enu {
  const h = (headingDeg * Math.PI) / 180;
  return {
    east: localX * Math.sin(h),
    north: localX * Math.cos(h),
    up: localY,
  };
}

/** Apply an ENU meter offset to a geo pose (equirectangular; exact enough for sub-meter QR corners). */
export function offsetGeo(
  center: QrGeoPose,
  enu: Enu
): { latitude: number; longitude: number; altitude: number } {
  const dLat = enu.north / METERS_PER_DEG_LAT;
  const metersPerDegLon =
    METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
  // Guard the degenerate pole case where cos(lat) → 0.
  const dLon =
    Math.abs(metersPerDegLon) < 1e-9 ? 0 : enu.east / metersPerDegLon;
  return {
    latitude: center.lat + dLat,
    longitude: center.lon + dLon,
    altitude: center.alt + enu.up,
  };
}

/**
 * Build the synthetic `recordGpsEvent` payload(s) for one QR detection. Returns
 * 4 corner correspondences by default, or 1 center correspondence when
 * `multiCorrespondence` is false. Each payload pairs the corner's odom position
 * (from the solved pose) with its absolute geo position (from the level file),
 * stamped with the tiny synthetic accuracy.
 *
 * @throws RangeError on a non-positive `sizeM` or `syntheticAccuracyM`.
 */
export function buildQrGpsVotes(
  input: QrGpsVoteInput
): RecordGpsEventPayload[] {
  const {
    qrPoseWorld,
    sizeM,
    qrGeo,
    syntheticAccuracyM,
    odomRotation = qrPoseWorld.rotation,
    multiCorrespondence = true,
    timestamp = Date.now(),
    idPrefix = 'qr',
  } = input;

  if (!(syntheticAccuracyM > 0) || !Number.isFinite(syntheticAccuracyM)) {
    throw new RangeError(
      `qr-gps-vote: syntheticAccuracyM must be positive, got ${syntheticAccuracyM}`
    );
  }

  // `buildObjectPoints` validates sizeM (>0, finite) and gives TL,TR,BR,BL.
  const localPoints: readonly Vector3[] = multiCorrespondence
    ? buildObjectPoints(sizeM)
    : [[0, 0, 0]];

  return localPoints.map((local, i) => {
    const odomPosition = transformPoint(local, qrPoseWorld);
    const geo = offsetGeo(
      qrGeo,
      localPlaneToEnu(local[0], local[1], qrGeo.headingDeg)
    );
    const rawGpsPoint: RawGpsPoint = {
      id: `${idPrefix}-${timestamp}-${i}`,
      latitude: geo.latitude,
      longitude: geo.longitude,
      altitude: geo.altitude,
      latLongAccuracy: syntheticAccuracyM,
      timestamp,
    };
    return { odomPosition, odomRotation, rawGpsPoint };
  });
}
