/**
 * MAIN-world mock layer (feature 4, path B): wraps fetch and XMLHttpRequest.
 * Requests are held until the bridge hands over the rules (or says there are
 * none), at most `waitMs`. Unmatched requests pass through untouched.
 */
import { MOCK_RULES_WAIT_MS, findMock, type MockRule } from '@flowcanvas/protocol/lite';

export interface MockWindow {
  fetch: typeof fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
  Response: typeof Response;
  location: { href: string };
}

export interface MockLayer {
  /** null = "no mocks for this frame" (mocks-none). */
  setRules(rules: MockRule[] | null): void;
  /** Resolves once rules arrived or the wait timed out. */
  readonly settled: Promise<void>;
  uninstall(): void;
}

const NULL_BODY = new Set([101, 204, 205, 304]);

export function mockBody(rule: MockRule): { text: string | null; contentType: string | null } {
  if (rule.body === undefined || rule.body === null) return { text: null, contentType: null };
  if (typeof rule.body === 'string') return { text: rule.body, contentType: 'text/plain;charset=UTF-8' };
  return { text: JSON.stringify(rule.body), contentType: 'application/json' };
}

function mockHeaders(rule: MockRule): Record<string, string> {
  const h: Record<string, string> = { 'x-flowcanvas-mock': '1' };
  const { contentType } = mockBody(rule);
  if (contentType) h['content-type'] = contentType;
  for (const [k, v] of Object.entries(rule.headers ?? {})) h[k.toLowerCase()] = v;
  return h;
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error', 503: 'Service Unavailable' };

const never = <T>() => new Promise<T>(() => {});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function installMockLayer(win: MockWindow, waitMs = MOCK_RULES_WAIT_MS): MockLayer {
  let rules: MockRule[] = [];
  let done = false;
  let release!: () => void;
  const settled = new Promise<void>((r) => (release = r));
  const settle = () => {
    if (done) return;
    done = true;
    release();
  };
  const deadline = setTimeout(settle, waitMs);

  const abs = (url: string) => {
    try {
      return new URL(url, win.location.href).href;
    } catch {
      return url;
    }
  };
  const match = (method: string, url: string) => findMock(rules, method, abs(url));
  const wait = async (rule: MockRule, signal?: AbortSignal | null) => {
    if (rule.delay === 'forever') {
      if (signal) {
        await new Promise<void>((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))));
      }
      return never<void>();
    }
    if (rule.delay) await sleep(rule.delay);
  };

  /* ---------------- fetch ---------------- */
  const origFetch = win.fetch;
  const wrappedFetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!done) await settled;
    const isReq = typeof input === 'object' && input !== null && 'url' in input && !(input instanceof URL);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = init?.method ?? (isReq ? (input as Request).method : 'GET');
    const rule = match(method, url);
    if (!rule) return origFetch.call(win, input, init);
    await wait(rule, init?.signal ?? (isReq ? (input as Request).signal : null));
    const { text } = mockBody(rule);
    const status = rule.status;
    return new win.Response(NULL_BODY.has(status) ? null : text, {
      status: status < 200 ? 200 : status,
      statusText: STATUS_TEXT[status] ?? '',
      headers: mockHeaders(rule),
    });
  };
  win.fetch = wrappedFetch as typeof fetch;

  /* ---------------- XMLHttpRequest ---------------- */
  const P = win.XMLHttpRequest.prototype;
  const origOpen = P.open;
  const origSend = P.send;
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string; async: boolean }>();

  P.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    const [method, url, async] = args as [string, string | URL, boolean | undefined];
    meta.set(this, { method, url: String(url), async: async !== false });
    return (origOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof P.open;

  const fake = (xhr: XMLHttpRequest, rule: MockRule, url: string) => {
    const { text } = mockBody(rule);
    const headers = mockHeaders(rule);
    const body = text ?? '';
    const def = (k: string, v: unknown) => Object.defineProperty(xhr, k, { configurable: true, get: () => v });
    let response: unknown = body;
    if (xhr.responseType === 'json') {
      try {
        response = body ? JSON.parse(body) : null;
      } catch {
        response = null;
      }
    }
    def('readyState', 4);
    def('status', rule.status);
    def('statusText', STATUS_TEXT[rule.status] ?? '');
    def('responseURL', abs(url));
    def('responseText', body);
    def('response', response);
    def('getResponseHeader', (n: string) => headers[n.toLowerCase()] ?? null);
    def('getAllResponseHeaders', () => Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n'));
    for (const t of ['readystatechange', 'load', 'loadend']) xhr.dispatchEvent(new Event(t));
  };

  P.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const m = meta.get(this);
    if (!m || !m.async) return origSend.call(this, body);
    const go = () => {
      const rule = match(m.method, m.url);
      if (!rule) return origSend.call(this, body);
      if (rule.delay === 'forever') return; // never settles
      if (rule.delay) setTimeout(() => fake(this, rule, m.url), rule.delay);
      else queueMicrotask(() => fake(this, rule, m.url));
    };
    if (done) go();
    else void settled.then(go);
  };

  return {
    settled,
    setRules(r) {
      rules = r ?? [];
      clearTimeout(deadline);
      settle();
    },
    uninstall() {
      clearTimeout(deadline);
      settle();
      win.fetch = origFetch;
      P.open = origOpen;
      P.send = origSend;
    },
  };
}
