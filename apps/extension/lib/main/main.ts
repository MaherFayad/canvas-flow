/**
 * MAIN-world helper: history patch (nav), HMR watch, fetch/XHR mock layer and,
 * in hidden discovery frames only, the read-only guard. Discovery probes are
 * answered by discover.js (lib/main/discover.ts), injected on demand.
 * Passive unless the page is a canvas frame (fc-frame in URL and window !== top).
 */
import {
  BRIDGE_TO_MAIN_EVENT,
  MAIN_EVENT,
  emitInPage,
  onInPage,
  type BridgeToMain,
  type MainToBridge,
} from '@flowcanvas/protocol/lite';
import { frameIdentity } from '../frame';
import { installMockLayer, type MockLayer } from './mock';
import { installReadOnlyGuard, isDiscoveryFrame } from './guard';

export function patchHistory(win: Window, onNav: (from: string, to: string) => void): () => void {
  let last = win.location.href;
  const check = () => {
    const now = win.location.href;
    if (now === last) return;
    const from = last;
    last = now;
    onNav(from, now);
  };
  const h = win.history;
  const origPush = h.pushState;
  const origReplace = h.replaceState;
  h.pushState = function (this: History, ...a: Parameters<History['pushState']>) {
    const r = origPush.apply(this, a);
    check();
    return r;
  };
  h.replaceState = function (this: History, ...a: Parameters<History['replaceState']>) {
    const r = origReplace.apply(this, a);
    check();
    return r;
  };
  win.addEventListener('popstate', check);
  win.addEventListener('hashchange', check);
  return () => {
    h.pushState = origPush;
    h.replaceState = origReplace;
    win.removeEventListener('popstate', check);
    win.removeEventListener('hashchange', check);
  };
}

/** Is this a dev-server HMR message (Vite, webpack-dev-server, Next.js)? Initial "connected"/"ok" pings are ignored. */
export function hmrClassifier(): (data: unknown) => boolean {
  let invalidated = false;
  return (data) => {
    if (typeof data !== 'string' || data.length > 100_000) return false;
    let d: { type?: string; action?: string };
    try {
      d = JSON.parse(data);
    } catch {
      return false;
    }
    if (d.type === 'update' || d.type === 'full-reload') return true; // Vite
    if (d.type === 'invalid') invalidated = true; // webpack: rebuild started
    if ((d.type === 'ok' || d.type === 'still-ok') && invalidated) {
      invalidated = false;
      return true;
    }
    if (d.action === 'built' || d.action === 'serverComponentChanges') return true; // Next.js
    return false;
  };
}

/** Wrap WebSocket so dev-server HMR messages are noticed (best effort). */
export function watchHmr(win: Window & { WebSocket: typeof WebSocket }, onHmr: () => void): void {
  const Orig = win.WebSocket;
  if (!Orig) return;
  let lastAt = 0;
  win.WebSocket = new Proxy(Orig, {
    construct(target, args: [string | URL, (string | string[])?]) {
      const ws = Reflect.construct(target, args) as WebSocket;
      const isHmr = hmrClassifier();
      ws.addEventListener('message', (ev) => {
        if (!isHmr(ev.data)) return;
        const now = Date.now();
        if (now - lastAt < 300) return;
        lastAt = now;
        onHmr();
      });
      return ws;
    },
  });
}

export function startMain(win: Window): MockLayer | null {
  const id = frameIdentity(win);
  if (!id) return null;
  // Before the mock layer, so mocked answers still win and everything else is checked.
  if (isDiscoveryFrame(id.frame)) installReadOnlyGuard(win as Window & typeof globalThis);
  const toBridge = (m: MainToBridge) => emitInPage(MAIN_EVENT, m, win);
  const layer = installMockLayer(win as unknown as Parameters<typeof installMockLayer>[0]);
  onInPage<BridgeToMain>(
    BRIDGE_TO_MAIN_EVENT,
    (m) => {
      if (m.type === 'mocks') layer.setRules(m.rules);
      else if (m.type === 'mocks-none') layer.setRules(null);
    },
    win,
  );
  patchHistory(win, (from, to) => toBridge({ type: 'nav', from, to }));
  watchHmr(win as Window & { WebSocket: typeof WebSocket }, () => toBridge({ type: 'hmr' }));
  toBridge({ type: 'main-ready' });
  return layer;
}
