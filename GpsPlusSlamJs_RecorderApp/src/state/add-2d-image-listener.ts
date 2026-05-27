/**
 * Listener middleware that mirrors every accepted
 * `gpsData/add2dImage` action into a matching
 * `framesInScene/addFrameInScene` action.
 *
 * Background — F3 from
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md):
 * captured camera frames need to render as textured 3D tiles at their
 * capture pose during both live recording and replay. Following the
 * F2 pattern, both flows converge on the same library action and the
 * recorder app subscribes via a listener middleware → dedicated slice
 * → visualizer.
 *
 * The slice stores raw WebXR pose verbatim. Coordinate-space
 * conversion (`webxrToNUE`) happens in the visualizer when the mesh
 * is materialized — same split of concerns as
 * `ref-point-mark-listener.ts`.
 */

import {
  createListenerMiddleware,
  isAnyOf,
  type Middleware,
} from '@reduxjs/toolkit';

import { add2dImage } from 'gps-plus-slam-app-framework/state';
import type { Add2dImagePayload } from 'gps-plus-slam-app-framework/state';

import { addFrameInScene } from './frames-in-scene-slice';

/**
 * Build the listener middleware. Factory rather than singleton so the
 * store factory can compose it alongside other middlewares without
 * sharing module-level state — same shape as
 * `createRefPointMarkListenerMiddleware`.
 */
export function createAdd2dImageListenerMiddleware(): Middleware {
  const listener = createListenerMiddleware();

  listener.startListening({
    matcher: isAnyOf(add2dImage),
    effect: (action, api) => {
      const payload = (action as { payload?: Add2dImagePayload }).payload;
      if (!isValidPayload(payload)) {
        return;
      }

      api.dispatch(
        addFrameInScene({
          imageFile: payload.imageFile,
          position: payload.position,
          rotation: payload.rotation,
          screenRotation: payload.screenRotation,
          capturedAt: payload.capturedAt,
        })
      );
    },
  });

  return listener.middleware;
}

function isValidPayload(
  payload: Add2dImagePayload | undefined
): payload is Add2dImagePayload {
  return (
    !!payload &&
    typeof payload.imageFile === 'string' &&
    Array.isArray(payload.position) &&
    payload.position.length === 3 &&
    Array.isArray(payload.rotation) &&
    payload.rotation.length === 4 &&
    typeof payload.screenRotation === 'number'
  );
}
