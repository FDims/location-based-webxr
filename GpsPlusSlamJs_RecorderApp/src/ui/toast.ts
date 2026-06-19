/**
 * Toast Notification Component
 *
 * A simple toast notification system for displaying temporary messages
 * to users. Primarily used for alerting users of write failures.
 *
 * User Feedback Issue #1 Part B: Users need real-time feedback
 * when file write operations fail, not just a count at the end.
 */

// --- Types ---

type ToastSeverity = 'info' | 'warning' | 'error';

interface ToastOptions {
  /** How long to show the toast in milliseconds (default: 5000) */
  duration?: number;
  /** Visual severity level (default: 'warning') */
  severity?: ToastSeverity;
}

// --- Constants ---

const DEFAULT_DURATION = 5000;
/** Longer display duration for error toasts (ms) */
export const TOAST_DURATION_ERROR = 8000;
const TOAST_CONTAINER_ID = 'toast-container';

/**
 * Id of the AR DOM-overlay root — the element handed to `initAR` and bound as
 * `domOverlay = { root: container }`. Under WebXR DOM Overlay only this element
 * and its descendants composite over the camera feed, so the toast container
 * must mount INSIDE it (not as a sibling on `document.body`) to be visible in
 * an immersive-ar session. See 2026-06-05 HUD-stacking finding (Finding 3) and
 * 2026-06-16 user-feedback Finding 4 / D4.
 */
const AR_OVERLAY_ROOT_ID = 'app';

// --- State ---

let containerElement: HTMLElement | null = null;
let hideTimeoutId: ReturnType<typeof setTimeout> | null = null;

// --- Implementation ---

/**
 * Initialize the toast notification system.
 * Creates the toast container element in the DOM.
 * Safe to call multiple times (idempotent).
 */
export function initToast(): void {
  // Check if already initialized
  if (containerElement) {
    return;
  }

  // Check if container already exists in DOM (e.g., from previous init)
  const existing = document.getElementById(TOAST_CONTAINER_ID);
  if (existing) {
    containerElement = existing;
    return;
  }

  // Create the toast container
  containerElement = document.createElement('div');
  containerElement.id = TOAST_CONTAINER_ID;
  containerElement.classList.add('hidden');

  // Style the container (positioned at bottom center) using Tailwind classes
  containerElement.classList.add(
    'fixed',
    'bottom-20',
    'left-1/2',
    '-translate-x-1/2',
    'py-3',
    'px-6',
    'rounded-lg',
    'font-medium',
    'z-[100]',
    'max-w-[90%]',
    'text-center'
  );

  // Mount inside the AR DOM-overlay root (`#app`) so the toast composites over
  // the camera feed during an immersive-ar session. `#app` is also the
  // persistent page root that hosts the setup + replay UI, so non-AR toasts
  // (replay "✅ Replay complete", setup/save failures) stay visible too. Fall
  // back to `document.body` defensively when the overlay root is absent (e.g.
  // isolated test contexts) rather than throwing.
  const overlayRoot = document.getElementById(AR_OVERLAY_ROOT_ID);
  (overlayRoot ?? document.body).appendChild(containerElement);
}

// Severity-specific Tailwind classes
const SEVERITY_CLASSES: Record<ToastSeverity, string[]> = {
  info: ['bg-blue-500/90', 'text-white', 'border', 'border-blue-500'],
  warning: ['bg-amber-400/90', 'text-black', 'border', 'border-amber-400'],
  error: ['bg-red-500/90', 'text-white', 'border', 'border-red-500'],
};

/** All severity Tailwind classes (for removal when switching). */
const ALL_SEVERITY_CLASSES = Object.values(SEVERITY_CLASSES).flat();

/**
 * Apply severity-specific styling to the toast container.
 */
function applySeverityStyle(severity: ToastSeverity): void {
  if (!containerElement) {
    return;
  }

  // Remove existing severity classes (both legacy marker and Tailwind)
  containerElement.classList.remove(
    'toast-info',
    'toast-warning',
    'toast-error',
    ...ALL_SEVERITY_CLASSES
  );

  // Add semantic marker and Tailwind color classes
  containerElement.classList.add(
    `toast-${severity}`,
    ...SEVERITY_CLASSES[severity]
  );
}

/**
 * Show a toast notification with the given message.
 * Replaces any currently visible toast.
 *
 * @param message - The message to display
 * @param options - Optional configuration (duration, severity)
 */
export function showToast(message: string, options: ToastOptions = {}): void {
  if (!containerElement) {
    initToast();
  }

  // Clear any existing timeout
  if (hideTimeoutId !== null) {
    clearTimeout(hideTimeoutId);
    hideTimeoutId = null;
  }

  const { duration = DEFAULT_DURATION, severity = 'warning' } = options;

  // Update content and styling
  containerElement!.textContent = message;
  applySeverityStyle(severity);

  // Show the toast
  containerElement!.classList.remove('hidden');

  // Auto-hide after duration
  hideTimeoutId = setTimeout(() => {
    hideToast();
  }, duration);
}

/**
 * Hide the toast notification immediately.
 * Safe to call when already hidden.
 */
export function hideToast(): void {
  if (hideTimeoutId !== null) {
    clearTimeout(hideTimeoutId);
    hideTimeoutId = null;
  }

  if (containerElement) {
    containerElement.classList.add('hidden');
  }
}

/**
 * Destroy the toast system and remove from DOM.
 * Primarily for testing cleanup.
 */
export function destroyToast(): void {
  hideToast();

  if (containerElement) {
    containerElement.remove();
    containerElement = null;
  }
}
