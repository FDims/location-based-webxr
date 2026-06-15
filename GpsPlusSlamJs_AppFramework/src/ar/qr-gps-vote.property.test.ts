/**
 * QR pose → synthetic GPS-vote bridge — property tests.
 *
 * Why this test matters: for the Kabsch fusion to recover the right rotation,
 * the geo corners must form the SAME rigid square as the odom corners, for any
 * QR size, heading, and geo location. We verify both squares independently and
 * confirm their centroid is the QR center.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Quaternion } from 'gps-plus-slam-js';
import { type Pose } from './qr-pose';
import {
  buildQrGpsVotes,
  METERS_PER_DEG_LAT,
  type QrGeoPose,
} from './qr-gps-vote';

const IDENTITY: Quaternion = [0, 0, 0, 1];

const arbSize = fc.double({ min: 0.05, max: 2, noNaN: true });
const arbHeading = fc.double({ min: 0, max: 360, noNaN: true });
const arbGeo = fc.record({
  lat: fc.double({ min: -60, max: 60, noNaN: true }),
  lon: fc.double({ min: -179, max: 179, noNaN: true }),
  alt: fc.double({ min: -100, max: 3000, noNaN: true }),
});
const arbPos = fc.tuple(
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.double({ min: -50, max: 50, noNaN: true })
);

/** Back-convert a geo corner to an ENU offset from the QR center. */
function geoToEnu(
  center: QrGeoPose,
  corner: { latitude: number; longitude: number; altitude: number }
) {
  const metersPerDegLon =
    METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
  return {
    east: (corner.longitude - center.lon) * metersPerDegLon,
    north: (corner.latitude - center.lat) * METERS_PER_DEG_LAT,
    up: corner.altitude - center.alt,
  };
}

function sideLengths(points: { x: number; y: number; z: number }[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  return out;
}

describe('buildQrGpsVotes — geo corners form a centered square of side sizeM', () => {
  it('matches the odom square geometry for any size/heading/location', () => {
    fc.assert(
      fc.property(
        arbSize,
        arbHeading,
        arbGeo,
        arbPos,
        (sizeM, headingDeg, geo, pos) => {
          const qrGeo: QrGeoPose = { ...geo, headingDeg };
          const qrPoseWorld: Pose = { position: pos, rotation: IDENTITY };
          const votes = buildQrGpsVotes({
            qrPoseWorld,
            sizeM,
            qrGeo,
            syntheticAccuracyM: 0.05,
          });
          expect(votes).toHaveLength(4);

          // Geo corners → ENU; must be a square of side sizeM centered on origin.
          const enu = votes.map((v) =>
            geoToEnu(qrGeo, {
              latitude: v.rawGpsPoint.latitude,
              longitude: v.rawGpsPoint.longitude,
              altitude: v.rawGpsPoint.altitude ?? 0,
            })
          );
          const enuPts = enu.map((e) => ({ x: e.east, y: e.up, z: e.north }));
          for (const side of sideLengths(enuPts)) {
            expect(side).toBeCloseTo(sizeM, 4);
          }
          const cx = enuPts.reduce((s, p) => s + p.x, 0) / 4;
          const cy = enuPts.reduce((s, p) => s + p.y, 0) / 4;
          const cz = enuPts.reduce((s, p) => s + p.z, 0) / 4;
          expect(Math.hypot(cx, cy, cz)).toBeLessThan(1e-6);

          // Odom corners (identity rotation) are a square of side sizeM too.
          const odom = votes.map((v) => ({
            x: v.odomPosition[0],
            y: v.odomPosition[1],
            z: v.odomPosition[2],
          }));
          for (const side of sideLengths(odom)) {
            expect(side).toBeCloseTo(sizeM, 5);
          }
        }
      )
    );
  });
});
