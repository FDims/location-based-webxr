# Toast Notification Component

## Purpose

A simple toast notification system for displaying temporary messages to users. Primarily used for alerting users of file write failures in real-time.

**User Feedback Issue #1 Part B**: Users need immediate feedback when file write operations fail, not just a count at the end of the session.

## Public API

### `initToast(): void`

Initialize the toast notification system. Creates the toast container element and mounts it **inside the AR DOM-overlay root** (`#app`), falling back to `document.body` when that root is absent. Safe to call multiple times (idempotent).

**Why `#app` and not `document.body`:** under WebXR DOM Overlay only the element passed to `initAR` (bound as `domOverlay = { root: container }` — the recorder's `#app`) and its descendants composite over the camera feed. The toast previously appended to `document.body`, a _sibling_ of `#app`, so the "Re-observed '\<name>'" confirmation fired but was invisible during an immersive-ar session (2026-06-16 user-feedback Finding 4 / D4; same ancestor-of-`initAR` rule as the 2026-06-05 HUD-stacking finding). `#app` is also the persistent page root hosting the setup + replay UI, so non-AR toasts (replay "✅ Replay complete", setup/save failures) remain visible.

**Example:**

```typescript
import { initToast } from './ui/toast';

// Call during app initialization
initToast();
```

### `showToast(message: string, options?: ToastOptions): void`

Show a toast notification with the given message. Replaces any currently visible toast.

**Parameters:**

- `message` - The message to display
- `options` - Optional configuration:
  - `duration` - How long to show in ms (default: 5000)
  - `severity` - Visual level: 'info' | 'warning' | 'error' (default: 'warning')

**Example:**

```typescript
import { showToast } from './ui/toast';

// Warning toast (default)
showToast('⚠️ Save failed - check folder permissions');

// Error toast with standard error duration
showToast('Critical error!', {
  severity: 'error',
  duration: TOAST_DURATION_ERROR,
});
```

### `TOAST_DURATION_ERROR` (exported constant)

Standard duration (8000ms) for error-severity toasts. Use instead of inline magic numbers.

```typescript
import { showToast, TOAST_DURATION_ERROR } from './ui/toast';
showToast('⚠️ Save failed', {
  severity: 'error',
  duration: TOAST_DURATION_ERROR,
});
```

### `hideToast(): void`

Hide the toast notification immediately. Safe to call when already hidden.

### `destroyToast(): void`

Remove the toast system from DOM. Primarily for testing cleanup.

## Invariants & Assumptions

- Only one toast is visible at a time (new toast replaces old)
- Toast auto-hides after duration expires
- Container is positioned at bottom-center of viewport
- z-index 100 ensures visibility over most content
- **AR overlay nesting:** the container is a descendant of the `#app` overlay root so it composites over the AR camera in immersive-ar; it degrades to `document.body` only when `#app` is absent.
- **Tailwind utility classes:** All styling (layout + severity colors) uses Tailwind utility classes via `classList`, consistent with the rest of the Recorder App UI. Severity-specific classes are declared in the `SEVERITY_CLASSES` constant map.

## Tests

Located in [toast.test.ts](toast.test.ts):

- Container creation and visibility
- Message display and replacement
- Auto-hide after timeout
- Custom duration support
- Severity styling (warning/error)
- Manual hide functionality
- Tailwind class assertions for container layout and severity colors
- AR DOM-overlay nesting (D4 F4-A): container mounts inside `#app`; non-AR toast still visible after re-parent; `document.body` fallback when `#app` absent
