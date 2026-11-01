/**
 * flowcanvas.config.json schema (v1) + migrations.
 * Single source of truth shared by the extension, the MCP server and tests.
 */
import { z } from 'zod';
import { ElementContextSchema, MockRuleSchema, RectSchema } from '@flowcanvas/protocol';

export const CONFIG_FILE = 'flowcanvas.config.json';
export const ASSETS_DIR = '.flowcanvas/assets';
export const SCHEMA_URL = 'https://flowcanvas.dev/schema/v1.json';

const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case id');
const Point = z.object({ x: z.number(), y: z.number() });

export const DeviceSchema = z.object({
  id: z.string(),
  label: z.string(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  dpr: z.number().positive().default(2),
  chrome: z.enum(['ios', 'android', 'none']).default('none'),
});
export type Device = z.infer<typeof DeviceSchema>;

export const DEVICE_PRESETS: Device[] = [
  { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', w: 440, h: 956, dpr: 3, chrome: 'ios' },
  { id: 'iphone-16', label: 'iPhone 16', w: 393, h: 852, dpr: 3, chrome: 'ios' },
  { id: 'pixel-9', label: 'Pixel 9', w: 412, h: 923, dpr: 2.625, chrome: 'android' },
  { id: 'desktop', label: 'Desktop', w: 1440, h: 900, dpr: 2, chrome: 'none' },
];

export const SECTION_COLORS = ['grey', 'blue', 'green', 'amber', 'red', 'purple'] as const;

export const SectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  parent: z.string().nullable().default(null),
  color: z.enum(SECTION_COLORS).default('grey'),
  rect: RectSchema.optional(),
  layout: z.enum(['free', 'row', 'grid']).default('free'),
  collapsed: z.boolean().default(false),
  locked: z.boolean().default(false),
  order: z.number().default(0),
});
export type Section = z.infer<typeof SectionSchema>;

export const ScreenSchema = z.object({
  id: kebab,
  title: z.string(),
  section: z.string().nullable().default(null),
  path: z.string().startsWith('/'),
  states: z.array(z.string()).min(1).default(['default']),
  position: Point.optional(),
});
export type Screen = z.infer<typeof ScreenSchema>;

export const GESTURES = ['tap', 'long-press', 'swipe-left', 'swipe-right', 'swipe-up', 'swipe-down', 'submit', 'auto-after-ms'] as const;
export const TRANSITIONS = ['push', 'pop', 'sheet-up', 'sheet-down', 'fade', 'none'] as const;
export const EDGE_KINDS = ['happy', 'error', 'alternate'] as const;

export const EASING_PRESETS: Record<string, string> = {
  linear: 'linear',
  ease: 'ease',
  'ease-in-out': 'ease-in-out',
  'ease-out': 'ease-out',
  snappy: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
  sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
  overshoot: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

const StateRef = z.object({ screen: z.string(), state: z.string().default('default') });

export const EdgeSchema = z.object({
  id: z.string(),
  from: StateRef,
  to: StateRef,
  trigger: z
    .object({
      label: z.string().default(''),
      hint: z.string().optional(),
      gesture: z.enum(GESTURES).default('tap'),
      target: z.string().optional(),
      afterMs: z.number().optional(),
    })
    .default({}),
  transition: z
    .object({
      type: z.enum(TRANSITIONS).default('push'),
      duration: z.number().nonnegative().default(240),
      easing: z.string().default(EASING_PRESETS.snappy!),
    })
    .default({}),
  kind: z.enum(EDGE_KINDS).default('happy'),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const NOTE_KINDS = ['note', 'question', 'issue', 'decision', 'idea'] as const;
const AttachTo = z.object({ type: z.enum(['frame', 'edge', 'section', 'image']), id: z.string() });

export const ImageSchema = z.object({
  id: z.string(),
  file: z.string().optional(),
  url: z.string().optional(),
  caption: z.string().optional(),
  rect: RectSchema,
  crop: RectSchema.nullable().default(null),
  opacity: z.number().min(0).max(1).default(1),
  overlay: z.object({ frame: z.string(), opacity: z.number().min(0).max(1) }).nullable().default(null),
  section: z.string().nullable().default(null),
});
export type CanvasImage = z.infer<typeof ImageSchema>;

export const NoteSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTE_KINDS).default('note'),
  text: z.string(),
  attachTo: AttachTo.nullable().default(null),
  rect: RectSchema,
  section: z.string().nullable().default(null),
  author: z.string().default('me'),
  createdAt: z.string(),
});
export type Note = z.infer<typeof NoteSchema>;

export const CommentMessageSchema = z.object({
  author: z.string(),
  text: z.string(),
  at: z.string(),
  changes: z.array(z.string()).optional(),
});

export const CommentSchema = z.object({
  id: z.string(),
  status: z.enum(['open', 'resolved']).default('open'),
  to: z.enum(['claude', 'team']).nullable().default(null),
  anchor: z.object({
    frame: z.string(), // "<screenId>:<state>"
    device: z.string().optional(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    element: ElementContextSchema.nullable().default(null),
  }),
  thread: z.array(CommentMessageSchema).min(1),
});
export type Comment = z.infer<typeof CommentSchema>;

export const ConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  project: z.object({ name: z.string(), origin: z.string().url() }),
  devices: z.array(DeviceSchema).default(DEVICE_PRESETS),
  sections: z.array(SectionSchema).default([]),
  screens: z.array(ScreenSchema).default([]),
  edges: z.array(EdgeSchema).default([]),
  mocks: z.record(z.array(MockRuleSchema)).default({}), // key "<screenId>:<state>"
  tokens: z.record(z.string()).default({}),
  images: z.array(ImageSchema).default([]),
  notes: z.array(NoteSchema).default([]),
  comments: z.array(CommentSchema).default([]),
});
export type FlowCanvasConfig = z.infer<typeof ConfigSchema>;
export type FlowCanvasConfigInput = z.input<typeof ConfigSchema>;

/**
 * Migrate older shapes to the current one:
 *  - `groups` → `sections` (ids kept), `screens[].group` → `screens[].section`.
 */
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const c: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(c.groups)) {
    const existing = Array.isArray(c.sections) ? (c.sections as unknown[]) : [];
    const fromGroups = (c.groups as Array<Record<string, unknown>>).map((g) => ({
      id: g.id,
      title: g.title ?? g.id,
      order: g.order ?? 0,
      parent: null,
    }));
    c.sections = [...existing, ...fromGroups];
    delete c.groups;
  }
  if (Array.isArray(c.screens)) {
    c.screens = (c.screens as Array<Record<string, unknown>>).map((s) => {
      if ('group' in s && !('section' in s)) {
        const { group, ...rest } = s;
        return { ...rest, section: group ?? null };
      }
      return s;
    });
  }
  return c;
}

export type ParseResult = { ok: true; config: FlowCanvasConfig } | { ok: false; errors: string[] };

/** Migrate + validate + referential checks. */
export function parseConfig(raw: unknown): ParseResult {
  const r = ConfigSchema.safeParse(migrate(raw));
  if (!r.success) {
    return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const errors = validateRefs(r.data);
  return errors.length ? { ok: false, errors } : { ok: true, config: r.data };
}

export function validateRefs(c: FlowCanvasConfig): string[] {
  const errors: string[] = [];
  const screenIds = new Set<string>();
  for (const s of c.screens) {
    if (screenIds.has(s.id)) errors.push(`screens: duplicate id "${s.id}"`);
    screenIds.add(s.id);
  }
  const sectionIds = new Set(c.sections.map((s) => s.id));
  for (const s of c.screens) {
    if (s.section && !sectionIds.has(s.section)) errors.push(`screens.${s.id}: unknown section "${s.section}"`);
  }
  for (const s of c.sections) {
    if (s.parent && !sectionIds.has(s.parent)) errors.push(`sections.${s.id}: unknown parent "${s.parent}"`);
    if (sectionDepth(c, s.id) > 3) errors.push(`sections.${s.id}: nesting deeper than 3 levels`);
  }
  for (const e of c.edges) {
    if (!screenIds.has(e.from.screen)) errors.push(`edges.${e.id}: unknown from screen "${e.from.screen}"`);
    if (!screenIds.has(e.to.screen)) errors.push(`edges.${e.id}: unknown to screen "${e.to.screen}"`);
  }
  return errors;
}

export function sectionDepth(c: FlowCanvasConfig, id: string): number {
  let depth = 0;
  let cur: string | null | undefined = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    depth++;
    cur = c.sections.find((s) => s.id === cur)?.parent;
  }
  return depth;
}

export function emptyConfig(origin: string, name = new URL(origin).host): FlowCanvasConfig {
  return ConfigSchema.parse({ $schema: SCHEMA_URL, version: 1, project: { name, origin } });
}

/** Stable serialization for diffs: 2-space JSON, trailing newline. */
export function serializeConfig(c: FlowCanvasConfig): string {
  return JSON.stringify(c, null, 2) + '\n';
}

export function frameKey(screenId: string, state: string): string {
  return `${screenId}:${state}`;
}

export function toKebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'screen';
}

/** Short random id with a prefix, e.g. id('e') → "e-7f2a91". */
export function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 8)}`;
}

export { MockRuleSchema };
