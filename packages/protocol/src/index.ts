/**
 * Flow Canvas wire protocol.
 * Every message: { fc: <type>, v: 1, nonce, frame, ...payload }.
 * `hello` is the only message sent before a nonce exists (nonce: null).
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

/** URL params the canvas puts on every frame. */
export const PARAM_FRAME = 'fc-frame';
export const PARAM_STATE = 'fc-state';

export const BUILTIN_STATES = ['default', 'loading', 'empty', 'partial', 'error', 'success'] as const;
export type BuiltinState = (typeof BUILTIN_STATES)[number];

const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Rect = z.infer<typeof Rect>;
export { Rect as RectSchema };

const base = {
  v: z.literal(PROTOCOL_VERSION),
  frame: z.string().min(1),
};
const withNonce = { ...base, nonce: z.string().min(8) };

export const MockRuleSchema = z.object({
  match: z.object({
    method: z.string().default('GET'),
    url: z.string(), // glob: * matches any run of chars
  }),
  status: z.number().int().min(100).max(599).default(200),
  body: z.unknown().optional(),
  headers: z.record(z.string()).optional(),
  delay: z.union([z.number().nonnegative(), z.literal('forever')]).optional(),
});
export type MockRule = z.infer<typeof MockRuleSchema>;

export const TokenSchema = z.object({
  name: z.string().startsWith('--'),
  value: z.string(),
  type: z.enum(['color', 'length', 'number', 'font', 'other']),
});
export type Token = z.infer<typeof TokenSchema>;

export const ScreenDeclSchema = z.object({
  id: z.string(),
  path: z.string(),
  group: z.string().optional(),
  title: z.string().optional(),
  states: z.array(z.string()).optional(),
});
export type ScreenDecl = z.infer<typeof ScreenDeclSchema>;

export const ElementContextSchema = z.object({
  selector: z.string(),
  tag: z.string(),
  text: z.string(),
  rect: Rect,
  html: z.string().max(2048),
  styles: z.record(z.string()),
});
export type ElementContext = z.infer<typeof ElementContextSchema>;

export const MessageSchema = z.discriminatedUnion('fc', [
  // frame → canvas
  z.object({ fc: z.literal('hello'), ...base, nonce: z.null(), hasSdk: z.boolean(), url: z.string() }),
  z.object({ fc: z.literal('screens'), ...withNonce, screens: z.array(ScreenDeclSchema) }),
  z.object({ fc: z.literal('ready'), ...withNonce, url: z.string() }),
  z.object({ fc: z.literal('nav'), ...withNonce, from: z.string(), to: z.string() }),
  z.object({
    fc: z.literal('click'),
    ...withNonce,
    target: z.string(),
    text: z.string(),
    rect: Rect,
  }),
  z.object({ fc: z.literal('query-result'), ...withNonce, id: z.string(), found: z.boolean(), rect: Rect.nullable() }),
  z.object({ fc: z.literal('tokens-read'), ...withNonce, tokens: z.array(TokenSchema) }),
  z.object({ fc: z.literal('capture-result'), ...withNonce, id: z.string(), webp: z.string().nullable(), error: z.string().optional() }),
  z.object({ fc: z.literal('element-result'), ...withNonce, id: z.string(), element: ElementContextSchema.nullable() }),
  z.object({ fc: z.literal('hmr'), ...withNonce }),

  // canvas → frame
  z.object({
    fc: z.literal('welcome'),
    ...withNonce,
    state: z.string(),
    device: z.object({ w: z.number(), h: z.number() }).optional(),
  }),
  z.object({ fc: z.literal('query'), ...withNonce, id: z.string(), selector: z.string() }),
  z.object({ fc: z.literal('tokens'), ...withNonce, vars: z.record(z.string()) }),
  z.object({ fc: z.literal('tokens-request'), ...withNonce }),
  z.object({ fc: z.literal('capture'), ...withNonce, id: z.string(), scale: z.number().positive(), quality: z.number().min(0).max(1) }),
  z.object({ fc: z.literal('mocks'), ...withNonce, rules: z.array(MockRuleSchema) }),
  z.object({ fc: z.literal('record'), ...withNonce, on: z.boolean() }),
  z.object({ fc: z.literal('element-at'), ...withNonce, id: z.string(), x: z.number(), y: z.number() }),
]);

export type Message = z.infer<typeof MessageSchema>;
export type MessageType = Message['fc'];
export type MessageOf<T extends MessageType> = Extract<Message, { fc: T }>;

export const FRAME_TO_CANVAS: readonly MessageType[] = [
  'hello', 'screens', 'ready', 'nav', 'click', 'query-result', 'tokens-read', 'capture-result', 'element-result', 'hmr',
];
export const CANVAS_TO_FRAME: readonly MessageType[] = [
  'welcome', 'query', 'tokens', 'tokens-request', 'capture', 'mocks', 'record', 'element-at',
];

/** Parse an unknown postMessage payload. Returns null for anything that is not a valid Flow Canvas message. */
export function parseMessage(data: unknown): Message | null {
  if (!data || typeof data !== 'object' || !('fc' in data)) return null;
  const r = MessageSchema.safeParse(data);
  return r.success ? r.data : null;
}

/**
 * Canvas-side acceptance check: origin must equal the project origin and,
 * for everything except hello, the nonce must match the frame's session nonce.
 */
export function acceptFromFrame(
  ev: { origin: string; data: unknown },
  projectOrigin: string,
  nonceFor: (frame: string) => string | undefined,
): Message | null {
  if (ev.origin !== projectOrigin) return null;
  const msg = parseMessage(ev.data);
  if (!msg || !FRAME_TO_CANVAS.includes(msg.fc)) return null;
  if (msg.fc === 'hello') return msg;
  const expected = nonceFor(msg.frame);
  return expected && msg.nonce === expected ? msg : null;
}

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
export function guessTokenType(value: string): Token['type'] {
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
