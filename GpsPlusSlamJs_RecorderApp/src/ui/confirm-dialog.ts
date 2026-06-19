/**
 * Confirm Dialog Component
 *
 * A styled confirmation dialog that replaces native confirm() for use inside
 * WebXR DOM overlays where native dialogs are unreliable on mobile browsers.
 *
 * Returns a Promise<boolean>: true for confirm, false for cancel/dismiss.
 *
 * Issue 5 (2026-02-27 user feedback): Back button during recording needs
 * a confirmation dialog before stopping the recording.
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('ConfirmDialog');

// --- Types ---

interface ConfirmDialogOptions {
  /** The question/message to display */
  message: string;
  /** Label for the confirm button (default: 'Confirm') */
  confirmLabel?: string;
  /** Label for the cancel button (default: 'Cancel') */
  cancelLabel?: string;
}

// --- Constants ---

const DIALOG_ID = 'confirm-dialog';
const BACKDROP_TESTID = 'confirm-dialog-backdrop';
const CONFIRM_TESTID = 'confirm-dialog-confirm';
const CANCEL_TESTID = 'confirm-dialog-cancel';

/**
 * Id of the AR DOM-overlay root — the element handed to `initAR` and bound as
 * `domOverlay = { root: container }`. Under WebXR DOM Overlay only this element
 * and its descendants composite over the camera feed, so the dialog + backdrop
 * must mount INSIDE it (not as siblings on `document.body`) to be visible during
 * an immersive-ar session — exactly what this component exists for (the
 * back-during-recording prompt fires while the XR session is active). Same rule
 * as `toast.ts`; see the 2026-06-05 HUD-stacking finding and 2026-06-16 D4.
 */
const AR_OVERLAY_ROOT_ID = 'app';

// --- State ---

let dialogElement: HTMLElement | null = null;
let currentResolver: ((value: boolean) => void) | null = null;

// --- Implementation ---

/**
 * Show a styled confirmation dialog.
 *
 * If a dialog is already showing, the previous one is dismissed (resolved
 * with false) before showing the new one.
 *
 * @returns Promise that resolves true on confirm, false on cancel/dismiss
 */
export function showConfirmDialog(
  options: ConfirmDialogOptions
): Promise<boolean> {
  const { message, confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = options;

  // Dismiss any existing dialog
  if (currentResolver) {
    log.info('Dismissing previous dialog (new dialog requested)');
    currentResolver(false);
    removeDialog();
  }

  return new Promise<boolean>((resolve) => {
    currentResolver = resolve;

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.dataset.testid = BACKDROP_TESTID;
    backdrop.className = 'fixed inset-0 w-full h-full bg-black/50 z-[1000]';
    backdrop.addEventListener('click', () => handleResolve(false));

    // Create dialog container
    dialogElement = document.createElement('div');
    dialogElement.id = DIALOG_ID;
    dialogElement.className =
      'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ' +
      'bg-[#1e1e2e] text-white p-6 rounded-xl ' +
      'shadow-[0_4px_24px_rgba(0,0,0,0.5)] z-[1001] ' +
      'max-w-[90%] w-80 text-center font-sans';

    // Message
    const messageEl = document.createElement('p');
    messageEl.textContent = message;
    messageEl.className = 'mt-0 mb-6 ml-0 mr-0 text-lg leading-[1.4]';

    // Button container
    const btnContainer = document.createElement('div');
    btnContainer.className = 'flex gap-3 justify-center';

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = cancelLabel;
    cancelBtn.dataset.testid = CANCEL_TESTID;
    cancelBtn.className =
      'flex-1 py-3 px-4 rounded-lg border border-[#555] ' +
      'bg-[#333] text-[#ddd] text-base cursor-pointer';
    cancelBtn.addEventListener('click', () => handleResolve(false));

    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = confirmLabel;
    confirmBtn.dataset.testid = CONFIRM_TESTID;
    confirmBtn.className =
      'flex-1 py-3 px-4 rounded-lg border-none ' +
      'bg-red-500 text-white text-base font-semibold cursor-pointer';
    confirmBtn.addEventListener('click', () => handleResolve(true));

    // Assemble
    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(confirmBtn);
    dialogElement.appendChild(messageEl);
    dialogElement.appendChild(btnContainer);

    // Mount inside the AR DOM-overlay root (`#app`) so the dialog composites
    // over the camera feed during an immersive-ar session; fall back to
    // `document.body` defensively when the overlay root is absent.
    const overlayRoot =
      document.getElementById(AR_OVERLAY_ROOT_ID) ?? document.body;
    overlayRoot.appendChild(backdrop);
    overlayRoot.appendChild(dialogElement);
    log.info(`Confirm dialog shown: "${message}"`);
  });
}

/**
 * Whether a confirm dialog is currently visible.
 */
export function isConfirmDialogVisible(): boolean {
  return dialogElement !== null;
}

/**
 * Destroy the confirm dialog and resolve any pending promise with false.
 * Safe to call when no dialog is showing (no-op).
 */
export function destroyConfirmDialog(): void {
  if (currentResolver) {
    currentResolver(false);
    currentResolver = null;
  }
  removeDialog();
}

// --- Internal ---

function handleResolve(value: boolean): void {
  const resolver = currentResolver;
  currentResolver = null;
  removeDialog();
  if (resolver) {
    resolver(value);
  }
  log.info(`Confirm dialog resolved: ${value}`);
}

function removeDialog(): void {
  if (dialogElement) {
    dialogElement.remove();
    dialogElement = null;
  }
  // Query the whole document: the backdrop may live under `#app` (overlay root)
  // or `document.body` (fallback), so don't scope the lookup to either.
  const backdrop = document.querySelector(`[data-testid="${BACKDROP_TESTID}"]`);
  if (backdrop) {
    backdrop.remove();
  }
}
