/** @flowcanvas/sdk/msw: pick MSW handlers by the forced state, for apps already on MSW. */
import type { RequestHandler } from 'msw';
import { fc } from './index';

/**
 * Returns the handlers for the current state, falling back to `default`.
 *
 * ```ts
 * const worker = setupWorker(...fcHandlers({ default: handlers, empty: emptyHandlers, error: errorHandlers }));
 * ```
 * Call it after `fc.init()`; the state comes from the URL until the canvas answers.
 */
export function fcHandlers<H = RequestHandler>(map: Record<string, H[]>): H[] {
  return map[fc.state()] ?? map.default ?? [];
}

export { fc };
