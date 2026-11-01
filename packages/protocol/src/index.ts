/**
 * Flow Canvas wire protocol.
 * Every message: { fc: <type>, v: 1, nonce, frame, ...payload }.
 * `hello` is the only message sent before a nonce exists (nonce: null).
 *
 * This entry holds the zod schemas (canvas, MCP, tests) and re-exports the
 * zod-free `./lite` entry (constants, helpers, in-page channels). Content
 * scripts and the SDK import `@flowcanvas/protocol/lite` instead, so zod stays
 * out of pages.
 */
import { z } from 'zod';
import { FRAME_TO_CANVAS, PROTOCOL_VERSION } from './lite';

export * from './lite';

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
  z.object({ fc: z.literal('links-result'), ...withNonce, id: z.string(), links: z.array(z.string()) }),

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
  /**
   * Record mode on/off. `intercept` (Player stage): clicks on elements matching
   * one of these selectors are reported as `click` with `target` = the matched
   * selector and their default action is cancelled, so the canvas can play the
   * edge's transition instead of the app navigating inside the frame.
   */
  z.object({ fc: z.literal('record'), ...withNonce, on: z.boolean(), intercept: z.array(z.string()).max(50).optional() }),
  z.object({ fc: z.literal('element-at'), ...withNonce, id: z.string(), x: z.number(), y: z.number() }),
  /** Discovery crawl: list same-origin <a href> paths on the page. */
  z.object({ fc: z.literal('links'), ...withNonce, id: z.string() }),
]);

export type Message = z.infer<typeof MessageSchema>;
export type MessageType = Message['fc'];
export type MessageOf<T extends MessageType> = Extract<Message, { fc: T }>;

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
