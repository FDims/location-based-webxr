/**
 * Sync Manager Module
 *
 * Manages periodic synchronization of OPFS session data to an external ZIP file.
 * Provides crash safety by regularly syncing data to the user's chosen file location.
 *
 * Features:
 * - Periodic sync at configurable intervals (default: 60 seconds)
 * - Visibility change handling (sync when app goes to background)
 * - Status tracking for UI display
 * - Error handling with recovery
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('SyncManager');

// ============================================================================
// Constants
// ============================================================================

/** Default sync interval: 60 seconds (as per user feedback decision) */
export const DEFAULT_SYNC_INTERVAL_MS = 60_000;

// ============================================================================
// Types
// ============================================================================

/**
 * Sync status for UI display and monitoring.
 */
interface SyncStatus {
  /** Current state of the sync manager */
  state: 'idle' | 'active' | 'syncing';
  /** Timestamp of last successful sync (ms since epoch), or null if never synced */
  lastSyncTime: number | null;
  /** Last error message, or null if last sync was successful */
  lastError: string | null;
}

/**
 * Options for creating a sync manager.
 */
interface SyncManagerOptions {
  /** Sync interval in milliseconds. Default: 60000 (60 seconds) */
  intervalMs?: number;
  /** Callback invoked when status changes */
  onStatusChange?: (status: SyncStatus) => void;
}

/**
 * Sync manager interface.
 */
export interface SyncManager {
  /** Start periodic sync */
  start(): void;
  /** Stop periodic sync and cleanup */
  stop(): void;
  /** Get current sync status */
  getStatus(): SyncStatus;
  /** Trigger immediate sync (resets interval timer) */
  syncNow(): Promise<void>;
}

/**
 * Sync function type - the actual sync operation to perform.
 */
type SyncFunction = () => Promise<void>;

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new sync manager.
 *
 * The sync manager handles periodic synchronization and visibility change events.
 * It does NOT perform the actual sync - that's delegated to the provided syncFn.
 *
 * @param syncFn - Function to call for each sync operation
 * @param options - Configuration options
 * @returns SyncManager instance
 *
 * @example
 * ```ts
 * const manager = createSyncManager(
 *   () => syncScenarioSessionToExternalZip(handle, scenarioName, sessionName),
 *   { intervalMs: 60_000 }
 * );
 * manager.start();
 * // ... recording in progress ...
 * manager.stop();
 * ```
 */
export function createSyncManager(
  syncFn: SyncFunction,
  options: SyncManagerOptions = {}
): SyncManager {
  const intervalMs = options.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const onStatusChange = options.onStatusChange;

  // State
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let stopped = true; // Track if manager is stopped to ignore late sync completions
  let status: SyncStatus = {
    state: 'idle',
    lastSyncTime: null,
    lastError: null,
  };

  // Visibility change handler
  let visibilityHandler: (() => void) | null = null;

  /**
   * Update status and notify listeners.
   */
  function updateStatus(updates: Partial<SyncStatus>): void {
    status = { ...status, ...updates };
    if (onStatusChange) {
      onStatusChange(status);
    }
  }

  /**
   * Perform a sync operation.
   * Guards against concurrent executions - if already syncing, the call is skipped.
   * Also guards against late completions after stop() by checking the stopped flag.
   */
  async function performSync(): Promise<void> {
    if (status.state === 'syncing') {
      log.debug('Sync already in progress, skipping.');
      return;
    }
    // Capture stopped state before await to detect if stop() was called during sync
    const wasStoppedBefore = stopped;
    if (wasStoppedBefore) {
      log.debug('Manager is stopped, skipping sync.');
      return;
    }
    updateStatus({ state: 'syncing' });
    try {
      log.debug('Starting sync...');
      await syncFn();
      // Check if stop() was called while we were awaiting
      if (stopped) {
        log.debug('Manager stopped during sync, ignoring completion.');
        return;
      }
      updateStatus({
        state: 'active',
        lastSyncTime: Date.now(),
        lastError: null,
      });
      log.debug('Sync completed successfully');
    } catch (err) {
      // Check if stop() was called while we were awaiting
      if (stopped) {
        log.debug('Manager stopped during sync, ignoring error.');
        return;
      }
      const error = err as Error;
      log.error('Sync failed:', error);
      updateStatus({
        state: 'active',
        lastError: error.message,
      });
    }
  }

  /**
   * Clear and restart the interval timer.
   */
  function resetInterval(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
    }
    intervalId = setInterval(() => {
      void performSync();
    }, intervalMs);
  }

  /**
   * Handle visibility changes.
   * Resets the interval timer after sync to prevent a periodic sync from firing
   * immediately after the visibility-triggered sync (consistent with syncNow()).
   */
  async function handleVisibilityChange(): Promise<void> {
    if (document.visibilityState === 'hidden') {
      log.info('Page hidden, triggering sync...');
      await performSync();
      if (intervalId !== null) {
        resetInterval();
      }
    }
  }

  return {
    start(): void {
      if (intervalId !== null) {
        // Already started
        return;
      }

      log.info(`Starting sync manager with ${intervalMs}ms interval`);
      stopped = false;
      updateStatus({ state: 'active' });

      // Start periodic sync
      intervalId = setInterval(() => {
        void performSync();
      }, intervalMs);

      // Add visibility change listener - wrap async to avoid misused-promises lint error
      visibilityHandler = () => {
        void handleVisibilityChange();
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    },

    stop(): void {
      log.info('Stopping sync manager');
      stopped = true; // Set before cleanup so in-flight syncs know to drop updates

      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }

      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
      }

      updateStatus({ state: 'idle' });
    },

    getStatus(): SyncStatus {
      return { ...status };
    },

    async syncNow(): Promise<void> {
      log.info('Manual sync triggered');
      await performSync();

      // Reset interval to avoid double-sync
      if (intervalId !== null) {
        resetInterval();
      }
    },
  };
}
