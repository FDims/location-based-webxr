import type { Vector3 } from 'gps-plus-slam-app-framework/core';
import type { MeasurementRayObservation } from '../utils/robust-triangulation';

/**
 * A resolved measurement point. Unlike RefPointDefinition which stores raw
 * observations for runtime averaging, a MeasurementPoint stores the final
 * robustly triangulated position alongside the observation provenance used
 * to compute it.
 */
export interface MeasurementPointEntity {
  /** Unique identifier for the measurement point */
  id: string;
  
  /** Timestamp when this point was first created/confirmed */
  createdAt: number;
  
  /** Timestamp when this point was last updated (e.g. adding a new ray) */
  updatedAt: number;
  
  /** The set of raw ray and depth observations used to solve this point */
  observations: MeasurementRayObservation[];
  
  /** IDs of observations accepted as inliers by MSAC */
  inlierIds: string[];
  
  /** IDs of observations rejected as outliers by MSAC */
  outlierIds: string[];
  
  /** Solved position in AR-local (odometry) coordinates */
  arPosition: Vector3;
  
  /** Solved position in GPS-world coordinates (computed via alignment matrix) */
  gpsPosition: Vector3;
  
  /** The computed uncertainty of the triangulated point (trace of covariance) */
  uncertainty: number;
  
  /** Root Mean Square Error of the triangulation */
  rmsError: number;
}
