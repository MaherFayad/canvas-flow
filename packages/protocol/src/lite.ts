/**
 * `@flowcanvas/protocol/lite`: the zod-free half of the wire protocol.
 *
 * Content scripts (bridge.js, mock.js) and the SDK import from here so zod never
 * lands in a page. Everything here is plain TypeScript: constants, in-page
 * channel helpers, URL / glob / token helpers, a type for every message, and a
 * small hand-written validator (`parseMessageLite`) that accepts exactly what the
 * zod `MessageSchema` in `.` accepts and returns the same value (unknown keys
 * stripped, defaults filled). `lite.test.ts` holds the two to each other.
 *
 * The `.` entry re-exports all of this, so nothing that imports `.` changes.
 */

export const PROTOCOL_VERSION = 1 as const;

/** URL params the canvas puts on every frame. */
export const PARAM_FRAME = 'fc-frame';
export const PARAM_STATE = 'fc-state';

export const BUILTIN_STATES = ['default', 'loading', 'empty', 'partial', 'error', 'success'] as const;
export type BuiltinState = (typeof BUILTIN_STATES)[number];

/* ------------------------------------------------------------------ */
/* Payload types (equal to the zod `z.infer` types in `.`; checked in  */
/* lite.test.ts).                                                      */
/* ------------------------------------------------------------------ */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MockRule {
  match: { method: string; url: string };
  status: number;
  body?: unknown;
  headers?: Record<string, string> | undefined;
  delay?: number | 'forever' | undefined;
}

export type TokenType = 'color' | 'length' | 'number' | 'font' | 'other';

export interface Token {
  name: string;
  value: string;
  type: TokenType;
}

export interface ScreenDecl {
  id: string;
  path: string;
  group?: string | undefined;
  title?: string | undefined;
  states?: string[] | undefined;
}

export interface ElementContext {
  selector: string;
  tag: string;
  text: string;
  rect: Rect;
  html: string;
  styles: Record<string, string>;
}

interface Base {
  v: 1;
  frame: string;
  nonce: string;
}

/** Every wire message, by `fc` type. */
export interface MessageMap {
  // frame → canvas
  hello: { v: 1; frame: string; nonce: null; hasSdk: boolean; url: string };
  screens: Base & { screens: ScreenDecl[] };
  ready: Base & { url: string };
  nav: Base & { from: string; to: string };
  click: Base & { target: string; text: string; rect: Rect };
  'query-result': Base & { id: string; found: boolean; rect: Rect | null };
  'tokens-read': Base & { tokens: Token[] };
  'capture-result': Base & { id: string; webp: string | null; error?: string | undefined };
  'element-result': Base & { id: string; element: ElementContext | null };
  hmr: Base;
  'links-result': Base & { id: string; links: string[] };
  // canvas → frame
  welcome: Base & { state: string; device?: { w: number; h: number } | undefined };
  query: Base & { id: string; selector: string };
  tokens: Base & { vars: Record<string, string> };
  'tokens-request': Base;
  capture: Base & { id: string; scale: number; quality: number };
  mocks: Base & { rules: MockRule[] };
  record: Base & { on: boolean };
  'element-at': Base & { id: string; x: number; y: number };
  links: Base & { id: string };
}

export type MessageType = keyof MessageMap;
type Flat<T> = { [K in keyof T]: T[K] };
export type MessageOf<T extends MessageType> = Flat<{ fc: T } & MessageMap[T]>;
export type Message = { [K in MessageType]: MessageOf<K> }[MessageType];

export const FRAME_TO_CANVAS: readonly MessageType[] = [
  'hello', 'screens', 'ready', 'nav', 'click', 'query-result', 'tokens-read', 'capture-result', 'element-result', 'hmr', 'links-result',
];
export const CANVAS_TO_FRAME: readonly MessageType[] = [
  'welcome', 'query', 'tokens', 'tokens-request', 'capture', 'mocks', 'record', 'element-at', 'links',
];

/** Hand-written validator (own module so bundles that never parse messages, like the SDK, drop it). */
export { parseMessageLite, isMessage } from './validate';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

export function makeNonce(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build a frame URL: origin + path + ?fc-frame=<id>&fc-state=<state>, keeping any existing query. */
export function frameUrl(origin: string, path: string, frameId: string, state: string): string {
  const u = new URL(path, origin);
  u.searchParams.set(PARAM_FRAME, frameId);
  u.searchParams.set(PARAM_STATE, state);
  return u.toString();
}

/** Read fc-frame / fc-state from a location search string. */
export function readFrameParams(search: string): { frame: string | null; state: string } {
  const p = new URLSearchParams(search);
  return { frame: p.get(PARAM_FRAME), state: p.get(PARAM_STATE) || 'default' };
}

/** Glob match for mock URLs: `*` = any run of chars. Matches against path+query or full URL. */
export function globMatch(pattern: string, url: string): boolean {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  if (re.test(url)) return true;
  try {
    const u = new URL(url, 'http://x');
    return re.test(u.pathname + u.search) || re.test(u.pathname);
  } catch {
    return false;
  }
}

export function findMock(rules: MockRule[], method: string, url: string): MockRule | undefined {
  const m = method.toUpperCase();
  return rules.find((r) => (r.match.method ?? 'GET').toUpperCase() === m && globMatch(r.match.url, url));
}

/** Guess a token type from its value. */
export function guessTokenType(value: string): TokenType {
  const v = value.trim();
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/i.test(v)) return 'color';
  if (/^-?\d*\.?\d+(px|rem|em|vh|vw|%)$/.test(v)) return 'length';
  if (/^-?\d*\.?\d+$/.test(v)) return 'number';
  if (/,/.test(v) && /(serif|sans|mono|system-ui|inter|helvetica|arial)/i.test(v)) return 'font';
  return 'other';
}

/** MCP WebSocket link: port range the server tries and the canvas scans. */
export const MCP_PORT_MIN = 47800;
export const MCP_PORT_MAX = 47809;

/* ------------------------------------------------------------------ */
/* In-page channels (same window, different JS worlds).                */
/* Transport: window.dispatchEvent(new CustomEvent(NAME, { detail })), */
/* where detail is a JSON *string* (objects do not cross worlds).      */
/* ------------------------------------------------------------------ */

/** App SDK (page world) → bridge (isolated world). */
export const SDK_EVENT = 'flowcanvas:sdk';
/** Bridge (isolated world) → app SDK (page world). */
export const BRIDGE_TO_SDK_EVENT = 'flowcanvas:bridge';
/** MAIN-world helper (mock layer, history patch) → bridge. */
export const MAIN_EVENT = 'flowcanvas:main';
/** Bridge → MAIN-world helper. */
export const BRIDGE_TO_MAIN_EVENT = 'flowcanvas:isolated';

export type SdkToBridge =
  | { type: 'hello' }
  | { type: 'screens'; screens: ScreenDecl[] }
  | { type: 'ready' };

export type BridgeToSdk =
  | { type: 'welcome'; state: string }
  | { type: 'tokens'; vars: Record<string, string> };

export type MainToBridge =
  | { type: 'nav'; from: string; to: string }
  | { type: 'main-ready' }
  | { type: 'hmr' };

export type BridgeToMain = { type: 'mocks'; rules: MockRule[] } | { type: 'mocks-none' };

export function emitInPage(name: string, payload: unknown, target: EventTarget = window): void {
  target.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(payload) }));
}

export function onInPage<T>(name: string, fn: (payload: T) => void, target: EventTarget = window): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent).detail;
    if (typeof d !== 'string') return;
    try {
      fn(JSON.parse(d) as T);
    } catch {
      /* ignore */
    }
  };
  target.addEventListener(name, h);
  return () => target.removeEventListener(name, h);
}

/** SDK gives up if the bridge has not answered `hello` within this many ms. */
export const SDK_HANDSHAKE_TIMEOUT_MS = 500;
/** Auto `ready` if the app never calls fc.ready(). */
export const AUTO_READY_MS = 1500;
/** MAIN-world mock layer holds fetch/XHR in a canvas frame until rules (or mocks-none) arrive, max this long. */
export const MOCK_RULES_WAIT_MS = 1000;
