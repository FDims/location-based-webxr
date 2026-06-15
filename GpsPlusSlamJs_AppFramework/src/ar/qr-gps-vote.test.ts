/**
 * QR pose → synthetic GPS-vote bridge — unit tests.
 *
 * Why this test matters: these pin the geometry of the synthetic correspondences
 * the fusion consumes — the 4 corners must land at the right odom positions
 * (from the solved pose) AND the right absolute geo positions (corner offsets
 * from the center via heading + size), all stamped with the tiny synthetic
 * accuracy that makes the QR a high-weight vote. A sign error here would point
 * the alignment the wrong way on a real device.
 */

import { describe, it, expect } from 'vitest';
import type { Quaternion } from 'gps-plus-slam-js';
import { buildObjectPoints, transformPoint, type Pose } from './qr-pose';
import {
  buildQrGpsVotes,
  localPlaneToEnu,
  offsetGeo,
  METERS_PER_DEG_LAT,
  type QrGeoPose,
} from './qr-gps-vote';

const IDENTITY: Quaternion = [0, 0, 0, 1];
const qrGeo: QrGeoPose = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 };

describe('localPlaneToEnu', () => {
  it('maps +x to North when heading is 0', () => {
    const enu = localPlaneToEnu(2, 3, 0);
    expect(enu.north).toBeCloseTo(2, 9);
    expect(enu.east).toBeCloseTo(0, 9);
    expect(enu.up).toBe(3);
  });

  it('maps +x to East when heading is 90°', () => {
    const enu = localPlaneToEnu(2, 3, 90);
    expect(enu.east).toBeCloseTo(2, 9);
    expect(enu.north).toBeCloseTo(0, 9);
    expect(enu.up).toBe(3);
  });
});

describe('offsetGeo', () => {
  it('converts North/East/Up offsets to lat/lon/alt deltas', () => {
    const geo = offsetGeo(qrGeo, { east: 0, north: METERS_PER_DEG_LAT, up: 5 });
    expect(geo.latitude).toBeCloseTo(qrGeo.lat + 1, 9);
    expect(geo.longitude).toBeCloseTo(qrGeo.lon, 9);
    expect(geo.altitude).toBe(405);
  });

  it('scales longitude by cos(latitude)', () => {
    const metersPerDegLon =
      METERS_PER_DEG_LAT * Math.cos((qrGeo.lat * Math.PI) / 180);
    const geo = offsetGeo(qrGeo, { east: metersPerDegLon, north: 0, up: 0 });
    expect(geo.longitude).toBeCloseTo(qrGeo.lon + 1, 9);
    expect(geo.latitude).toBeCloseTo(qrGeo.lat, 9);
  });
});

describe('buildQrGpsVotes', () => {
  const qrPoseWorld: Pose = { position: [10, 1.5, -4], rotation: IDENTITY };
  const sizeM = 0.2;
  const syntheticAccuracyM = 0.05;

  it('produces 4 corner correspondences by default', () => {
    const votes = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
      timestamp: 1000,
    });
    expect(votes).toHaveLength(4);

    // Odom positions equal the object points transformed by the world pose.
    const expectedOdom = buildObjectPoints(sizeM).map((o) =>
      transformPoint(o, qrPoseWorld)
    );
    votes.forEach((v, i) => {
      for (let k = 0; k < 3; k++) {
        expect(v.odomPosition[k]).toBeCloseTo(expectedOdom[i][k], 6);
      }
      expect(v.rawGpsPoint.latLongAccuracy).toBe(syntheticAccuracyM);
      expect(v.rawGpsPoint.timestamp).toBe(1000);
      expect(v.rawGpsPoint.id).toBe(`qr-1000-${i}`);
    });
  });

  it('places the top corners higher and the bottom corners lower in altitude', () => {
    const votes = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
    });
    // Object-point order is TL, TR, BR, BL → +h, +h, −h, −h in local Y.
    const h = sizeM / 2;
    expect(votes[0].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt + h, 9);
    expect(votes[1].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt + h, 9);
    expect(votes[2].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt - h, 9);
    expect(votes[3].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt - h, 9);
  });

  it('produces a single center correspondence when multiCorrespondence is false', () => {
    const votes = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
      multiCorrespondence: false,
    });
    expect(votes).toHaveLength(1);
    expect(votes[0].odomPosition).toEqual(qrPoseWorld.position);
    expect(votes[0].rawGpsPoint.latitude).toBeCloseTo(qrGeo.lat, 9);
    expect(votes[0].rawGpsPoint.longitude).toBeCloseTo(qrGeo.lon, 9);
    expect(votes[0].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt, 9);
  });

  it('defaults odomRotation to the QR world rotation but honors an override', () => {
    const override: Quaternion = [0, 0.7071, 0, 0.7071];
    const def = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
    });
    const ovr = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
      odomRotation: override,
    });
    expect(def[0].odomRotation).toEqual(qrPoseWorld.rotation);
    expect(ovr[0].odomRotation).toEqual(override);
  });

  it('rejects a non-positive synthetic accuracy or size', () => {
    expect(() =>
      buildQrGpsVotes({ qrPoseWorld, sizeM, qrGeo, syntheticAccuracyM: 0 })
    ).toThrow(RangeError);
    expect(() =>
      buildQrGpsVotes({ qrPoseWorld, sizeM: -1, qrGeo, syntheticAccuracyM })
    ).toThrow(RangeError);
  });
});
