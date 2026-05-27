/**
 * Recorder-app subscriber for the 3D ref-point visualizer.
 *
 * Step 4 of 2026-05-27-collapse-refpoint-and-frame-slices-plan.md migrated
 * this wiring to subscribe via the library's canonical
 * `selectReferencePoints` selector (which reads from `state.gpsData
 * .referencePoints` produced by the library reducer) instead of the
 * recorder-local `refPoints.{priorMarks,currentMarks}` slice fields.
 *
 * The visualizer's `syncRefPoints` method renders all marks uniformly
 * and animates newly-inserted ids via an id-based diff. The recorder
 * slice's `priorMarks` / `currentMarks` retain no consumer here and are
 * removed in Step 5 along with the `addCurrentRefPoint` listener.
 */

import { selectReferencePoints } from 'gps-plus-slam-app-framework/state';
import type { RecorderStore } from './recorder-store';
import type { RefPointVisualizer } from '../visualization/ref-point-visualizer';

/**
 * Wire the 3D visualizer to the canonical reference-points selector.
 * Returns an unsubscribe function that detaches the store listener.
 *
 * Tolerates a missing visualizer (e.g. in headless replay paths) by
 * returning a no-op unsubscribe.
 */
export function wireRefPointSubscribers(
  store: RecorderStore,
  visualizer: Pick<RefPointVisualizer, 'syncRefPoints'> | null
): () => void {
  if (!visualizer) return () => {};

  let last = selectReferencePoints(store.getState());
  // Initial sync on attach so any already-present marks (e.g. after a
  // mid-session subscriber swap) render immediately.
  visualizer.syncRefPoints(last);

  return store.subscribe(() => {
    const next = selectReferencePoints(store.getState());
    if (next === last) return;
    last = next;
    visualizer.syncRefPoints(next);
  });
}
