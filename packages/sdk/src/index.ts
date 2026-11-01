/**
 * @flowcanvas/sdk core.
 *
 * Lives in the page world and talks only to the Flow Canvas bridge content script
 * through in-page CustomEvents. It does nothing unless the page is inside a canvas
 * frame (`?fc-frame=` in the URL and a parent window), and nothing at all when
 * NODE_ENV is "production". No window access at import time (SSR-safe).
 */
import {
  AUTO_READY_MS,
  BRIDGE_TO_SDK_EVENT,
  PARAM_FRAME,
  PARAM_STATE,
  SDK_EVENT,
  SDK_HANDSHAKE_TIMEOUT_MS,
  emitInPage,
  onInPage,
  type BridgeToSdk,
  type SdkToBridge,
} from '@flowcanvas/protocol/lite';

/**
 * A screen the app declares to the canvas. Structurally identical to protocol
 * `ScreenDecl` (checked in `protocol.test.ts`); written out so the published
 * .d.ts does not reference the private protocol package.
 */
export interface FcScreen {
  id: string;
  path: string;
  group?: string | undefined;
  title?: string | undefined;
  states?: string[] | undefined;
}

export interface FcInitOptions {
  /** Screens of the app, sent to the canvas for discovery. */
  screens?: FcScreen[];
}

export type FcTokens = Record<string, string>;

export interface FcEvents {
  /** Token overrides from the canvas (for apps that keep tokens in JS). */
  tokens: (vars: FcTokens) => void;
  /** The value of `fc.state()` may have changed (welcome arrived, or the handshake gave up). */
  state: (state: string) => void;
}

export interface Fc {
  init(opts?: FcInitOptions): void;
  /** True only inside a canvas frame whose bridge answered the handshake. */
  readonly active: boolean;
  /** Current forced state, or 'default'. */
  state(): string;
  is(name: string): boolean;
  /** Tell the canvas the screen has settled. Sent once; auto-sent after 1.5 s. */
  ready(): void;
  target(id: string): { 'data-fc': string };
  on<K extends keyof FcEvents>(event: K, fn: FcEvents[K]): () => void;
}

/**
 * True when bundled for production. Bundlers replace `process.env.NODE_ENV` with a
 * string literal; where nothing replaces it and `process` does not exist (plain
 * browser ESM) the access throws and we fall back to false. A `typeof process`
 * guard is not used because bundlers such as Vite replace `process.env.NODE_ENV`
 * but leave `typeof process` to run in the browser, where it is "undefined",
 * which would keep the SDK on in production builds.
 * Bundlers that honour the `production` export condition get `prod.ts` instead,
 * a constant no-op, so the whole SDK is dead code there.
 */
const PROD: boolean = (() => {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
})();

type Phase = 0 | 1 | 2 | 3; // 0 idle, 1 waiting for welcome, 2 active, 3 gave up

let phase: Phase = 0;
let forced = 'default';
let readyWanted = false;
let readySent = false;
const tokenFns = new Set<FcEvents['tokens']>();
const stateFns = new Set<FcEvents['state']>();

function params(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  try {
    if (window === window.top) return null;
    const p = new URLSearchParams(window.location.search);
    return p.has(PARAM_FRAME) ? p : null;
  } catch {
    return null;
  }
}

const send = (m: SdkToBridge) => emitInPage(SDK_EVENT, m);

function notify() {
  const s = state();
  stateFns.forEach((fn) => fn(s));
}

function flushReady() {
  if (phase === 2 && readyWanted && !readySent) {
    readySent = true;
    send({ type: 'ready' });
  }
}

function init(opts: FcInitOptions = {}): void {
  if (PROD || phase || !params()) return;
  phase = 1;
  const screens = (opts.screens || []).map(({ id, path, group, title, states }) => ({ id, path, group, title, states }));
  const hello = () => {
    if (phase !== 1) return;
    send({ type: 'hello' });
    send({ type: 'screens', screens });
  };
  const off = onInPage<BridgeToSdk>(BRIDGE_TO_SDK_EVENT, (m) => {
    if (m.type === 'welcome') {
      if (phase === 3) return;
      phase = 2;
      forced = String(m.state || 'default');
      notify();
      flushReady();
    } else if (m.type === 'tokens' && phase === 2) {
      tokenFns.forEach((fn) => fn(m.vars));
    }
  });
  hello();
  // The bridge buffers, but retry in case it attached a moment after us.
  setTimeout(hello, 150);
  setTimeout(hello, 300);
  setTimeout(() => {
    if (phase !== 1) return;
    phase = 3;
    off();
    notify();
  }, SDK_HANDSHAKE_TIMEOUT_MS);
  setTimeout(ready, AUTO_READY_MS);
}

/**
 * Welcomed: the canvas's state. Waiting for the welcome: the `fc-state` URL
 * param, so the first render is already right. Never initialised, gave up,
 * production or outside a canvas: 'default'.
 */
function state(): string {
  if (phase === 2) return forced;
  if (phase !== 1) return 'default';
  return params()?.get(PARAM_STATE) || 'default';
}

function ready(): void {
  if (PROD) return;
  readyWanted = true;
  flushReady();
}

function on<K extends keyof FcEvents>(event: K, fn: FcEvents[K]): () => void {
  if (PROD) return () => {};
  const set = (event === 'tokens' ? tokenFns : stateFns) as Set<FcEvents[K]>;
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

export const fc: Fc = {
  init,
  get active() {
    return phase === 2;
  },
  state,
  is: (name) => state() === name,
  ready,
  target: (id) => ({ 'data-fc': id }),
  on,
};

