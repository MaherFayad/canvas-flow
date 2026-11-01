/**
 * Zod-free message validator for `@flowcanvas/protocol/lite`.
 * Accepts exactly what the zod `MessageSchema` accepts and returns the same
 * value; `lite.test.ts` checks the two against each other.
 */
import type { Message, MessageType } from './lite';

/** PROTOCOL_VERSION, typed from Message so a version bump fails typecheck here (no runtime import: lite re-exports this module). */
const PROTOCOL_VERSION: Message['v'] = 1;

/* ------------------------------------------------------------------ */
/* Hand-written validator. Mirrors zod v3 object semantics: input must  */
/* be a plain object, unknown keys are dropped, a key that is present   */
/* is kept even when undefined, defaults fill missing values.           */
/* ------------------------------------------------------------------ */

/** A check returns the parsed value, or NO. */
type Check = (x: unknown) => unknown;
const NO: unknown = Object.freeze({});

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x) && !(x instanceof Date) && !(x instanceof Map) && !(x instanceof Set);

const str =
  (min = 0, max = Infinity, prefix = ''): Check =>
  (x) =>
    typeof x === 'string' && x.length >= min && x.length <= max && x.startsWith(prefix) ? x : NO;
const num =
  (ok: (n: number) => boolean = () => true): Check =>
  (x) =>
    typeof x === 'number' && !Number.isNaN(x) && ok(x) ? x : NO;
const bool: Check = (x) => (typeof x === 'boolean' ? x : NO);
const lit =
  (v: unknown): Check =>
  (x) =>
    x === v ? x : NO;
const opt =
  (c: Check): Check =>
  (x) =>
    x === undefined ? x : c(x);
const def =
  (c: Check, d: unknown): Check =>
  (x) =>
    x === undefined ? d : c(x);
const nul =
  (c: Check): Check =>
  (x) =>
    x === null ? x : c(x);
const any: Check = (x) => x;
const oneOf =
  (...cs: Check[]): Check =>
  (x) => {
    for (const c of cs) {
      const r = c(x);
      if (r !== NO) return r;
    }
    return NO;
  };
const arr =
  (c: Check): Check =>
  (x) => {
    if (!Array.isArray(x)) return NO;
    const out: unknown[] = [];
    for (const i of x) {
      const r = c(i);
      if (r === NO) return NO;
      out.push(r);
    }
    return out;
  };
const rec =
  (c: Check): Check =>
  (x) => {
    if (!isObj(x)) return NO;
    const out: Record<string, unknown> = {};
    for (const k in x) {
      const r = c(x[k]);
      if (r === NO) return NO;
      out[k] = r;
    }
    return out;
  };
const obj =
  (shape: Record<string, Check>): Check =>
  (x) => {
    if (!isObj(x)) return NO;
    const out: Record<string, unknown> = {};
    for (const k in shape) {
      const r = shape[k]!(x[k]);
      if (r === NO) return NO;
      if (r !== undefined || k in x) out[k] = r;
    }
    return out;
  };

const S = str();
const N = num();
const rect = obj({ x: N, y: N, w: N, h: N });
const mockRule = obj({
  match: obj({ method: def(S, 'GET'), url: S }),
  status: def(num((n) => Number.isInteger(n) && n >= 100 && n <= 599), 200),
  body: any,
  headers: opt(rec(S)),
  delay: opt(oneOf(num((n) => n >= 0), lit('forever'))),
});
const token = obj({ name: str(0, Infinity, '--'), value: S, type: oneOf(...['color', 'length', 'number', 'font', 'other'].map(lit)) });
const screenDecl = obj({ id: S, path: S, group: opt(S), title: opt(S), states: opt(arr(S)) });
const elementCtx = obj({ selector: S, tag: S, text: S, rect, html: str(0, 2048), styles: rec(S) });

const base = { v: lit(PROTOCOL_VERSION), frame: str(1) };
const withNonce = { ...base, nonce: str(8) };

const SHAPES: Record<MessageType, Record<string, Check>> = {
  hello: { ...base, nonce: lit(null), hasSdk: bool, url: S },
  screens: { ...withNonce, screens: arr(screenDecl) },
  ready: { ...withNonce, url: S },
  nav: { ...withNonce, from: S, to: S },
  click: { ...withNonce, target: S, text: S, rect },
  'query-result': { ...withNonce, id: S, found: bool, rect: nul(rect) },
  'tokens-read': { ...withNonce, tokens: arr(token) },
  'capture-result': { ...withNonce, id: S, webp: nul(S), error: opt(S) },
  'element-result': { ...withNonce, id: S, element: nul(elementCtx) },
  hmr: withNonce,
  'links-result': { ...withNonce, id: S, links: arr(S) },
  welcome: { ...withNonce, state: S, device: opt(obj({ w: N, h: N })) },
  query: { ...withNonce, id: S, selector: S },
  tokens: { ...withNonce, vars: rec(S) },
  'tokens-request': withNonce,
  capture: { ...withNonce, id: S, scale: num((n) => n > 0), quality: num((n) => n >= 0 && n <= 1) },
  mocks: { ...withNonce, rules: arr(mockRule) },
  record: { ...withNonce, on: bool },
  'element-at': { ...withNonce, id: S, x: N, y: N },
  links: { ...withNonce, id: S },
};

/**
 * Validate an unknown postMessage payload without zod. Returns the message
 * (unknown keys dropped, defaults filled) or null. Same result as `parseMessage`
 * from `@flowcanvas/protocol`.
 */
export function parseMessageLite(data: unknown): Message | null {
  if (!data || typeof data !== 'object' || !('fc' in data)) return null;
  const t = (data as { fc: unknown }).fc;
  if (typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(SHAPES, t)) return null;
  const r = obj({ fc: lit(t), ...SHAPES[t as MessageType] })(data);
  return r === NO ? null : (r as Message);
}

/** True when `data` is a valid Flow Canvas message. */
export const isMessage = (data: unknown): data is Message => parseMessageLite(data) !== null;

