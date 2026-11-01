/**
 * MCP tools. Descriptions are prompts for Claude: say what the tool does,
 * when to use it and what it returns.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  CONFIG_FILE,
  EASING_PRESETS,
  EDGE_KINDS,
  GESTURES,
  MockRuleSchema,
  NOTE_KINDS,
  SECTION_COLORS,
  TRANSITIONS,
  frameKey,
  id as newId,
  sectionDepth,
  toKebab,
  type CanvasImage,
  type Comment,
  type Edge,
  type FlowCanvasConfig,
  type Note,
  type Screen,
  type Section,
} from '@flowcanvas/config';
import { RectSchema } from '@flowcanvas/protocol';
import { ToolError } from './log.js';
import { downloadImage, readLocalImage, storeAsset } from './assets.js';
import { assertNotPaused, canvasReady, getScreenshot, originOf, requireCanvas, type ServerContext } from './context.js';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown> | unknown[];

function text(v: Json): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(v) }] };
}

function fail(msg: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: msg }] };
}

interface ToolSpec<S extends z.ZodRawShape> {
  title: string;
  description: string;
  input: S;
  /** Blocked while Pause Claude is on. */
  write?: boolean;
  readOnly?: boolean;
  destructive?: boolean;
}

type Handler<S extends z.ZodRawShape> = (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<Json | CallToolResult>;

function isCallToolResult(v: unknown): v is CallToolResult {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { content?: unknown }).content);
}

export function registerTools(mcp: McpServer, ctx: ServerContext): string[] {
  const names: string[] = [];

  function tool<S extends z.ZodRawShape>(name: string, spec: ToolSpec<S>, handler: Handler<S>): void {
    names.push(name);
    const cb = async (args: z.objectOutputType<S, z.ZodTypeAny>): Promise<CallToolResult> => {
      let result: CallToolResult;
      let summary = '';
      try {
        if (spec.write) assertNotPaused(ctx);
        const out = await handler(args);
        result = isCallToolResult(out) ? out : text(out);
        summary = 'ok';
      } catch (e) {
        const msg = e instanceof ToolError ? e.message : `Unexpected error in ${name}: ${(e as Error).message ?? String(e)}`;
        if (!(e instanceof ToolError)) ctx.log.error(`${name}: ${(e as Error).stack ?? String(e)}`);
        result = fail(msg);
        summary = msg.split('\n')[0]!.slice(0, 200);
      }
      ctx.link?.sendIfReady({ type: 'activity', tool: name, ok: !result.isError, summary, at: new Date().toISOString() });
      return result;
    };
    mcp.registerTool(
      name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.input,
        annotations: {
          title: spec.title,
          readOnlyHint: !!spec.readOnly,
          destructiveHint: !!spec.destructive,
          openWorldHint: false,
        },
      },
      // The SDK's callback type is generic over the zod shape; our wrapper keeps the parsed args type.
      cb as never,
    );
  }

  const mutate = <T>(label: string, fn: (c: FlowCanvasConfig) => T) => ctx.store.mutate(label, fn, 'claude');

  /* ---------------------------- shared schemas ---------------------------- */

  const StateRef = z.object({
    screen: z.string().describe('Screen id'),
    state: z.string().default('default').describe('State name on that screen (default "default")'),
  });
  const Trigger = z
    .object({
      label: z.string().describe('Text on the control, e.g. "Get started"'),
      hint: z.string().describe('Hint shown on the Player arrow'),
      gesture: z.enum(GESTURES),
      target: z.string().describe('CSS selector of the control; prefer [data-fc="…"]'),
      afterMs: z.number().describe('Delay for gesture "auto-after-ms"'),
    })
    .partial();
  const Transition = z
    .object({
      type: z.enum(TRANSITIONS),
      duration: z.number().nonnegative().describe('ms'),
      easing: z.string().describe(`CSS easing or a preset name: ${Object.keys(EASING_PRESETS).join(', ')}`),
    })
    .partial();
  const AttachTo = z.object({
    type: z.enum(['frame', 'edge', 'section', 'image']),
    id: z.string().describe('For frame: a screen id or "<screenId>:<state>"'),
  });
  const Point = z.object({ x: z.number(), y: z.number() });

  const easing = (e: string | undefined) => (e === undefined ? undefined : (EASING_PRESETS[e] ?? e));

  /* ------------------------------- reads ------------------------------- */

  tool(
    'get_project',
    {
      title: 'Get project overview',
      description:
        'Overview of the Flow Canvas project: name, origin, devices, sections (with item counts), screens with their states, and counts of edges, images, notes and comments (open, and open "For Claude"). Also says whether the canvas tab is linked and whether Claude is paused. Start here. Works without the canvas.',
      input: {},
      readOnly: true,
    },
    async () => {
      const c = ctx.store.get();
      const open = c.comments.filter((x) => x.status === 'open');
      return {
        name: c.project.name,
        origin: c.project.origin,
        projectDir: ctx.store.dir,
        configFile: CONFIG_FILE,
        configExists: ctx.store.onDisk,
        ...(ctx.store.onDisk ? {} : { note: `${CONFIG_FILE} does not exist yet; the first write creates it.` }),
        devices: c.devices.map((d) => ({ id: d.id, label: d.label, w: d.w, h: d.h })),
        sections: c.sections.map((s) => ({
          id: s.id,
          title: s.title,
          parent: s.parent,
          color: s.color,
          layout: s.layout,
          collapsed: s.collapsed,
          items: sectionItemCount(c, s.id),
        })),
        screens: c.screens.map((s) => ({ id: s.id, title: s.title, section: s.section, path: s.path, states: s.states })),
        tokens: c.tokens,
        counts: {
          sections: c.sections.length,
          screens: c.screens.length,
          states: c.screens.reduce((n, s) => n + s.states.length, 0),
          edges: c.edges.length,
          images: c.images.length,
          notes: c.notes.length,
          comments: c.comments.length,
          openComments: open.length,
          openForClaude: open.filter((x) => x.to === 'claude').length,
        },
        canvas: ctx.link ? ctx.link.status() : { linked: false, granted: null, paused: false },
      };
    },
  );

  tool(
    'list_screens',
    {
      title: 'List screens',
      description: 'List screens with path, section, states (first is the default) and canvas position. Filter by section id (includes nested sections). Works without the canvas.',
      input: { section: z.string().optional().describe('Section id; omit for all screens') },
      readOnly: true,
    },
    async ({ section }) => {
      const c = ctx.store.get();
      if (section) mustSection(c, section);
      const inside = section ? sectionAndDescendants(c, section) : null;
      const screens = c.screens.filter((s) => !inside || (s.section && inside.has(s.section)));
      return { screens };
    },
  );

  /* ------------------------------ screens ------------------------------ */

  tool(
    'add_screen',
    {
      title: 'Add screen',
      description:
        'Add a screen (one route of the app) to the canvas. id is kebab-case and stable because edges point at it; it defaults to the kebab-case title. path is the app route starting with "/". states lists the states to show side by side; the first is the default. Returns the screen.',
      input: {
        title: z.string().min(1),
        path: z.string().startsWith('/').describe('App route, e.g. /catalog'),
        id: z.string().optional().describe('kebab-case id; default from title'),
        section: z.string().nullable().optional().describe('Section id to put it in'),
        states: z.array(z.string().min(1)).min(1).optional().describe('Default ["default"]'),
        position: Point.optional().describe('Canvas position; omit to let the canvas lay it out'),
      },
      write: true,
    },
    async (a) => {
      const sid = a.id ?? toKebab(a.title);
      const { result } = await mutate(`add screen ${sid}`, (c) => {
        if (c.screens.some((s) => s.id === sid)) throw new ToolError(`A screen with id "${sid}" already exists. Use update_screen or pick another id.`);
        if (a.section) mustSection(c, a.section);
        const screen: Screen = {
          id: sid,
          title: a.title,
          section: a.section ?? null,
          path: a.path,
          states: dedupe(a.states ?? ['default']),
          ...(a.position ? { position: a.position } : {}),
        };
        c.screens.push(screen);
        return screen;
      });
      return { id: sid, screen: result };
    },
  );

  tool(
    'update_screen',
    {
      title: 'Update screen',
      description:
        'Change a screen\'s title, path, section, states (full list, first = default) or position. Removing a state that edges use is rejected; delete those edges first. Returns the screen.',
      input: {
        id: z.string(),
        title: z.string().min(1).optional(),
        path: z.string().startsWith('/').optional(),
        section: z.string().nullable().optional().describe('Section id, or null for none'),
        states: z.array(z.string().min(1)).min(1).optional(),
        position: Point.optional(),
      },
      write: true,
    },
    async (a) => {
      const { result } = await mutate(`update screen ${a.id}`, (c) => {
        const s = mustScreen(c, a.id);
        if (a.section) mustSection(c, a.section);
        if (a.title !== undefined) s.title = a.title;
        if (a.path !== undefined) s.path = a.path;
        if (a.section !== undefined) s.section = a.section;
        if (a.position !== undefined) s.position = a.position;
        if (a.states !== undefined) {
          const next = dedupe(a.states);
          const used = c.edges.flatMap((e) => [e.from, e.to]).filter((r) => r.screen === s.id && !next.includes(r.state));
          if (used.length) {
            throw new ToolError(`Cannot remove state(s) ${[...new Set(used.map((r) => r.state))].join(', ')} from "${s.id}": edges use them.`);
          }
          s.states = next;
        }
        return s;
      });
      return { id: a.id, screen: result };
    },
  );

  tool(
    'add_state',
    {
      title: 'Add state',
      description:
        'Add a state (e.g. "error", "empty", "missing-email") to a screen. Optional mocks are fetch/XHR mock rules used when the app has no SDK: [{match:{method,url},status,body,delay}] where url is a glob and delay "forever" means never answer (loading). If the state already exists, only its mocks are replaced. Returns the state and its frame key "<screenId>:<state>".',
      input: {
        screenId: z.string(),
        name: z.string().min(1),
        mocks: z.array(MockRuleSchema).optional(),
      },
      write: true,
    },
    async (a) => {
      const key = frameKey(a.screenId, a.name);
      const { result } = await mutate(`add state ${key}`, (c) => {
        const s = mustScreen(c, a.screenId);
        const existed = s.states.includes(a.name);
        if (existed && !a.mocks) throw new ToolError(`Screen "${s.id}" already has state "${a.name}".`);
        if (!existed) s.states.push(a.name);
        if (a.mocks) c.mocks[key] = a.mocks;
        return { screenId: s.id, state: a.name, frame: key, states: s.states, mocks: c.mocks[key] ?? null, created: !existed };
      });
      return { id: key, ...result };
    },
  );

  /* ------------------------------- edges ------------------------------- */

  tool(
    'list_edges',
    {
      title: 'List edges',
      description: 'List flow edges (screen state → screen state) with trigger, transition and kind. Filter by a screen id to get its incoming and outgoing edges. Works without the canvas.',
      input: { screenId: z.string().optional() },
      readOnly: true,
    },
    async ({ screenId }) => {
      const c = ctx.store.get();
      if (screenId) mustScreen(c, screenId);
      const edges = c.edges.filter((e) => !screenId || e.from.screen === screenId || e.to.screen === screenId);
      return { edges };
    },
  );

  tool(
    'add_edge',
    {
      title: 'Add edge',
      description:
        'Draw a flow edge from one screen state to another. trigger: label (button text), gesture (tap, long-press, swipe-*, submit, auto-after-ms), target (CSS selector, prefer [data-fc="…"]), hint. transition: type (push, pop, sheet-up, sheet-down, fade, none), duration ms, easing (CSS or preset). kind: happy (solid), error (red), alternate (dashed). Both ends must be existing screens and states. Returns the edge and its id.',
      input: {
        from: StateRef,
        to: StateRef,
        trigger: Trigger.optional(),
        transition: Transition.optional(),
        kind: z.enum(EDGE_KINDS).optional(),
        id: z.string().optional().describe('Optional id; generated when omitted'),
      },
      write: true,
    },
    async (a) => {
      const eid = a.id ?? newId('e');
      const { result } = await mutate(`add edge ${eid}`, (c) => {
        if (c.edges.some((e) => e.id === eid)) throw new ToolError(`An edge with id "${eid}" already exists.`);
        checkStateRef(c, a.from, 'from');
        checkStateRef(c, a.to, 'to');
        const edge = {
          id: eid,
          from: a.from,
          to: a.to,
          trigger: { label: '', gesture: 'tap', ...stripUndef(a.trigger ?? {}) },
          transition: {
            type: 'push',
            duration: 240,
            easing: EASING_PRESETS.snappy!,
            ...stripUndef({ ...a.transition, easing: easing(a.transition?.easing) }),
          },
          kind: a.kind ?? 'happy',
        } as Edge;
        c.edges.push(edge);
        return edge;
      });
      return { id: eid, edge: result };
    },
  );

  tool(
    'update_edge',
    {
      title: 'Update edge',
      description: 'Change an edge. trigger and transition fields are merged into the existing ones (pass only what changes). Returns the edge.',
      input: {
        id: z.string(),
        from: StateRef.optional(),
        to: StateRef.optional(),
        trigger: Trigger.optional(),
        transition: Transition.optional(),
        kind: z.enum(EDGE_KINDS).optional(),
      },
      write: true,
    },
    async (a) => {
      const { result } = await mutate(`update edge ${a.id}`, (c) => {
        const e = c.edges.find((x) => x.id === a.id);
        if (!e) throw new ToolError(`Unknown edge "${a.id}". Use list_edges to see edge ids.`);
        if (a.from) {
          checkStateRef(c, a.from, 'from');
          e.from = a.from;
        }
        if (a.to) {
          checkStateRef(c, a.to, 'to');
          e.to = a.to;
        }
        if (a.trigger) e.trigger = { ...e.trigger, ...stripUndef(a.trigger) };
        if (a.transition) e.transition = { ...e.transition, ...stripUndef({ ...a.transition, easing: easing(a.transition.easing) }) };
        if (a.kind) e.kind = a.kind;
        return e;
      });
      return { id: a.id, edge: result };
    },
  );

  /* ------------------------------ delete ------------------------------- */

  tool(
    'delete_items',
    {
      title: 'Delete items',
      description:
        'Delete screens, edges, sections, images, notes or comments by id. Deleting a screen also deletes its edges and mocks; deleting a section moves its contents to the parent section (nothing inside is deleted); notes attached to deleted items are detached. When the canvas is open the user must Allow the delete; if they deny, nothing changes. Returns the deleted count and ids.',
      input: { ids: z.array(z.string()).min(1) },
      write: true,
      destructive: true,
    },
    async ({ ids }) => {
      const c0 = ctx.store.get();
      const unknown = ids.filter((x) => !kindOf(c0, x));
      if (unknown.length === ids.length) throw new ToolError(`None of these ids exist: ${unknown.join(', ')}.`);
      if (canvasReady(ctx)) {
        const r = await ctx.link!.request(
          'confirm',
          { action: 'delete', message: `Claude wants to delete ${ids.length - unknown.length} item(s): ${ids.filter((x) => !unknown.includes(x)).join(', ')}`, ids, count: ids.length },
          120_000,
        );
        if (!r.allowed) throw new ToolError('The user denied the delete on the canvas. Nothing was deleted.');
      }
      const { result } = await mutate(`delete ${ids.join(', ')}`, (c) => deleteItems(c, ids));
      return { deleted: result.deleted.length, ids: result.deleted, cascaded: result.cascaded, notFound: unknown };
    },
  );

  /* ----------------------------- sections ------------------------------ */

  const SectionFields = {
    layout: z.enum(['free', 'row', 'grid']).optional().describe('row = states side by side; grid = 3 per row'),
    color: z.enum(SECTION_COLORS).optional(),
    parent: z.string().nullable().optional().describe('Parent section id (nesting up to 3 levels)'),
    rect: RectSchema.optional(),
  };

  tool(
    'create_section',
    {
      title: 'Create section',
      description:
        'Create a named section (a titled area that holds screens, images, notes and other sections; nesting up to 3 levels). itemIds are moved into it: screen, image and note ids get section = this id, section ids get parent = this id. Returns the section and its id.',
      input: {
        name: z.string().min(1),
        itemIds: z.array(z.string()).optional(),
        id: z.string().optional().describe('Optional id; default kebab-case name'),
        collapsed: z.boolean().optional(),
        ...SectionFields,
      },
      write: true,
    },
    async (a) => {
      const { result } = await mutate(`create section ${a.name}`, (c) => {
        const sid = a.id ?? uniqueId(toKebab(a.name), new Set(c.sections.map((s) => s.id)));
        if (c.sections.some((s) => s.id === sid)) throw new ToolError(`A section with id "${sid}" already exists.`);
        if (a.parent) mustSection(c, a.parent);
        const section: Section = {
          id: sid,
          title: a.name,
          parent: a.parent ?? null,
          color: a.color ?? 'grey',
          layout: a.layout ?? 'free',
          collapsed: a.collapsed ?? false,
          locked: false,
          order: c.sections.length,
          ...(a.rect ? { rect: a.rect } : {}),
        };
        c.sections.push(section);
        const moved = moveIntoSection(c, sid, a.itemIds ?? []);
        checkDepth(c);
        return { section, moved };
      });
      return { id: result.section.id, ...result };
    },
  );

  tool(
    'update_section',
    {
      title: 'Update section',
      description:
        'Rename a section, change its layout, color, parent, rect, collapsed or locked flag, move items into it (itemIds) or out of it to its parent (removeItemIds). Returns the section.',
      input: {
        id: z.string(),
        name: z.string().min(1).optional(),
        itemIds: z.array(z.string()).optional().describe('Items to move into this section'),
        removeItemIds: z.array(z.string()).optional().describe('Items to move out to the parent section'),
        collapsed: z.boolean().optional(),
        locked: z.boolean().optional(),
        ...SectionFields,
      },
      write: true,
    },
    async (a) => {
      const { result } = await mutate(`update section ${a.id}`, (c) => {
        const s = mustSection(c, a.id);
        if (a.name !== undefined) s.title = a.name;
        if (a.layout !== undefined) s.layout = a.layout;
        if (a.color !== undefined) s.color = a.color;
        if (a.collapsed !== undefined) s.collapsed = a.collapsed;
        if (a.locked !== undefined) s.locked = a.locked;
        if (a.rect !== undefined) s.rect = a.rect;
        if (a.parent !== undefined) {
          if (a.parent === s.id) throw new ToolError('A section cannot be its own parent.');
          if (a.parent) mustSection(c, a.parent);
          if (a.parent && sectionAndDescendants(c, s.id).has(a.parent)) throw new ToolError('That would put the section inside itself.');
          s.parent = a.parent;
        }
        const moved = moveIntoSection(c, s.id, a.itemIds ?? []);
        const removed = moveIntoSection(c, s.parent, (a.removeItemIds ?? []).filter((x) => x !== s.id), s.id);
        checkDepth(c);
        return { section: s, moved, removed };
      });
      return { id: a.id, ...result };
    },
  );

  /* ------------------------------ images ------------------------------- */

  tool(
    'add_image',
    {
      title: 'Add image',
      description:
        'Put an image on the canvas from a local file path (absolute or relative to the project) or an http(s) URL. The file is copied to .flowcanvas/assets/<hash>.<ext> in the project (same image stored once) and the relative path is saved. Use for Figma exports, reference shots or competitor screens. overlayOn pins it over a frame ("<screenId>:<state>") at 50% opacity to compare design and build. Size defaults to the image\'s pixel size. Returns the image and its id.',
      input: {
        path: z.string().optional().describe('Local image file'),
        url: z.string().optional().describe('http(s) image URL to download'),
        x: z.number(),
        y: z.number(),
        w: z.number().positive().optional(),
        h: z.number().positive().optional(),
        caption: z.string().optional(),
        section: z.string().nullable().optional(),
        overlayOn: z.string().optional().describe('Frame key "<screenId>:<state>" to overlay'),
        overlayOpacity: z.number().min(0).max(1).optional(),
      },
      write: true,
    },
    async (a) => {
      if (!!a.path === !!a.url) throw new ToolError('Pass exactly one of path or url.');
      const c0 = ctx.store.get();
      if (a.section) mustSection(c0, a.section);
      if (a.overlayOn) mustFrame(c0, a.overlayOn);
      const buf = a.path ? await readLocalImage(ctx.store.dir, a.path) : await downloadImage(a.url!);
      const asset = await storeAsset(ctx.store.dir, buf);
      let w = a.w;
      let h = a.h;
      const nat = asset.size;
      if (nat && nat.w > 0 && nat.h > 0) {
        if (w && !h) h = Math.round((w * nat.h) / nat.w);
        else if (h && !w) w = Math.round((h * nat.w) / nat.h);
        else if (!w && !h) {
          const scale = Math.min(1, 1440 / Math.max(nat.w, nat.h));
          w = Math.round(nat.w * scale);
          h = Math.round(nat.h * scale);
        }
      }
      const iid = newId('img');
      const { result } = await mutate(`add image ${iid}`, (c) => {
        const img: CanvasImage = {
          id: iid,
          file: asset.file,
          ...(a.url ? { url: a.url } : {}),
          ...(a.caption ? { caption: a.caption } : {}),
          rect: { x: a.x, y: a.y, w: w ?? 400, h: h ?? 300 },
          crop: null,
          opacity: 1,
          overlay: a.overlayOn ? { frame: normalizeFrame(c, a.overlayOn), opacity: a.overlayOpacity ?? 0.5 } : null,
          section: a.section ?? null,
        };
        c.images.push(img);
        return img;
      });
      return { id: iid, image: result, stored: { file: asset.file, bytes: asset.bytes, newFile: asset.created } };
    },
  );

  tool(
    'list_images',
    {
      title: 'List images',
      description: 'List images on the canvas with captions, file paths (relative to the project; read them to see the image), rect, overlay and section. Filter by section id. Works without the canvas.',
      input: { section: z.string().optional() },
      readOnly: true,
    },
    async ({ section }) => {
      const c = ctx.store.get();
      if (section) mustSection(c, section);
      const inside = section ? sectionAndDescendants(c, section) : null;
      return {
        images: c.images
          .filter((i) => !inside || (i.section && inside.has(i.section)))
          .map((i) => ({ ...i, resource: `flowcanvas://images/${i.id}` })),
      };
    },
  );

  /* ------------------------------- notes ------------------------------- */

  tool(
    'add_note',
    {
      title: 'Add sticky note',
      description:
        'Leave a sticky note on the canvas (markdown text). kind: note, question, issue, decision or idea. attachTo pins it to a frame (screen id or "<screenId>:<state>"), edge, section or image so it moves with it. Use it to explain a change or a decision. Returns the note and its id.',
      input: {
        text: z.string().min(1),
        kind: z.enum(NOTE_KINDS).optional(),
        attachTo: AttachTo.optional(),
        rect: RectSchema.optional().describe('Default 220×120 near the attached item'),
        section: z.string().nullable().optional(),
      },
      write: true,
    },
    async (a) => {
      const nid = newId('n');
      const { result } = await mutate(`add note ${nid}`, (c) => {
        if (a.attachTo) checkAttach(c, a.attachTo);
        if (a.section) mustSection(c, a.section);
        const note: Note = {
          id: nid,
          kind: a.kind ?? 'note',
          text: a.text,
          attachTo: a.attachTo ?? null,
          rect: a.rect ?? defaultNoteRect(c, a.attachTo),
          section: a.section ?? inferSection(c, a.attachTo),
          author: 'claude',
          createdAt: new Date().toISOString(),
        };
        c.notes.push(note);
        return note;
      });
      return { id: nid, note: result };
    },
  );

  tool(
    'update_note',
    {
      title: 'Update sticky note',
      description: 'Edit a sticky note: text, kind, attachTo (null to detach), rect or section. Returns the note.',
      input: {
        id: z.string(),
        text: z.string().min(1).optional(),
        kind: z.enum(NOTE_KINDS).optional(),
        attachTo: AttachTo.nullable().optional(),
        rect: RectSchema.optional(),
        section: z.string().nullable().optional(),
      },
      write: true,
    },
    async (a) => {
      const { result } = await mutate(`update note ${a.id}`, (c) => {
        const n = c.notes.find((x) => x.id === a.id);
        if (!n) throw new ToolError(`Unknown note "${a.id}". Use list_notes to see note ids.`);
        if (a.attachTo) checkAttach(c, a.attachTo);
        if (a.section) mustSection(c, a.section);
        if (a.text !== undefined) n.text = a.text;
        if (a.kind !== undefined) n.kind = a.kind;
        if (a.attachTo !== undefined) n.attachTo = a.attachTo;
        if (a.rect !== undefined) n.rect = a.rect;
        if (a.section !== undefined) n.section = a.section;
        return n;
      });
      return { id: a.id, note: result };
    },
  );

  tool(
    'list_notes',
    {
      title: 'List sticky notes',
      description: 'List sticky notes with kind, text, author and what each is attached to (with the item\'s title). Filter by section id and/or kind. Works without the canvas.',
      input: { section: z.string().optional(), kind: z.enum(NOTE_KINDS).optional() },
      readOnly: true,
    },
    async ({ section, kind }) => {
      const c = ctx.store.get();
      if (section) mustSection(c, section);
      const inside = section ? sectionAndDescendants(c, section) : null;
      return {
        notes: c.notes
          .filter((n) => (!inside || (n.section && inside.has(n.section))) && (!kind || n.kind === kind))
          .map((n) => ({ ...n, attachedTo: n.attachTo ? describeItem(c, n.attachTo.type, n.attachTo.id) : null })),
      };
    },
  );

  /* ------------------------------ comments ----------------------------- */

  tool(
    'list_comments',
    {
      title: 'List comments',
      description:
        'List comment threads pinned on frames, with the element under the pin (CSS selector, tag, text, trimmed HTML, key styles) so you know exactly what the user means. Filter by status (open, resolved) and to ("claude" = flagged "For Claude", "team"). To work through feedback: list_comments {status:"open", to:"claude"}, make the change, then reply_comment with what changed. Works without the canvas.',
      input: {
        status: z.enum(['open', 'resolved']).optional(),
        to: z.enum(['claude', 'team']).optional(),
        screenId: z.string().optional(),
      },
      readOnly: true,
    },
    async (a) => {
      const c = ctx.store.get();
      return { comments: filterComments(c, a).map((x) => withFrameInfo(c, x)) };
    },
  );

  tool(
    'reply_comment',
    {
      title: 'Reply to comment',
      description:
        'Reply in a comment thread as Claude. Say what you changed; list the ids of items you added or changed in changes (e.g. ["e9"]) so the canvas links them. Set resolve true to also resolve the thread. Returns the thread.',
      input: {
        threadId: z.string(),
        text: z.string().min(1),
        changes: z.array(z.string()).optional(),
        resolve: z.boolean().optional(),
      },
      write: true,
    },
    async (a) => {
      const { result } = await mutate(`reply to comment ${a.threadId}`, (c) => {
        const t = mustComment(c, a.threadId);
        t.thread.push({ author: 'claude', text: a.text, at: new Date().toISOString(), ...(a.changes?.length ? { changes: a.changes } : {}) });
        if (a.resolve) t.status = 'resolved';
        return t;
      });
      return { id: a.threadId, thread: result };
    },
  );

  tool(
    'resolve_comment',
    {
      title: 'Resolve comment',
      description: 'Mark a comment thread resolved, with an optional closing reply from Claude. Set reopen true to reopen it instead. Returns the thread.',
      input: { threadId: z.string(), text: z.string().optional(), reopen: z.boolean().optional() },
      write: true,
    },
    async (a) => {
      const { result } = await mutate(`${a.reopen ? 'reopen' : 'resolve'} comment ${a.threadId}`, (c) => {
        const t = mustComment(c, a.threadId);
        if (a.text) t.thread.push({ author: 'claude', text: a.text, at: new Date().toISOString() });
        t.status = a.reopen ? 'open' : 'resolved';
        return t;
      });
      return { id: a.threadId, thread: result };
    },
  );

  /* ------------------------------- tokens ------------------------------ */

  tool(
    'get_tokens',
    {
      title: 'Get design tokens',
      description:
        'Design tokens (CSS custom properties on :root) read live from the app: base values with type (color, length, number, font, other) plus the overrides saved in the project. Needs the Flow Canvas tab open.',
      input: {},
      readOnly: true,
    },
    async () => {
      if (!ctx.link?.linked) {
        const overrides = safeTokens(ctx);
        throw new ToolError(
          `Open the Flow Canvas tab for ${originOf(ctx)} to use this tool. Saved overrides in ${CONFIG_FILE}: ${JSON.stringify(overrides)}`,
        );
      }
      const link = requireCanvas(ctx);
      const r = await link.request('get_tokens', {});
      return { base: r.base, overrides: ctx.store.get().tokens };
    },
  );

  tool(
    'set_tokens',
    {
      title: 'Set design tokens',
      description:
        'Override design tokens, e.g. {"--color-bg":"#FFF8F0","--radius-md":"16px"}; null removes an override. Every frame updates live and the overrides are saved to tokens in the config. Changing more than 10 variables asks the user to Allow on the canvas. Needs the Flow Canvas tab open. Returns all overrides.',
      input: { vars: z.record(z.string().nullable()).describe('CSS variable name (starting with --) → value, or null to reset') },
      write: true,
    },
    async ({ vars }) => {
      const names = Object.keys(vars);
      if (!names.length) throw new ToolError('vars is empty.');
      const bad = names.filter((n) => !n.startsWith('--'));
      if (bad.length) throw new ToolError(`Token names must start with "--": ${bad.join(', ')}`);
      const link = requireCanvas(ctx);
      if (names.length > 10) {
        const r = await link.request(
          'confirm',
          { action: 'set_tokens', message: `Claude wants to change ${names.length} tokens.`, ids: names, count: names.length },
          120_000,
        );
        if (!r.allowed) throw new ToolError('The user denied the token change on the canvas. Nothing changed.');
      }
      const applied = await link.request('set_tokens', { vars });
      const { result } = await mutate(`set ${names.length} token(s)`, (c) => {
        for (const [k, v] of Object.entries(vars)) {
          if (v === null) delete c.tokens[k];
          else c.tokens[k] = v;
        }
        return c.tokens;
      });
      return { overrides: result, changed: names, ...(applied.unknown.length ? { notInApp: applied.unknown } : {}) };
    },
  );

  /* ---------------------------- canvas tools --------------------------- */

  tool(
    'get_screenshot',
    {
      title: 'Get screenshot',
      description:
        'Screenshot of one screen in one state (WebP image). Uses the live canvas when it is open, otherwise the last cached still in .flowcanvas/cache/. device is a device id from get_project (default: the canvas\'s current device).',
      input: { screenId: z.string(), state: z.string().default('default'), device: z.string().optional() },
      readOnly: true,
    },
    async (a) => {
      const shot = await getScreenshot(ctx, a.screenId, a.state, a.device);
      return {
        content: [
          { type: 'image', data: shot.data, mimeType: shot.mimeType },
          { type: 'text', text: JSON.stringify({ frame: frameKey(a.screenId, a.state), device: shot.device, source: shot.source, ...(shot.file ? { file: shot.file } : {}) }) },
        ],
      };
    },
  );

  tool(
    'check_target',
    {
      title: 'Check target selector',
      description:
        'Check whether a CSS selector (an edge trigger target) exists on a screen in a given state, inside the live app. Returns found, how many match, and its size and position. Needs the Flow Canvas tab open.',
      input: { screenId: z.string(), state: z.string().default('default'), selector: z.string().min(1), device: z.string().optional() },
      readOnly: true,
    },
    async (a) => {
      checkStateRef(ctx.store.get(), { screen: a.screenId, state: a.state }, 'screen');
      const link = requireCanvas(ctx);
      const r = await link.request('check_target', { screenId: a.screenId, state: a.state, selector: a.selector, ...(a.device ? { device: a.device } : {}) });
      return { frame: frameKey(a.screenId, a.state), selector: a.selector, ...r };
    },
  );

  tool(
    'play_flow',
    {
      title: 'Play flow',
      description:
        'Play a flow in the canvas Player: all edges of a section (sectionId) or a list of edges (edgeIds), tapping each trigger target in the live app. Returns pass plus the steps that failed and why. Needs the Flow Canvas tab open.',
      input: { sectionId: z.string().optional(), edgeIds: z.array(z.string()).min(1).optional() },
      readOnly: true,
    },
    async (a) => {
      if (!a.sectionId === !a.edgeIds) throw new ToolError('Pass exactly one of sectionId or edgeIds.');
      const c = ctx.store.get();
      if (a.sectionId) mustSection(c, a.sectionId);
      const missing = (a.edgeIds ?? []).filter((x) => !c.edges.some((e) => e.id === x));
      if (missing.length) throw new ToolError(`Unknown edge(s): ${missing.join(', ')}.`);
      const link = requireCanvas(ctx);
      const r = await link.request('play_flow', stripUndef({ sectionId: a.sectionId, edgeIds: a.edgeIds }), 180_000);
      return { pass: r.pass, failed: r.steps.filter((s) => !s.ok), steps: r.steps.length };
    },
  );

  tool(
    'focus',
    {
      title: 'Focus item',
      description: 'Move the canvas camera to an item so the user sees it: a screen id, a frame "<screenId>:<state>", or an edge, section, image, note or comment id. Needs the Flow Canvas tab open.',
      input: { itemId: z.string() },
      readOnly: true,
    },
    async ({ itemId }) => {
      const c = ctx.store.get();
      const kind = kindOf(c, itemId) ?? (itemId.includes(':') && isFrame(c, itemId) ? 'frame' : null);
      if (!kind) throw new ToolError(`Unknown item "${itemId}".`);
      const link = requireCanvas(ctx);
      await link.request('focus', { itemId });
      return { focused: itemId, kind };
    },
  );

  tool(
    'get_selection',
    {
      title: 'Get selection',
      description: 'What the user has selected on the canvas right now (ids and types), with the full items from the config. Use when the user says "this" or "these". Needs the Flow Canvas tab open.',
      input: {},
      readOnly: true,
    },
    async () => {
      const link = requireCanvas(ctx);
      const r = await link.request('get_selection', {});
      const c = ctx.store.get();
      return { ids: r.ids, items: r.ids.map((x) => findItem(c, x) ?? { id: x, type: 'unknown' }) };
    },
  );

  return names;
}

/* ------------------------------------------------------------------ */
/* config helpers                                                      */
/* ------------------------------------------------------------------ */

type ItemKind = 'screen' | 'edge' | 'section' | 'image' | 'note' | 'comment';

function kindOf(c: FlowCanvasConfig, x: string): ItemKind | null {
  if (c.screens.some((s) => s.id === x)) return 'screen';
  if (c.edges.some((s) => s.id === x)) return 'edge';
  if (c.sections.some((s) => s.id === x)) return 'section';
  if (c.images.some((s) => s.id === x)) return 'image';
  if (c.notes.some((s) => s.id === x)) return 'note';
  if (c.comments.some((s) => s.id === x)) return 'comment';
  return null;
}

function findItem(c: FlowCanvasConfig, x: string): Record<string, unknown> | null {
  const k = kindOf(c, x);
  const pick = <T extends { id: string }>(arr: T[]) => arr.find((i) => i.id === x);
  const item =
    k === 'screen' ? pick(c.screens) : k === 'edge' ? pick(c.edges) : k === 'section' ? pick(c.sections) : k === 'image' ? pick(c.images) : k === 'note' ? pick(c.notes) : k === 'comment' ? pick(c.comments) : null;
  if (item) return { type: k, ...item };
  if (isFrame(c, x)) return { type: 'frame', id: x };
  return null;
}

function isFrame(c: FlowCanvasConfig, key: string): boolean {
  const [sid, state] = key.split(':');
  const s = c.screens.find((x) => x.id === sid);
  return !!s && (state === undefined || s.states.includes(state));
}

function mustScreen(c: FlowCanvasConfig, sid: string): Screen {
  const s = c.screens.find((x) => x.id === sid);
  if (!s) throw new ToolError(`Unknown screen "${sid}". Known screens: ${c.screens.map((x) => x.id).join(', ') || '(none)'}.`);
  return s;
}

function mustSection(c: FlowCanvasConfig, sid: string): Section {
  const s = c.sections.find((x) => x.id === sid);
  if (!s) throw new ToolError(`Unknown section "${sid}". Known sections: ${c.sections.map((x) => x.id).join(', ') || '(none)'}.`);
  return s;
}

function mustComment(c: FlowCanvasConfig, cid: string): Comment {
  const t = c.comments.find((x) => x.id === cid);
  if (!t) throw new ToolError(`Unknown comment thread "${cid}". Use list_comments to see thread ids.`);
  return t;
}

function mustFrame(c: FlowCanvasConfig, key: string): void {
  const [sid, state = 'default'] = key.split(':');
  checkStateRef(c, { screen: sid ?? '', state }, 'frame');
}

function normalizeFrame(c: FlowCanvasConfig, key: string): string {
  const [sid, state] = key.split(':');
  return frameKey(sid!, state ?? c.screens.find((s) => s.id === sid)?.states[0] ?? 'default');
}

function checkStateRef(c: FlowCanvasConfig, ref: { screen: string; state: string }, what: string): void {
  const s = c.screens.find((x) => x.id === ref.screen);
  if (!s) throw new ToolError(`${what}: unknown screen "${ref.screen}". Known screens: ${c.screens.map((x) => x.id).join(', ') || '(none)'}. Add it with add_screen first.`);
  if (!s.states.includes(ref.state)) {
    throw new ToolError(`${what}: screen "${ref.screen}" has no state "${ref.state}". States: ${s.states.join(', ')}. Add it with add_state first.`);
  }
}

function checkAttach(c: FlowCanvasConfig, a: { type: 'frame' | 'edge' | 'section' | 'image'; id: string }): void {
  const ok =
    a.type === 'frame'
      ? isFrame(c, a.id)
      : a.type === 'edge'
        ? c.edges.some((e) => e.id === a.id)
        : a.type === 'section'
          ? c.sections.some((s) => s.id === a.id)
          : c.images.some((i) => i.id === a.id);
  if (!ok) throw new ToolError(`attachTo: no ${a.type} "${a.id}".`);
}

function describeItem(c: FlowCanvasConfig, type: string, x: string): Record<string, unknown> {
  switch (type) {
    case 'frame': {
      const [sid, state] = x.split(':');
      const s = c.screens.find((v) => v.id === sid);
      return { type, id: x, title: s ? `${s.title}${state ? ` / ${state}` : ''}` : null, exists: isFrame(c, x) };
    }
    case 'edge': {
      const e = c.edges.find((v) => v.id === x);
      return { type, id: x, title: e ? `${e.from.screen}:${e.from.state} → ${e.to.screen}:${e.to.state}${e.trigger.label ? ` (${e.trigger.label})` : ''}` : null, exists: !!e };
    }
    case 'section': {
      const s = c.sections.find((v) => v.id === x);
      return { type, id: x, title: s?.title ?? null, exists: !!s };
    }
    default: {
      const i = c.images.find((v) => v.id === x);
      return { type, id: x, title: i?.caption ?? null, exists: !!i };
    }
  }
}

function defaultNoteRect(c: FlowCanvasConfig, a?: { type: string; id: string }): { x: number; y: number; w: number; h: number } {
  const size = { w: 220, h: 120 };
  if (a?.type === 'frame') {
    const s = c.screens.find((v) => v.id === a.id.split(':')[0]);
    if (s?.position) return { x: s.position.x, y: s.position.y - 140, ...size };
  }
  if (a?.type === 'image') {
    const i = c.images.find((v) => v.id === a.id);
    if (i) return { x: i.rect.x, y: i.rect.y - 140, ...size };
  }
  if (a?.type === 'section') {
    const s = c.sections.find((v) => v.id === a.id);
    if (s?.rect) return { x: s.rect.x + 24, y: s.rect.y + 48, ...size };
  }
  return { x: 0, y: 0, ...size };
}

function inferSection(c: FlowCanvasConfig, a?: { type: string; id: string }): string | null {
  if (!a) return null;
  if (a.type === 'frame') return c.screens.find((v) => v.id === a.id.split(':')[0])?.section ?? null;
  if (a.type === 'section') return a.id;
  if (a.type === 'image') return c.images.find((v) => v.id === a.id)?.section ?? null;
  return null;
}

function sectionAndDescendants(c: FlowCanvasConfig, root: string): Set<string> {
  const out = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of c.sections) {
      if (s.parent && out.has(s.parent) && !out.has(s.id)) {
        out.add(s.id);
        grew = true;
      }
    }
  }
  return out;
}

function sectionItemCount(c: FlowCanvasConfig, sid: string): number {
  return (
    c.screens.filter((s) => s.section === sid).length +
    c.images.filter((s) => s.section === sid).length +
    c.notes.filter((s) => s.section === sid).length +
    c.sections.filter((s) => s.parent === sid).length
  );
}

function checkDepth(c: FlowCanvasConfig): void {
  for (const s of c.sections) {
    if (sectionDepth(c, s.id) > 3) throw new ToolError(`Section "${s.id}" would be nested deeper than 3 levels.`);
  }
}

/** Move items into section `target` (null = top level). Returns moved ids. `from` limits to items currently in that section. */
function moveIntoSection(c: FlowCanvasConfig, target: string | null, ids: string[], from?: string): string[] {
  const moved: string[] = [];
  for (const x of ids) {
    const k = kindOf(c, x);
    const inFrom = (cur: string | null) => from === undefined || cur === from;
    if (k === 'screen') {
      const s = c.screens.find((v) => v.id === x)!;
      if (!inFrom(s.section)) continue;
      s.section = target;
    } else if (k === 'image') {
      const s = c.images.find((v) => v.id === x)!;
      if (!inFrom(s.section)) continue;
      s.section = target;
    } else if (k === 'note') {
      const s = c.notes.find((v) => v.id === x)!;
      if (!inFrom(s.section)) continue;
      s.section = target;
    } else if (k === 'section') {
      const s = c.sections.find((v) => v.id === x)!;
      if (!inFrom(s.parent)) continue;
      if (target && (x === target || sectionAndDescendants(c, x).has(target))) throw new ToolError(`Cannot put section "${x}" inside itself.`);
      s.parent = target;
    } else if (k) {
      throw new ToolError(`"${x}" is a ${k}; only screens, images, notes and sections can go in a section.`);
    } else {
      throw new ToolError(`Unknown item "${x}".`);
    }
    moved.push(x);
  }
  return moved;
}

function deleteItems(c: FlowCanvasConfig, ids: string[]): { deleted: string[]; cascaded: { edges: string[]; mocks: string[]; detachedNotes: string[] } } {
  const want = new Set(ids);
  const deleted: string[] = [];
  const cascadedEdges: string[] = [];
  const mocks: string[] = [];
  const detached: string[] = [];

  // Sections first: re-parent their contents.
  for (const sec of c.sections.filter((s) => want.has(s.id))) {
    const parent = sec.parent && !want.has(sec.parent) ? sec.parent : null;
    for (const s of c.screens) if (s.section === sec.id) s.section = parent;
    for (const s of c.images) if (s.section === sec.id) s.section = parent;
    for (const s of c.notes) if (s.section === sec.id) s.section = parent;
    for (const s of c.sections) if (s.parent === sec.id) s.parent = parent;
  }
  const dropScreens = new Set(c.screens.filter((s) => want.has(s.id)).map((s) => s.id));
  const keep = <T extends { id: string }>(arr: T[]) =>
    arr.filter((i) => {
      if (want.has(i.id)) {
        deleted.push(i.id);
        return false;
      }
      return true;
    });

  c.sections = keep(c.sections);
  c.screens = keep(c.screens);
  c.images = keep(c.images);
  c.notes = keep(c.notes);
  c.comments = keep(c.comments);
  c.edges = c.edges.filter((e) => {
    if (want.has(e.id)) {
      deleted.push(e.id);
      return false;
    }
    if (dropScreens.has(e.from.screen) || dropScreens.has(e.to.screen)) {
      cascadedEdges.push(e.id);
      return false;
    }
    return true;
  });
  for (const k of Object.keys(c.mocks)) {
    if (dropScreens.has(k.split(':')[0]!)) {
      delete c.mocks[k];
      mocks.push(k);
    }
  }
  const goneEdges = new Set([...cascadedEdges, ...deleted]);
  for (const n of c.notes) {
    const a = n.attachTo;
    if (!a) continue;
    const gone =
      (a.type === 'frame' && dropScreens.has(a.id.split(':')[0]!)) ||
      (a.type === 'edge' && goneEdges.has(a.id)) ||
      ((a.type === 'section' || a.type === 'image') && want.has(a.id));
    if (gone) {
      n.attachTo = null;
      detached.push(n.id);
    }
  }
  for (const i of c.images) {
    if (i.overlay && dropScreens.has(i.overlay.frame.split(':')[0]!)) i.overlay = null;
  }
  return { deleted, cascaded: { edges: cascadedEdges, mocks, detachedNotes: detached } };
}

export function filterComments(c: FlowCanvasConfig, f: { status?: 'open' | 'resolved'; to?: 'claude' | 'team'; screenId?: string }): Comment[] {
  return c.comments.filter(
    (x) => (!f.status || x.status === f.status) && (!f.to || x.to === f.to) && (!f.screenId || x.anchor.frame.split(':')[0] === f.screenId),
  );
}

export function withFrameInfo(c: FlowCanvasConfig, x: Comment): Comment & { screen: { id: string; title: string; path: string; state: string } | null } {
  const [sid, state = 'default'] = x.anchor.frame.split(':');
  const s = c.screens.find((v) => v.id === sid);
  return { ...x, screen: s ? { id: s.id, title: s.title, path: s.path, state } : null };
}

function safeTokens(ctx: ServerContext): Record<string, string> {
  try {
    return ctx.store.get().tokens;
  } catch {
    return {};
  }
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)];
}

function stripUndef<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
