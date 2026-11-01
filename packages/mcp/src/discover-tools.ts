/**
 * Discovery tools: scan_routes (static route scan), add_screens (one batch
 * write = one canvas undo step), list_requests / complete_request (requests
 * the user made from the canvas, e.g. "Discover with Claude").
 */
import path from 'node:path';
import { z } from 'zod';
import { SECTION_COLORS, toKebab, type FlowCanvasConfig, type Screen, type Section } from '@flowcanvas/config';
import { ToolError } from './log.js';
import type { ServerContext } from './context.js';
import type { ToolRegistrar } from './tools.js';
import { scanRoutes } from './discover/scan.js';
import { looksLikePattern, matchesRoute, normalizeRoute } from './discover/pattern.js';
import { DISCOVER_PROMPT, DISCOVER_RECIPE_URI } from './discover/recipe.js';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Colors for new sections, in turn (grey stays the default for hand-made ones). */
const SECTION_ROTATION = SECTION_COLORS.filter((c) => c !== 'grey');

const ScreenIn = z.object({
  id: z.string().regex(KEBAB, 'kebab-case id').optional().describe('kebab-case id; default from title'),
  title: z.string().min(1).describe('Human title, e.g. "Product detail"'),
  path: z.string().startsWith('/').describe('Concrete path the canvas loads, e.g. /product/canele-plate (a real sample, never a pattern)'),
  route: z.string().startsWith('/').optional().describe('Route pattern the path instantiates, e.g. /product/:id; omit for static routes'),
  section: z.string().nullable().optional().describe('Section id or title; created when it does not exist'),
  states: z.array(z.string().min(1)).min(1).optional().describe('States, first = default; default ["default"]'),
  position: z.object({ x: z.number(), y: z.number() }).optional().describe('Omit to let the canvas lay the screen out'),
});
type ScreenInput = z.infer<typeof ScreenIn>;

const SectionIn = z.object({
  id: z.string().regex(KEBAB).optional(),
  title: z.string().min(1),
  color: z.enum(SECTION_COLORS).optional(),
  parent: z.string().nullable().optional().describe('Parent section id or title'),
});
type SectionInput = z.infer<typeof SectionIn>;

export interface AddScreensPlan {
  added: Screen[];
  updated: Array<{ id: string; changes: string[] }>;
  skipped: Array<{ id: string; path: string; reason: string }>;
  sectionsCreated: Section[];
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

function titleFor(ref: string): string {
  if (!KEBAB.test(ref)) return ref;
  const t = ref.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const samePath = (a: string, b: string) => normalizeRoute(a.split(/[?#]/)[0]!) === normalizeRoute(b.split(/[?#]/)[0]!) && a.split('?')[1] === b.split('?')[1];

/** Check the batch; throws one ToolError listing every problem (nothing is written). */
export function validateBatch(screens: ScreenInput[]): void {
  const errors: string[] = [];
  const ids = new Map<string, number>();
  const routes = new Map<string, number>();
  const paths = new Map<string, number>();
  screens.forEach((s, i) => {
    const at = `screens[${i}] (${s.id ?? s.title})`;
    if (looksLikePattern(s.path)) errors.push(`${at}: path "${s.path}" is a pattern; use a real sample value (e.g. /product/canele-plate) and put the pattern in route.`);
    if (s.route && !looksLikePattern(s.path) && !matchesRoute(s.route, s.path)) errors.push(`${at}: path "${s.path}" does not match route "${s.route}".`);
    if (s.states && new Set(s.states).size !== s.states.length) errors.push(`${at}: duplicate state names.`);
    const id = s.id ?? null;
    if (id) {
      if (ids.has(id)) errors.push(`${at}: id "${id}" is used twice in this batch.`);
      ids.set(id, i);
    }
    // Two samples of one dynamic route are fine (e.g. two products); a static route only once.
    if (s.route && !/:/.test(s.route)) {
      if (routes.has(s.route)) errors.push(`${at}: route "${s.route}" is used twice in this batch.`);
      routes.set(s.route, i);
    }
    const p = normalizeRoute(s.path.split(/[?#]/)[0]!) + (s.path.includes('?') ? '?' + s.path.split('?')[1] : '');
    if (paths.has(p)) errors.push(`${at}: path "${s.path}" is used twice in this batch.`);
    paths.set(p, i);
  });
  if (errors.length) throw new ToolError(`add_screens rejected the batch; nothing was written:\n- ${errors.join('\n- ')}`, errors);
}

/** Apply a batch to a config draft. Pure: the same input gives the same plan. */
export function planAddScreens(c: FlowCanvasConfig, screens: ScreenInput[], sections: SectionInput[], mode: 'add' | 'merge'): AddScreensPlan {
  const plan: AddScreensPlan = { added: [], updated: [], skipped: [], sectionsCreated: [] };
  const sectionIds = new Set(c.sections.map((s) => s.id));
  let colorTurn = c.sections.length;

  const findSection = (ref: string): Section | undefined => {
    const lower = ref.toLowerCase();
    return c.sections.find((s) => s.id === ref) ?? c.sections.find((s) => s.title.toLowerCase() === lower) ?? c.sections.find((s) => s.id === toKebab(ref));
  };
  const ensureSection = (ref: string, depth = 0): string => {
    const hit = findSection(ref);
    if (hit) return hit.id;
    const decl = sections.find((s) => s.id === ref || s.title.toLowerCase() === ref.toLowerCase() || (s.id ?? toKebab(s.title)) === toKebab(ref));
    const title = decl?.title ?? titleFor(ref);
    const id = decl?.id && !sectionIds.has(decl.id) ? decl.id : uniqueId(toKebab(decl?.id ?? ref), sectionIds);
    sectionIds.add(id);
    const parent = decl?.parent && depth < 3 ? ensureSection(decl.parent, depth + 1) : null;
    const sec: Section = {
      id,
      title,
      parent,
      color: decl?.color ?? SECTION_ROTATION[colorTurn++ % SECTION_ROTATION.length]!,
      layout: 'free',
      collapsed: false,
      locked: false,
      order: c.sections.length,
    };
    c.sections.push(sec);
    plan.sectionsCreated.push(sec);
    return id;
  };
  // Declared sections first, in the order given.
  for (const s of sections) ensureSection(s.id ?? s.title);

  const taken = new Set(c.screens.map((s) => s.id));
  for (const s of screens) {
    const existing =
      (s.id && c.screens.find((x) => x.id === s.id)) ||
      (s.route && !/:/.test(s.route) ? c.screens.find((x) => x.route === s.route) : undefined) ||
      (s.route && /:/.test(s.route) && !s.id ? c.screens.find((x) => x.route === s.route) : undefined) ||
      c.screens.find((x) => samePath(x.path, s.path));
    const why = existing ? (s.id && existing.id === s.id ? 'same id' : s.route && existing.route === s.route ? 'same route' : 'same path') : '';
    if (existing && mode === 'add') {
      plan.skipped.push({ id: existing.id, path: s.path, reason: `already on the canvas as "${existing.id}" (${why}); use mode "merge" to update it` });
      continue;
    }
    const section = s.section ? ensureSection(s.section) : s.section === null ? null : undefined;
    if (existing) {
      const changes: string[] = [];
      const set = <K extends keyof Screen>(k: K, v: Screen[K]) => {
        existing[k] = v;
        changes.push(k);
      };
      if (s.title !== existing.title) set('title', s.title);
      if (!samePath(s.path, existing.path)) set('path', s.path);
      if (s.route && s.route !== existing.route) set('route', s.route);
      if (section !== undefined && section !== existing.section) set('section', section);
      if (s.states) {
        const next = [...existing.states, ...s.states.filter((x) => !existing.states.includes(x))];
        if (next.length !== existing.states.length) set('states', next);
      }
      if (s.position) set('position', s.position);
      if (!existing.source) existing.source = 'claude';
      if (changes.length) plan.updated.push({ id: existing.id, changes });
      else plan.skipped.push({ id: existing.id, path: s.path, reason: 'no changes' });
      continue;
    }
    const id = s.id ?? uniqueId(toKebab(s.title), taken);
    taken.add(id);
    const screen: Screen = {
      id,
      title: s.title,
      section: section ?? null,
      path: s.path,
      ...(s.route ? { route: s.route } : {}),
      source: 'claude',
      states: [...new Set(s.states ?? ['default'])],
      ...(s.position ? { position: s.position } : {}),
    };
    c.screens.push(screen);
    plan.added.push(screen);
  }
  return plan;
}

export function registerDiscoveryTools(tool: ToolRegistrar, ctx: ServerContext): void {
  tool(
    'scan_routes',
    {
      title: 'Scan routes',
      description: `Statically find the app's routes in the project code (no running app or canvas needed). Detects the framework from package.json and reads Next.js App and Pages Router, Nuxt, SvelteKit, Remix / React Router v7 (flat routes and app/routes.ts), Astro and TanStack Router file routes, plus code-defined React Router (createBrowserRouter arrays, <Route> JSX trees), Vue Router (createRouter({ routes })) and TanStack Router (createRoute) configs, resolving nested and index routes. Returns candidates { route, file, line, framework, kind, name, dynamicParams, sampleHints, samplePath, guards } (route patterns use :id, :id?, :slug+ and :slug*), skipped entries (redirects, not-found catch-alls, parallel / intercepting routes) and notes. sampleHints are real values for dynamic params found in fixtures, seed data and mocks. In a monorepo pass dir (the app folder). Step 1 of the ${DISCOVER_PROMPT} recipe.`,
      input: {
        dir: z.string().optional().describe('Folder to scan, absolute or relative to the project (default: the project folder)'),
        includeTests: z.boolean().optional().describe('Also read test and story files (default false)'),
      },
      readOnly: true,
    },
    async ({ dir, includeTests }) => {
      const abs = dir ? path.resolve(ctx.store.dir, dir) : ctx.store.dir;
      let r;
      try {
        r = await scanRoutes(abs, { includeTests });
      } catch (e) {
        throw new ToolError(`scan_routes: ${(e as Error).message}`);
      }
      const dynamic = r.routes.filter((x) => x.dynamicParams.length).length;
      return {
        ...r,
        summary: `${r.routes.length} routes (${dynamic} dynamic) in ${r.apps.map((a) => `${a.dir} [${a.frameworks.join(', ') || 'no router dependency'}]`).join('; ')}; ${r.skipped.length} skipped.`,
        next: 'Open each route file to find its states and pick real sample values, then call add_screens once with all screens.',
      };
    },
  );

  tool(
    'add_screens',
    {
      title: 'Add screens (batch)',
      description:
        'Add many screens in ONE write: one canvas undo step labelled "Claude: discovered N screens". Each screen: title, path (a concrete sample the canvas loads, e.g. /product/canele-plate), route (the pattern, e.g. /product/:id), section (id or title; missing sections are created, or declare them in sections with a color), states (first = default; built-in names default, loading, empty, partial, error, success get colored badges). id defaults to the kebab-case title. Leave out position so the canvas lays new screens out by section. mode "add" (default) skips screens already on the canvas (same id, route or path); "merge" updates them instead (title, path, route, section; new states are appended). The whole batch is validated first (path must be concrete and match route, no duplicates); on any error nothing is written. Marks screens source "claude". Returns added, updated, skipped and sectionsCreated.',
      input: {
        screens: z.array(ScreenIn).min(1).max(300),
        sections: z.array(SectionIn).optional().describe('Optional section declarations (title, color, parent) for sections the screens use'),
        mode: z.enum(['add', 'merge']).optional().describe('add (default): skip existing screens; merge: update them'),
      },
      write: true,
    },
    async ({ screens, sections, mode }) => {
      validateBatch(screens);
      const m = mode ?? 'add';
      const dry = planAddScreens(structuredClone(ctx.store.get()), screens, sections ?? [], m);
      const base = { mode: m, skipped: dry.skipped };
      if (!dry.added.length && !dry.updated.length && !dry.sectionsCreated.length) {
        return { ...base, added: [], updated: [], sectionsCreated: [], note: 'Nothing changed: every screen is already on the canvas.' };
      }
      const parts = [`discovered ${dry.added.length} screen${dry.added.length === 1 ? '' : 's'}`];
      if (dry.updated.length) parts.push(`updated ${dry.updated.length}`);
      const { config, result } = await ctx.store.mutate(parts.join(', '), (c) => planAddScreens(c, screens, sections ?? [], m), 'claude');
      return {
        mode: m,
        added: result.added.map((s) => ({ id: s.id, title: s.title, path: s.path, ...(s.route ? { route: s.route } : {}), section: s.section, states: s.states })),
        updated: result.updated,
        skipped: result.skipped,
        sectionsCreated: result.sectionsCreated.map((s) => ({ id: s.id, title: s.title, color: s.color })),
        totalScreens: config.screens.length,
        canvas: ctx.link?.ready ? 'shown on the canvas as one undo step' : 'saved to the file; the canvas shows it when opened',
      };
    },
  );

  tool(
    'list_requests',
    {
      title: 'List canvas requests',
      description: `Requests the user made from the Flow Canvas tab for Claude, e.g. "Discover with Claude" (kind "discover": run the ${DISCOVER_PROMPT} prompt / ${DISCOVER_RECIPE_URI}). Pending by default. Do what each pending request asks, then call complete_request with its id. Requests live in the MCP server's memory until it restarts.`,
      input: { status: z.enum(['pending', 'done', 'all']).optional().describe('Default pending') },
      readOnly: true,
    },
    async ({ status }) => ({ requests: ctx.requests.list(status ?? 'pending') }),
  );

  tool(
    'complete_request',
    {
      title: 'Complete a canvas request',
      description: 'Mark a canvas request done (after doing what it asked) with a one-line summary; the canvas shows the summary to the user. Returns the request.',
      input: { id: z.string(), summary: z.string().max(500).optional() },
    },
    async ({ id, summary }) => {
      const r = ctx.requests.complete(id, summary);
      if (!r) {
        const pending = ctx.requests.list('pending').map((x) => x.id);
        throw new ToolError(`Unknown request "${id}". Pending: ${pending.join(', ') || '(none)'}.`);
      }
      ctx.link?.sendIfReady({ type: 'request-done', requestId: r.id, kind: r.kind, ...(summary ? { summary } : {}) });
      return { request: r };
    },
  );
}
