/**
 * The few runtime values the SDK needs from `@flowcanvas/protocol`.
 *
 * They are copied here on purpose: the protocol entry point builds zod schemas at
 * module load, so importing a constant from it would pull zod into this < 2 KB
 * bundle. `wire.test.ts` asserts every value below equals the protocol export,
 * so the two can never drift. Types come straight from protocol (type-only).
 */

/**
 * A screen the app declares to the canvas. Structurally identical to protocol
 * `ScreenDecl` (checked in `wire.test.ts`); written out so the published .d.ts
 * does not reference zod.
 */
export interface FcScreen {
  id: string;
  path: string;
  group?: string | undefined;
  title?: string | undefined;
  states?: string[] | undefined;
}

export const PARAM_FRAME = 'fc-frame';
export const PARAM_STATE = 'fc-state';
export const SDK_EVENT = 'flowcanvas:sdk';
export const BRIDGE_TO_SDK_EVENT = 'flowcanvas:bridge';
export const SDK_HANDSHAKE_TIMEOUT_MS = 500;
export const AUTO_READY_MS = 1500;

/** Same transport as protocol `emitInPage`: CustomEvent with a JSON string detail. */
export function emitInPage(name: string, payload: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(payload) }));
}

/** Same transport as protocol `onInPage`. Returns an unsubscribe function. */
export function onInPage<T>(name: string, fn: (payload: T) => void): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent).detail;
    if (typeof d !== 'string') return;
    try {
      fn(JSON.parse(d) as T);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener(name, h);
  return () => window.removeEventListener(name, h);
}
