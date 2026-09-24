import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { StoreRef } from '../state/store-ref';
import type { CombinedRootState } from '../state/recorder-store';
import type { MeasurementPointVisualizer } from './measurement-point-visualizer';

const log = createLogger('MeasurementPointWire');

export function wireMeasurementPointSubscribers(
  storeRef: StoreRef<CombinedRootState>,
  visualizer: MeasurementPointVisualizer
): () => void {
  return storeRef.get().subscribe(() => {
    try {
      const state = storeRef.get().getState();
      visualizer.update(state);
    } catch (err) {
      log.error('Measurement visualizer update failed', err);
    }
  });
}
