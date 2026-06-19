/**
 * Unit tests for Toast Notification Component.
 *
 * TDD: These tests define the expected behavior for a simple toast
 * notification system used to alert users of write failures.
 *
 * Why this test matters:
 * - User Feedback Issue #1 Part B: Users need real-time feedback
 *   when file write operations fail, not just a count at the end.
 * - The toast provides immediate visibility into data loss issues.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  initToast,
  showToast,
  hideToast,
  destroyToast,
  TOAST_DURATION_ERROR,
} from './toast.js';

describe('Toast Notification', () => {
  beforeEach(() => {
    // Clean slate for each test
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroyToast();
    vi.useRealTimers();
  });

  describe('initToast', () => {
    it('should create a toast container in the DOM', () => {
      // Why: Toast needs a container element to render into
      initToast();

      const container = document.getElementById('toast-container');
      expect(container).not.toBeNull();
    });

    it('should be hidden by default', () => {
      // Why: Toast should only appear when showToast is called
      initToast();

      const container = document.getElementById('toast-container');
      expect(container?.classList.contains('hidden')).toBe(true);
    });

    it('should be idempotent (multiple calls do not create duplicates)', () => {
      // Why: Safe to call init multiple times
      initToast();
      initToast();
      initToast();

      const containers = document.querySelectorAll('#toast-container');
      expect(containers.length).toBe(1);
    });
  });

  describe('showToast', () => {
    beforeEach(() => {
      initToast();
    });

    it('should display the provided message', () => {
      // Why: Core functionality - show message to user
      showToast('⚠️ Save failed - check folder permissions');

      const container = document.getElementById('toast-container');
      expect(container?.textContent).toContain('Save failed');
    });

    it('should make the toast visible', () => {
      // Why: Toast must be visible for user to see
      showToast('Test message');

      const container = document.getElementById('toast-container');
      expect(container?.classList.contains('hidden')).toBe(false);
    });

    it('should auto-hide after default timeout (5 seconds)', () => {
      // Why: Toast should not persist indefinitely
      showToast('Temporary message');

      // Fast-forward time
      vi.advanceTimersByTime(5000);

      const container = document.getElementById('toast-container');
      expect(container?.classList.contains('hidden')).toBe(true);
    });

    it('should support custom timeout duration', () => {
      // Why: Some messages need longer display time
      showToast('Important message', { duration: 10000 });

      vi.advanceTimersByTime(5000);
      let container = document.getElementById('toast-container');
      expect(container?.classList.contains('hidden')).toBe(false);

      vi.advanceTimersByTime(5000);
      container = document.getElementById('toast-container');
      expect(container?.classList.contains('hidden')).toBe(true);
    });

    it('should support different severity levels (warning, error)', () => {
      // Why: Visual distinction between warning and error
      showToast('Warning message', { severity: 'warning' });
      let container = document.getElementById('toast-container');
      expect(container?.classList.contains('toast-warning')).toBe(true);

      showToast('Error message', { severity: 'error' });
      container = document.getElementById('toast-container');
      expect(container?.classList.contains('toast-error')).toBe(true);
    });

    it('should replace previous toast when showing a new one', () => {
      // Why: Avoid stacking multiple toasts
      showToast('First message');
      showToast('Second message');

      const container = document.getElementById('toast-container');
      expect(container?.textContent).not.toContain('First');
      expect(container?.textContent).toContain('Second');
    });
  });

  describe('exported duration constants', () => {
    // Why these tests matter:
    // Named constants prevent magic numbers in callers (e.g. main.ts)
    // and centralize duration semantics in the toast module.

    it('should export TOAST_DURATION_ERROR as 8000ms (longer display for errors)', () => {
      expect(TOAST_DURATION_ERROR).toBe(8000);
    });
  });

  describe('hideToast', () => {
    beforeEach(() => {
      initToast();
    });

    it('should hide the toast immediately', () => {
      // Why: User might want to dismiss manually
      showToast('Test message');
      hideToast();

      const container = document.getElementById('toast-container');
      expect(container?.classList.contains('hidden')).toBe(true);
    });

    it('should be safe to call when already hidden', () => {
      // Why: Defensive programming - no errors on double-hide
      hideToast();
      hideToast();

      // No error thrown
      expect(true).toBe(true);
    });
  });

  describe('uses Tailwind classes instead of inline styles', () => {
    // Why: the rest of the Recorder App UI uses Tailwind utility classes via
    // className/classList. Inline Object.assign(el.style, {...}) is
    // inconsistent with the project convention and harder to maintain.

    it('should style the container with Tailwind layout classes', () => {
      initToast();
      const container = document.getElementById('toast-container');
      expect(container).not.toBeNull();

      // Core positioning classes
      expect(container!.className).toContain('fixed');
      expect(container!.className).toContain('bottom-20');
      expect(container!.className).toContain('left-1/2');
      expect(container!.className).toContain('-translate-x-1/2');
      expect(container!.className).toContain('z-[100]');
      // Should not use inline styles for layout
      expect(container!.style.position).toBe('');
      expect(container!.style.bottom).toBe('');
    });

    it('should apply severity colors via Tailwind classes not inline styles', () => {
      initToast();

      showToast('Info', { severity: 'info' });
      const container = document.getElementById('toast-container')!;
      expect(container.className).toContain('bg-blue-500/90');
      expect(container.style.backgroundColor).toBe('');

      showToast('Warning', { severity: 'warning' });
      expect(container.className).toContain('bg-amber-400/90');
      expect(container.style.backgroundColor).toBe('');

      showToast('Error', { severity: 'error' });
      expect(container.className).toContain('bg-red-500/90');
      expect(container.style.backgroundColor).toBe('');
    });
  });

  describe('destroyToast', () => {
    it('should remove the toast container from DOM', () => {
      // Why: Cleanup for testing and app lifecycle
      initToast();
      destroyToast();

      const container = document.getElementById('toast-container');
      expect(container).toBeNull();
    });
  });

  describe('AR DOM-overlay nesting (D4 F4-A)', () => {
    // Why these tests matter (2026-06-16 user feedback, Finding 4 / D4):
    // Under WebXR DOM Overlay, ONLY the element passed to `initAR` (the recorder's
    // `#app`, bound as `domOverlay = { root: container }`) and its descendants are
    // composited over the AR camera feed. The toast container was appended to
    // `document.body` — a SIBLING of `#app` — so the "Re-observed '<name>'"
    // confirmation fired but was never visible during a recording session. The
    // toast container MUST be a descendant of the `#app` overlay root.
    // See 2026-06-05 HUD-stacking finding (the same ancestor-of-`initAR` rule).

    it('mounts the toast container inside the #app overlay root so it composites over the AR camera', () => {
      const app = document.createElement('div');
      app.id = 'app';
      document.body.appendChild(app);

      initToast();

      const container = document.getElementById('toast-container');
      expect(container).not.toBeNull();
      // Descendant-of-`#app` is the invariant that makes the toast visible in AR.
      expect(app.contains(container)).toBe(true);
    });

    it('keeps a non-AR toast visible after the re-parent (replay/setup multi-context regression)', () => {
      // `showToast` is also used on the replay screen ("✅ Replay complete") and
      // for setup/save failures (main.ts). Re-parenting into `#app` must NOT
      // regress those non-AR toasts: `#app` is the persistent page root that also
      // hosts the setup + replay UI, so a toast shown outside AR is still in the
      // DOM and visible.
      const app = document.createElement('div');
      app.id = 'app';
      document.body.appendChild(app);

      initToast();
      showToast('✅ Replay complete', { severity: 'info' });

      const container = document.getElementById('toast-container');
      expect(app.contains(container)).toBe(true);
      expect(container?.classList.contains('hidden')).toBe(false);
    });

    it('falls back to document.body when no #app overlay root exists', () => {
      // Defensive: in non-recorder/test contexts where `#app` is absent the toast
      // must still mount somewhere rather than throwing.
      expect(document.getElementById('app')).toBeNull();

      initToast();

      const container = document.getElementById('toast-container');
      expect(container?.parentElement).toBe(document.body);
    });
  });
});
