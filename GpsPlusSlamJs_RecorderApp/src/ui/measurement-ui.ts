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
  DEFAULT_QUALITY_THRESHOLDS,
} from '../state/measurement-points-slice';
import type {
  CoachingPrompt,
  LiveMeasurementDraft,
} from '../utils/live-measurement-quality';
import type { RecorderStore } from '../state/recorder-store';

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
  top: calc(50% + 48px);
  left: 50%;
  transform: translateX(-50%);
  width: min(92vw, 520px);
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
  max-width: 100%;
  text-align: center;
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
  width: 66px;
  height: 66px;
  z-index: 50;
  pointer-events: none;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.95));
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
    <svg viewBox="0 0 66 66" width="66" height="66" aria-hidden="true">
      <circle cx="33" cy="33" r="30" fill="none" stroke="#00e5ff" stroke-width="2"/>
      <line x1="3" y1="33" x2="63" y2="33" stroke="#00e5ff" stroke-width="2"/>
      <line x1="33" y1="3" x2="33" y2="63" stroke="#00e5ff" stroke-width="2"/>
    </svg>
  `;

  // ── Panel (coaching + buttons) ──
  const panel = createEl('div', { id: 'measurement-panel' });
  panel.setAttribute('style', PANEL_STYLES);

  const coachingBanner = createEl('div', { id: 'measurement-coaching' });
  coachingBanner.setAttribute('style', COACHING_STYLES);

  const uncertaintyLabel = createEl('div', { id: 'measurement-uncertainty' });
  uncertaintyLabel.setAttribute('style', UNCERTAINTY_STYLES);

  const rayCountLabel = createEl('div', { id: 'measurement-ray-count' });
  rayCountLabel.setAttribute(
    'style',
    'color: #fff; font: 600 13px system-ui, sans-serif;'
  );

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
  panel.appendChild(rayCountLabel);
  panel.appendChild(uncertaintyLabel);
  panel.appendChild(buttonRow);

  container.appendChild(crosshair);
  container.appendChild(panel);

  // ── Tap handler (shoot ray) ──
  function handleTap(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('#measurement-panel')) {
      return;
    }

    const rect = arCanvas.getBoundingClientRect();

    // Normalize to [0, 1] in the canvas coordinate space
    const normX = (event.clientX - rect.left) / rect.width;
    const normY = (event.clientY - rect.top) / rect.height;

    handlers.handleShootRay(normX, normY);
  }

  arCanvas.addEventListener('pointerdown', handleTap);

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

  function updateUncertainty(draft: LiveMeasurementDraft): void {
    if (
      draft.uncertainty !== undefined &&
      draft.status !== 'idle' &&
      draft.status !== 'confirmed'
    ) {
      uncertaintyLabel.textContent = `± ${(draft.uncertainty * 100).toFixed(1)} cm`;
      uncertaintyLabel.style.display = 'block';
    } else {
      uncertaintyLabel.style.display = 'none';
    }
  }

  function updateUI(): void {
    const state = store.getState();
    const draft = selectMeasurementDraft(state);
    const rays = selectPendingRays(state);
    const hasProvisionalPoint =
      draft.provisionalPointAr !== undefined && rays.length >= 2;
    const hardQualityPass =
      draft.uncertainty !== undefined &&
      draft.uncertainty <= DEFAULT_QUALITY_THRESHOLDS.maxUncertaintyHard;

    // Skip redundant DOM updates
    if (draft === lastDraft && rays.length === lastRayCount) return;
    lastDraft = draft;
    lastRayCount = rays.length;

    // Coaching banner
    const text = COACHING_TEXT[draft.prompt];
    coachingBanner.textContent = text;
    coachingBanner.style.display = text ? 'block' : 'none';

    updateUncertainty(draft);

    // Confirm button state
    confirmBtn.disabled = !hasProvisionalPoint;
    confirmBtn.textContent = hardQualityPass ? '✓ Confirm' : '⚠ Save anyway';
    confirmBtn.style.opacity = hasProvisionalPoint ? '1' : '0.4';

    rayCountLabel.textContent = `${rays.length} observation ray${rays.length === 1 ? '' : 's'}`;
    undoBtn.disabled = rays.length === 0 || draft.status === 'confirm_pending';
    undoBtn.style.opacity = undoBtn.disabled ? '0.4' : '1';
    undoBtn.style.display = draft.status === 'idle' ? 'none' : 'inline-block';

    // A successful save ends the active draft; keep the recorder controls clear.
    panel.style.display =
      draft.status === 'idle' || draft.status === 'confirmed' ? 'none' : 'flex';
  }

  const unsubscribe = store.subscribe(updateUI);
  // Initial render
  updateUI();

  // ── Public API ──
  return {
    show() {
      crosshair.style.display = 'block';
      updateUI();
    },
    hide() {
      crosshair.style.display = 'none';
      panel.style.display = 'none';
    },
    dispose() {
      unsubscribe();
      arCanvas.removeEventListener('pointerdown', handleTap);
      crosshair.remove();
      panel.remove();
    },
  };
}
