/**
 * Unit tests for Confirm Dialog Component.
 *
 * TDD: These tests define the expected behavior for a styled confirm dialog
 * that replaces native confirm() which doesn't work reliably inside
 * WebXR DOM overlays on mobile browsers.
 *
 * Why this test matters:
 * - Issue 5 (2026-02-27 user feedback): Back button during recording needs
 *   a confirmation dialog before stopping. Native confirm() is unreliable
 *   in DOM overlay mode during WebXR sessions.
 * - The dialog must be async (Promise-based) to integrate with the
 *   fire-and-forget pattern required by the popstate handler.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  showConfirmDialog,
  isConfirmDialogVisible,
  destroyConfirmDialog,
} from './confirm-dialog';

describe('Confirm Dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    destroyConfirmDialog();
  });

  describe('showConfirmDialog', () => {
    it('should create a dialog element in the DOM', () => {
      // Why: dialog must be visible in the DOM for the user to interact with it
      void showConfirmDialog({ message: 'Stop recording?' });

      const dialog = document.getElementById('confirm-dialog');
      expect(dialog).not.toBeNull();
    });

    it('should display the provided message', () => {
      // Why: user must understand what they are confirming
      void showConfirmDialog({ message: 'Stop recording and go back?' });

      const dialog = document.getElementById('confirm-dialog');
      expect(dialog?.textContent).toContain('Stop recording and go back?');
    });

    it('should display custom button labels when provided', () => {
      // Why: different contexts may need different button labels
      void showConfirmDialog({
        message: 'Stop?',
        confirmLabel: 'Yes, stop',
        cancelLabel: 'Keep recording',
      });

      const dialog = document.getElementById('confirm-dialog');
      expect(dialog?.textContent).toContain('Yes, stop');
      expect(dialog?.textContent).toContain('Keep recording');
    });

    it('should use default button labels when not provided', () => {
      // Why: sensible defaults reduce boilerplate at call sites
      void showConfirmDialog({ message: 'Are you sure?' });

      const dialog = document.getElementById('confirm-dialog');
      expect(dialog?.textContent).toContain('Confirm');
      expect(dialog?.textContent).toContain('Cancel');
    });

    it('should report visible via isConfirmDialogVisible', () => {
      // Why: callers need to check if dialog is already showing (rapid-press guard)
      expect(isConfirmDialogVisible()).toBe(false);

      void showConfirmDialog({ message: 'Test' });

      expect(isConfirmDialogVisible()).toBe(true);
    });

    it('should resolve true when confirm button is clicked', async () => {
      // Why: confirm path must resolve the promise so the caller can proceed
      const resultPromise = showConfirmDialog({ message: 'Stop?' });

      const confirmBtn = document.querySelector(
        '[data-testid="confirm-dialog-confirm"]'
      ) as HTMLButtonElement;
      expect(confirmBtn).not.toBeNull();
      confirmBtn.click();

      const result = await resultPromise;
      expect(result).toBe(true);
    });

    it('should resolve false when cancel button is clicked', async () => {
      // Why: cancel path must resolve (not reject) so callers don't need try/catch
      const resultPromise = showConfirmDialog({ message: 'Stop?' });

      const cancelBtn = document.querySelector(
        '[data-testid="confirm-dialog-cancel"]'
      ) as HTMLButtonElement;
      expect(cancelBtn).not.toBeNull();
      cancelBtn.click();

      const result = await resultPromise;
      expect(result).toBe(false);
    });

    it('should remove dialog from DOM after confirm', async () => {
      // Why: dialog must clean up after itself to avoid DOM pollution
      const resultPromise = showConfirmDialog({ message: 'Stop?' });

      const confirmBtn = document.querySelector(
        '[data-testid="confirm-dialog-confirm"]'
      ) as HTMLButtonElement;
      confirmBtn.click();
      await resultPromise;

      expect(document.getElementById('confirm-dialog')).toBeNull();
      expect(isConfirmDialogVisible()).toBe(false);
    });

    it('should remove dialog from DOM after cancel', async () => {
      // Why: cancel must also clean up
      const resultPromise = showConfirmDialog({ message: 'Stop?' });

      const cancelBtn = document.querySelector(
        '[data-testid="confirm-dialog-cancel"]'
      ) as HTMLButtonElement;
      cancelBtn.click();
      await resultPromise;

      expect(document.getElementById('confirm-dialog')).toBeNull();
      expect(isConfirmDialogVisible()).toBe(false);
    });

    it('should resolve previous dialog with false when called again while visible', async () => {
      // Why: if a second dialog is requested while one is showing, the first
      // should be dismissed (resolved with false) to avoid orphaned promises
      const firstPromise = showConfirmDialog({ message: 'First?' });
      const secondPromise = showConfirmDialog({ message: 'Second?' });

      // First should resolve false (dismissed)
      const firstResult = await firstPromise;
      expect(firstResult).toBe(false);

      // Second should still be visible
      expect(isConfirmDialogVisible()).toBe(true);
      const dialog = document.getElementById('confirm-dialog');
      expect(dialog?.textContent).toContain('Second?');

      // Clean up second dialog
      const cancelBtn = document.querySelector(
        '[data-testid="confirm-dialog-cancel"]'
      ) as HTMLButtonElement;
      cancelBtn.click();
      await secondPromise;
    });

    it('should have proper z-index class to appear above AR overlay', () => {
      // Why: during WebXR, the dialog must be above the DOM overlay content.
      // Uses Tailwind z-index class (z-[1001]) for consistency with the rest of the UI.
      void showConfirmDialog({ message: 'Test' });

      const dialog = document.getElementById('confirm-dialog');
      expect(dialog?.className).toContain('z-[1001]');
    });

    it('should have a backdrop/overlay to prevent interaction with content behind', () => {
      // Why: user should not be able to interact with recording controls
      // while the confirmation dialog is showing
      void showConfirmDialog({ message: 'Test' });

      const backdrop = document.querySelector(
        '[data-testid="confirm-dialog-backdrop"]'
      );
      expect(backdrop).not.toBeNull();
    });

    it('should append backdrop as a direct child of body so it covers the full viewport', () => {
      // Why: if the backdrop is inside the dialog (which has a fixed width),
      // its 100% width/height resolves against the dialog, not the viewport,
      // so it won't actually cover the screen.
      void showConfirmDialog({ message: 'Test' });

      const backdrop = document.querySelector(
        '[data-testid="confirm-dialog-backdrop"]'
      );
      expect(backdrop).not.toBeNull();
      expect(backdrop!.parentElement).toBe(document.body);
    });

    it('should remove backdrop from body after confirm', async () => {
      // Why: backdrop must be cleaned up alongside the dialog
      const resultPromise = showConfirmDialog({ message: 'Stop?' });

      const confirmBtn = document.querySelector(
        '[data-testid="confirm-dialog-confirm"]'
      ) as HTMLButtonElement;
      confirmBtn.click();
      await resultPromise;

      const backdrop = document.querySelector(
        '[data-testid="confirm-dialog-backdrop"]'
      );
      expect(backdrop).toBeNull();
    });

    it('should remove backdrop from body after cancel', async () => {
      // Why: backdrop must be cleaned up alongside the dialog
      const resultPromise = showConfirmDialog({ message: 'Stop?' });

      const cancelBtn = document.querySelector(
        '[data-testid="confirm-dialog-cancel"]'
      ) as HTMLButtonElement;
      cancelBtn.click();
      await resultPromise;

      const backdrop = document.querySelector(
        '[data-testid="confirm-dialog-backdrop"]'
      );
      expect(backdrop).toBeNull();
    });
  });

  describe('uses Tailwind classes instead of inline styles', () => {
    // Why: the rest of the Recorder App UI (hud.ts, session-summary.ts,
    // summary-map.ts, log-panel.ts) uses Tailwind utility classes via
    // className/classList. Inline Object.assign(el.style, {...}) is
    // inconsistent with the project convention and harder to maintain.

    it('should style the dialog container with Tailwind classes', () => {
      void showConfirmDialog({ message: 'Test' });
      const dialog = document.getElementById('confirm-dialog');
      expect(dialog).not.toBeNull();

      // Core layout classes for centering
      expect(dialog!.className).toContain('fixed');
      expect(dialog!.className).toContain('top-1/2');
      expect(dialog!.className).toContain('left-1/2');
      expect(dialog!.className).toContain('-translate-x-1/2');
      expect(dialog!.className).toContain('-translate-y-1/2');
      // Should not use inline styles for layout
      expect(dialog!.style.position).toBe('');
      expect(dialog!.style.top).toBe('');
    });

    it('should style the backdrop with Tailwind classes', () => {
      void showConfirmDialog({ message: 'Test' });
      const backdrop = document.querySelector(
        '[data-testid="confirm-dialog-backdrop"]'
      ) as HTMLElement;
      expect(backdrop).not.toBeNull();

      expect(backdrop.className).toContain('fixed');
      expect(backdrop.className).toContain('inset-0');
      expect(backdrop.className).toContain('z-[1000]');
      expect(backdrop.style.position).toBe('');
    });

    it('should style buttons with Tailwind classes', () => {
      void showConfirmDialog({ message: 'Test' });
      const confirmBtn = document.querySelector(
        '[data-testid="confirm-dialog-confirm"]'
      ) as HTMLElement;
      const cancelBtn = document.querySelector(
        '[data-testid="confirm-dialog-cancel"]'
      ) as HTMLElement;

      // Confirm button should have red background class
      expect(confirmBtn.className).toContain('bg-red-500');
      expect(confirmBtn.style.backgroundColor).toBe('');

      // Cancel button should have dark background class
      expect(cancelBtn.className).toContain('bg-[#333]');
      expect(cancelBtn.style.backgroundColor).toBe('');
    });
  });

  describe('destroyConfirmDialog', () => {
    it('should remove dialog from DOM', () => {
      // Why: full cleanup for test teardown and app reset
      void showConfirmDialog({ message: 'Test' });
      expect(document.getElementById('confirm-dialog')).not.toBeNull();

      destroyConfirmDialog();

      expect(document.getElementById('confirm-dialog')).toBeNull();
      expect(isConfirmDialogVisible()).toBe(false);
    });

    it('should be safe to call when no dialog is showing', () => {
      // Why: idempotent cleanup prevents errors
      expect(() => destroyConfirmDialog()).not.toThrow();
    });

    it('should resolve pending promise with false', async () => {
      // Why: destroying while visible should cleanly resolve the promise
      const resultPromise = showConfirmDialog({ message: 'Test' });

      destroyConfirmDialog();

      const result = await resultPromise;
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // Bug 4: Backdrop click must dismiss dialog (SPA audit 2026-04-06)
  // =========================================================================

  describe('backdrop dismissal', () => {
    // Why: Standard modal UX dictates clicking outside the dialog dismisses it.
    // In a WebXR overlay, users may struggle to hit small buttons, so the
    // backdrop must be a valid dismissal target.
    it('should resolve with false when backdrop is clicked', async () => {
      const resultPromise = showConfirmDialog({
        message: 'Stop recording?',
        confirmLabel: 'Stop',
        cancelLabel: 'Keep',
      });

      expect(isConfirmDialogVisible()).toBe(true);

      const backdrop = document.querySelector(
        '[data-testid="confirm-dialog-backdrop"]'
      ) as HTMLElement;
      expect(backdrop).not.toBeNull();

      backdrop.click();

      const result = await resultPromise;
      expect(result).toBe(false);
      expect(isConfirmDialogVisible()).toBe(false);
    });

    // Why: Clicking inside the dialog (on the message text) must not
    // dismiss it — only backdrop or explicit buttons should dismiss.
    it('should not dismiss when clicking inside the dialog', () => {
      void showConfirmDialog({ message: 'Keep going?' });

      const dialog = document.getElementById('confirm-dialog')!;
      dialog.click();

      // Dialog should still be visible
      expect(isConfirmDialogVisible()).toBe(true);
    });
  });

  describe('AR DOM-overlay nesting (2026-06-19)', () => {
    // Why these tests matter: this dialog explicitly exists to replace native
    // confirm() *inside WebXR DOM overlays* — yet it appended to document.body,
    // a SIBLING of the `#app` overlay root (the element passed to `initAR`,
    // bound as `domOverlay = { root: container }`). Under DOM Overlay only the
    // overlay root and its descendants composite over the AR camera, so the
    // back-during-recording prompt (shown while an XR session is active) would
    // be INVISIBLE — the same bug class as the toast (2026-06-16 Finding 4 / D4;
    // 2026-06-05 HUD-stacking ancestor rule). The dialog + backdrop must mount
    // INSIDE `#app`.

    it('mounts the dialog and backdrop inside the #app overlay root', () => {
      const app = document.createElement('div');
      app.id = 'app';
      document.body.appendChild(app);

      void showConfirmDialog({ message: 'Stop recording and go back?' });

      const dialog = document.getElementById('confirm-dialog');
      const backdrop = document.querySelector(
        '[data-testid="confirm-dialog-backdrop"]'
      );
      expect(dialog).not.toBeNull();
      expect(backdrop).not.toBeNull();
      // Descendant-of-`#app` is the invariant that makes them visible in AR.
      expect(app.contains(dialog)).toBe(true);
      expect(app.contains(backdrop)).toBe(true);
    });

    it('falls back to document.body when no #app overlay root exists', () => {
      expect(document.getElementById('app')).toBeNull();

      void showConfirmDialog({ message: 'Stop?' });

      const dialog = document.getElementById('confirm-dialog');
      expect(dialog?.parentElement).toBe(document.body);
    });

    it('still removes the dialog and backdrop after the re-parent (cleanup)', () => {
      const app = document.createElement('div');
      app.id = 'app';
      document.body.appendChild(app);

      void showConfirmDialog({ message: 'Stop?' });
      destroyConfirmDialog();

      expect(document.getElementById('confirm-dialog')).toBeNull();
      expect(
        document.querySelector('[data-testid="confirm-dialog-backdrop"]')
      ).toBeNull();
    });
  });
});
