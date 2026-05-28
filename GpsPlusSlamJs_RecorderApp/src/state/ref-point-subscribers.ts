/**
 * Recorder-app subscriber for the 3D ref-point visualizer.
 *
 * Step 5.3 of 2026-05-27-collapse-refpoint-and-frame-slices-plan.md
 * migrated this wiring from the library's `selectReferencePoints`
 * (over `state.gpsData.referencePoints`) onto the recorder-side flat
 * `selectRefPointEntries` selector (over `state.refPoints.entries`).
 * The visualizer's `syncRefPoints` method now consumes `RefPointEntry`
 * directly and renders all entries uniformly, animating newly-inserted
 * ids via an id-based diff.
 */

import type { RecorderStore } from './recorder-store';
import { selectRefPointEntries } from './ref-points-slice';
import type { RefPointVisualizer } from '../visualization/ref-point-visualizer';

/**
 * Wire the 3D visualizer to the recorder's flat `refPoints` slice.
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

  let last = selectRefPointEntries(store.getState().refPoints);
  // Initial sync on attach so any already-present entries (e.g. imported
  // via the OPFS sidecar fast-path before the subscriber attached) render
  // immediately.
  visualizer.syncRefPoints(last);

  return store.subscribe(() => {
    const next = selectRefPointEntries(store.getState().refPoints);
    if (next === last) return;
    last = next;
    visualizer.syncRefPoints(next);
  });
}
