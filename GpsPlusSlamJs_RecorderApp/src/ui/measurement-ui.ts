/**
 * Measurement UI — coaching prompts, confirm button, undo, crosshair overlay.
 *
 * Subscribes to the Redux store and updates DOM elements that represent
 * the live measurement marking flow. All DOM manipulation is centralized
 * here — the rest of the measurement stack (handlers, slice, view) is
 * framework-free.
 *
 * The crosshair is a fixed center reticle. Tap events on the AR canvas
 * are normalized to [0, 1] screen coordinates and forwarded to
 * `handleShootRay(normX, normY)`.
 *
 * Phase 4 of the integration plan.
 */

import type { MeasurementPointHandlers } from '../measurement-points/measurement-point-handlers';
import {
  selectMeasurementDraft,
  selectPendingRays,
} from '../state/measurement-points-slice';
import type {
  CoachingPrompt,
  LiveMeasurementDraft,
} from '../utils/live-measurement-quality';
import type { RecorderStore } from '../state/recorder-store';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('MeasurementUI');

// ---------------------------------------------------------------------------
// Coaching text map
// ---------------------------------------------------------------------------

const COACHING_TEXT: Record<CoachingPrompt, string> = {
  none: '',
  move_sideways: '↔ Move sideways for better parallax',
  add_more_rays: '⊕ Tap to add more observation rays',
  reaim_target: '🎯 Re-aim at the target point',
  ready_to_confirm: '✓ Ready — tap Confirm to save',
};

// ---------------------------------------------------------------------------
// DOM creation helpers
// ---------------------------------------------------------------------------

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, val);
  }
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const PANEL_STYLES = `
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 50;
  pointer-events: none;
`;

const COACHING_STYLES = `
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-family: 'Inter', 'Roboto', system-ui, sans-serif;
  font-size: 14px;
  padding: 8px 16px;
  border-radius: 20px;
  white-space: nowrap;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
`;

const BUTTON_BASE_STYLES = `
  font-family: 'Inter', 'Roboto', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 12px;
  padding: 10px 24px;
  cursor: pointer;
  pointer-events: auto;
  transition: opacity 0.2s, transform 0.1s;
`;

const CROSSHAIR_STYLES = `
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 40px;
  z-index: 50;
  pointer-events: none;
`;

const UNCERTAINTY_STYLES = `
  background: rgba(0, 0, 0, 0.6);
  color: #aaa;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 10px;
`;

// ---------------------------------------------------------------------------
// MeasurementUI
// ---------------------------------------------------------------------------

export interface MeasurementUIOptions {
  /** The container element to append the UI to. */
  container: HTMLElement;
  /** The AR canvas element for tap events. */
  arCanvas: HTMLElement;
  /** Measurement point handlers (for shoot/confirm/undo/delete). */
  handlers: MeasurementPointHandlers;
  /** Redux store. */
  store: RecorderStore;
  /** Current scenario ID for confirm. */
  getScenarioId: () => string;
  /**
   * Optional integrated confirm callback.
   * When provided, the Confirm button calls this instead of the
   * standalone handleConfirmPoint — allowing the caller to wire
   * in the ref-point creation + measurement persistence flow.
   */
  onConfirmIntegrated?: () => Promise<void>;
}

export interface MeasurementUIInstance {
  /** Show the measurement UI panel. */
  show(): void;
  /** Hide the measurement UI panel. */
  hide(): void;
  /** Dispose of the UI and unsubscribe from the store. */
  dispose(): void;
}

/**
 * Create and mount the measurement UI.
 * Returns a handle to show/hide/dispose.
 */
export function createMeasurementUI(
  options: MeasurementUIOptions
): MeasurementUIInstance {
  const { container, arCanvas, handlers, store, getScenarioId } = options;

  // ── Crosshair ──
  const crosshair = createEl('div', { id: 'measurement-crosshair' });
  crosshair.setAttribute('style', CROSSHAIR_STYLES);
  crosshair.innerHTML = `
    <svg viewBox="0 0 40 40" width="40" height="40">
      <circle cx="20" cy="20" r="12" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="1.5"/>
      <circle cx="20" cy="20" r="2" fill="rgba(255,255,255,0.9)"/>
      <line x1="20" y1="4" x2="20" y2="12" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
      <line x1="20" y1="28" x2="20" y2="36" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
      <line x1="4" y1="20" x2="12" y2="20" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
      <line x1="28" y1="20" x2="36" y2="20" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
    </svg>
  `;

  // ── Panel (coaching + buttons) ──
  const panel = createEl('div', { id: 'measurement-panel' });
  panel.setAttribute('style', PANEL_STYLES);

  const coachingBanner = createEl('div', { id: 'measurement-coaching' });
  coachingBanner.setAttribute('style', COACHING_STYLES);

  const uncertaintyLabel = createEl('div', { id: 'measurement-uncertainty' });
  uncertaintyLabel.setAttribute('style', UNCERTAINTY_STYLES);

  const buttonRow = createEl('div');
  buttonRow.setAttribute(
    'style',
    'display: flex; gap: 8px; pointer-events: auto;'
  );

  const confirmBtn = createEl(
    'button',
    { id: 'measurement-confirm-btn' },
    '✓ Confirm'
  );
  confirmBtn.setAttribute(
    'style',
    `${BUTTON_BASE_STYLES} background: #00c853; color: #fff;`
  );

  const undoBtn = createEl(
    'button',
    { id: 'measurement-undo-btn' },
    '↩ Undo Ray'
  );
  undoBtn.setAttribute(
    'style',
    `${BUTTON_BASE_STYLES} background: rgba(255,255,255,0.15); color: #fff;`
  );

  buttonRow.appendChild(undoBtn);
  buttonRow.appendChild(confirmBtn);

  panel.appendChild(coachingBanner);
  panel.appendChild(uncertaintyLabel);
  panel.appendChild(buttonRow);

  container.appendChild(crosshair);
  container.appendChild(panel);

  // ── Tap handler (shoot ray) ──
  function handleTap(event: MouseEvent | TouchEvent): void {
    const rect = arCanvas.getBoundingClientRect();
    let clientX: number;
    let clientY: number;

    if (event instanceof TouchEvent) {
      if (event.touches.length === 0) return;
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    // Normalize to [0, 1] in the canvas coordinate space
    const normX = (clientX - rect.left) / rect.width;
    const normY = (clientY - rect.top) / rect.height;

    handlers.handleShootRay(normX, normY);
  }

  arCanvas.addEventListener('click', handleTap);
  arCanvas.addEventListener('touchstart', handleTap, { passive: true });

  // ── Button handlers ──
  confirmBtn.addEventListener('click', () => {
    if (options.onConfirmIntegrated) {
      void options.onConfirmIntegrated();
    } else {
      void handlers.handleConfirmPoint(getScenarioId());
    }
  });

  undoBtn.addEventListener('click', () => {
    handlers.handleUndoRay();
  });

  // ── Redux subscription ──
  let lastDraft: LiveMeasurementDraft | null = null;
  let lastRayCount = 0;

  function updateUI(): void {
    const state = store.getState();
    const draft = selectMeasurementDraft(state);
    const rays = selectPendingRays(state);

    // Skip redundant DOM updates
    if (draft === lastDraft && rays.length === lastRayCount) return;
    lastDraft = draft;
    lastRayCount = rays.length;

    // Coaching banner
    const text = COACHING_TEXT[draft.prompt];
    coachingBanner.textContent = text;
    coachingBanner.style.display = text ? 'block' : 'none';

    // Uncertainty readout
    if (draft.uncertainty !== undefined && draft.status !== 'idle') {
      uncertaintyLabel.textContent = `± ${(draft.uncertainty * 100).toFixed(1)} cm`;
      uncertaintyLabel.style.display = 'block';
    } else {
      uncertaintyLabel.style.display = 'none';
    }

    // Confirm button state
    confirmBtn.disabled = !draft.canConfirm;
    confirmBtn.style.opacity = draft.canConfirm ? '1' : '0.4';

    // Undo button visibility
    undoBtn.style.display = rays.length > 0 ? 'inline-block' : 'none';

    // Panel visibility: show when draft is active
    panel.style.display = draft.status === 'idle' ? 'none' : 'flex';
  }

  const unsubscribe = store.subscribe(updateUI);
  // Initial render
  updateUI();

  // ── Public API ──
  let visible = true;

  return {
    show() {
      visible = true;
      crosshair.style.display = 'block';
      updateUI();
    },
    hide() {
      visible = false;
      crosshair.style.display = 'none';
      panel.style.display = 'none';
    },
    dispose() {
      unsubscribe();
      arCanvas.removeEventListener('click', handleTap);
      arCanvas.removeEventListener('touchstart', handleTap);
      crosshair.remove();
      panel.remove();
    },
  };
}
