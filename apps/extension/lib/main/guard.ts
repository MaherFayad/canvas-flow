/**
 * Read-only guard for hidden discovery frames (frame id "discover~…").
 * Discovery must not change app data, so in these frames only:
 *   - fetch / XHR with a method other than GET, HEAD or OPTIONS fail as a network error,
 *   - navigator.sendBeacon does nothing,
 *   - forms never submit (submit event cancelled, form.submit / requestSubmit are no-ops),
 *   - window.open returns null, confirm() answers "cancel", prompt() answers null, alert() is silent.
 * Normal canvas frames and normal tabs are never touched.
 */
export const DISCOVER_PREFIX = 'discover~';

export const isDiscoveryFrame = (frame: string) => frame.startsWith(DISCOVER_PREFIX);

const SAFE_METHODS = /^(GET|HEAD|OPTIONS)$/i;
export const BLOCKED = 'Blocked by Flow Canvas discovery (read-only)';

type GuardWindow = Window & typeof globalThis;

export function installReadOnlyGuard(win: GuardWindow): void {
  const origFetch = win.fetch;
  if (origFetch) {
    win.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const isReq = typeof input === 'object' && input !== null && 'method' in input;
      const method = init?.method ?? (isReq ? (input as Request).method : 'GET');
      if (!SAFE_METHODS.test(method)) return Promise.reject(new TypeError(BLOCKED));
      return origFetch.call(win, input, init);
    } as typeof fetch;
  }

  const X = win.XMLHttpRequest?.prototype;
  if (X) {
    const methods = new WeakMap<XMLHttpRequest, string>();
    const open = X.open;
    const send = X.send;
    X.open = function (this: XMLHttpRequest, ...a: unknown[]) {
      methods.set(this, String(a[0] ?? 'GET'));
      return (open as (...x: unknown[]) => void).apply(this, a);
    } as typeof X.open;
    X.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (SAFE_METHODS.test(methods.get(this) ?? 'GET')) return send.call(this, body);
      setTimeout(() => {
        this.dispatchEvent(new ProgressEvent('error'));
        this.dispatchEvent(new ProgressEvent('loadend'));
      }, 0);
    };
  }

  try {
    if (win.navigator && 'sendBeacon' in win.navigator) Object.defineProperty(win.navigator, 'sendBeacon', { configurable: true, value: () => false });
  } catch {
    /* read-only navigator: nothing to do */
  }

  win.addEventListener(
    'submit',
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  const F = win.HTMLFormElement?.prototype;
  if (F) {
    F.submit = function () {};
    F.requestSubmit = function () {};
  }
  win.open = () => null;
  win.confirm = () => false;
  win.prompt = () => null;
  win.alert = () => {};
}
