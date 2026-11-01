/**
 * Canvas link protocol: JSON messages over the local WebSocket between the
 * MCP server (Node) and the Flow Canvas tab (extension page).
 *
 * Every message is a JSON object with a `type` field. The canvas connects to
 * ws://127.0.0.1:<MCP_PORT_MIN..MCP_PORT_MAX>; the server accepts only an
 * `Origin: chrome-extension://<id>` upgrade, one canvas at a time.
 *
 * Handshake:
 *   server → canvas  hello   { v, project, origin, name, serverVersion }
 *   canvas → server  hello   { v, extensionVersion }
 *   canvas → server  allow   { granted }        (after the first-connect prompt; saved per project by the canvas)
 *   canvas → server  pause   { paused }         (current Pause Claude switch, send on connect and on change)
 *   server → canvas  config  { config }         (full sync, sent once granted)
 *
 * Steady state:
 *   server → canvas  patch    { label, config } a Claude change = one undo step labelled "Claude: …"
 *   server → canvas  config   { config }        the file changed outside (e.g. Claude Code edited the JSON)
 *   server → canvas  request  { id, method, params }  canvas-only tools + confirm prompts
 *   canvas → server  response { id, ok, result? , error? }
 *   canvas → server  config   { config }        canvas edits; the server validates and writes the file (debounced 500 ms)
 *   server → canvas  activity { tool, ok, summary, at }  one row per tool call for the Activity panel
 *   server → canvas  error    { message, errors? }      e.g. a canvas config that failed validation
 */
import { z } from 'zod';
import { TokenSchema, RectSchema } from '@flowcanvas/protocol';
import type { FlowCanvasConfig } from '@flowcanvas/config';

export const LINK_PROTOCOL_VERSION = 1 as const;

/** Debounce applied to canvas → server `config` messages before writing the file. */
export const CANVAS_WRITE_DEBOUNCE_MS = 500;

export const CANVAS_METHODS = [
  'get_tokens',
  'set_tokens',
  'get_screenshot',
  'check_target',
  'play_flow',
  'focus',
  'get_selection',
  'confirm',
] as const;
export type CanvasMethod = (typeof CANVAS_METHODS)[number];

/* ---------------------------- request params --------------------------- */

export const CanvasParamsSchemas = {
  /** Read base token values from the app (`:root` CSS variables) plus current overrides. */
  get_tokens: z.object({}),
  /** Live-apply token overrides (null = remove). The file write follows as a `patch`. */
  set_tokens: z.object({ vars: z.record(z.string().nullable()) }),
  /** Capture a frame. `device` is a device id from config.devices; canvas default when omitted. */
  get_screenshot: z.object({ screenId: z.string(), state: z.string(), device: z.string().optional() }),
  /** querySelector(selector) inside the frame for screen+state. */
  check_target: z.object({ screenId: z.string(), state: z.string(), selector: z.string(), device: z.string().optional() }),
  /** Play a section's flow or a list of edges in the Player; report which steps failed. */
  play_flow: z.object({ sectionId: z.string().optional(), edgeIds: z.array(z.string()).optional() }),
  /** Move the camera to an item (screen, frame "<screen>:<state>", edge, section, image, note, comment). */
  focus: z.object({ itemId: z.string() }),
  /** What the user has selected right now. */
  get_selection: z.object({}),
  /** Show an Allow / Deny toast. */
  confirm: z.object({
    action: z.enum(['delete', 'set_tokens']),
    message: z.string(),
    ids: z.array(z.string()).optional(),
    count: z.number().int().optional(),
  }),
} satisfies Record<CanvasMethod, z.ZodTypeAny>;

/* ---------------------------- request results --------------------------- */

export const CanvasResultSchemas = {
  get_tokens: z.object({ base: z.array(TokenSchema), overrides: z.record(z.string()).default({}) }),
  set_tokens: z.object({
    applied: z.array(z.string()).default([]),
    /** Names not found among the app's base tokens (still saved as overrides). */
    unknown: z.array(z.string()).default([]),
  }),
  get_screenshot: z.object({
    /** WebP image: a data URL (data:image/webp;base64,…) or bare base64. */
    webp: z.string(),
    device: z.string().optional(),
  }),
  check_target: z.object({ found: z.boolean(), rect: RectSchema.nullable().default(null), count: z.number().int().optional() }),
  play_flow: z.object({
    pass: z.boolean(),
    steps: z
      .array(z.object({ edgeId: z.string(), ok: z.boolean(), error: z.string().optional() }))
      .default([]),
  }),
  focus: z.object({ ok: z.boolean().default(true) }),
  get_selection: z.object({
    ids: z.array(z.string()),
    items: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()).optional(),
  }),
  confirm: z.object({ allowed: z.boolean() }),
} satisfies Record<CanvasMethod, z.ZodTypeAny>;

export type CanvasParams<M extends CanvasMethod> = z.infer<(typeof CanvasParamsSchemas)[M]>;
export type CanvasResult<M extends CanvasMethod> = z.output<(typeof CanvasResultSchemas)[M]>;

/* ------------------------------- messages ------------------------------- */

/** `config` payloads are validated with parseConfig from @flowcanvas/config, not here. */
const AnyConfig = z.custom<FlowCanvasConfig>((v) => !!v && typeof v === 'object');

export const ServerToCanvasSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    v: z.literal(LINK_PROTOCOL_VERSION),
    /** Absolute path of the project folder. */
    project: z.string(),
    /** project.origin from the config, e.g. http://localhost:5173. The canvas closes the socket if it is not its origin. */
    origin: z.string(),
    /** project.name from the config. */
    name: z.string(),
    serverVersion: z.string(),
  }),
  z.object({ type: z.literal('config'), config: AnyConfig }),
  z.object({ type: z.literal('patch'), label: z.string(), config: AnyConfig }),
  z.object({
    type: z.literal('request'),
    id: z.string(),
    method: z.enum(CANVAS_METHODS),
    params: z.record(z.unknown()),
  }),
  z.object({ type: z.literal('activity'), tool: z.string(), ok: z.boolean(), summary: z.string(), at: z.string() }),
  z.object({ type: z.literal('error'), message: z.string(), errors: z.array(z.string()).optional() }),
]);
export type ServerToCanvas = z.infer<typeof ServerToCanvasSchema>;

export const CanvasToServerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), v: z.literal(LINK_PROTOCOL_VERSION).optional(), extensionVersion: z.string() }),
  z.object({ type: z.literal('allow'), granted: z.boolean() }),
  z.object({ type: z.literal('config'), config: z.unknown() }),
  z.object({ type: z.literal('pause'), paused: z.boolean() }),
  z.object({
    type: z.literal('response'),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  /** Optional, ignored by the server today. */
  z.object({ type: z.literal('activity') }).passthrough(),
]);
export type CanvasToServer = z.infer<typeof CanvasToServerSchema>;

export type ServerMessageOf<T extends ServerToCanvas['type']> = Extract<ServerToCanvas, { type: T }>;
export type CanvasMessageOf<T extends CanvasToServer['type']> = Extract<CanvasToServer, { type: T }>;

/** Parse a raw WebSocket payload from the canvas. Returns null when it is not a valid message. */
export function parseCanvasMessage(data: unknown): CanvasToServer | null {
  let v: unknown = data;
  if (typeof data === 'string') {
    try {
      v = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const r = CanvasToServerSchema.safeParse(v);
  return r.success ? r.data : null;
}

/** Parse a raw WebSocket payload from the server (for the canvas side). */
export function parseServerMessage(data: unknown): ServerToCanvas | null {
  let v: unknown = data;
  if (typeof data === 'string') {
    try {
      v = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const r = ServerToCanvasSchema.safeParse(v);
  return r.success ? r.data : null;
}

/** Origin the server expects from the canvas. */
export function extensionOrigin(extensionId: string): string {
  return `chrome-extension://${extensionId}`;
}
