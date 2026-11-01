/**
 * File-system routing conventions: Next.js (App and Pages Router), Nuxt,
 * SvelteKit, Remix / React Router v7 flat routes, TanStack Router file
 * routes and Astro. Each turns file paths into route patterns (see pattern.ts).
 */
import path from 'node:path';
import { lineAt, readText, type WalkedFile } from './files.js';
import { normalizeRoute } from './pattern.js';
import type { Framework, RawRoute, RouteKind, SkippedRoute } from './types.js';

export interface ConventionResult {
  routes: RawRoute[];
  skipped: SkippedRoute[];
}

type Files = Map<string, WalkedFile>;

/* ------------------------------------------------------------------ */
/* shared                                                              */
/* ------------------------------------------------------------------ */

/** Words in code that usually mean "this route needs a signed-in user". */
const AUTH_RE =
  /\b(requireAuth\w*|requireUser\w*|requireSession|requireLogin|requireAdmin|ensureAuth\w*|ensureLoggedIn|isAuthenticated|getServerSession|currentUser|useAuth|withAuth|withPageAuthRequired|authenticate|ProtectedRoute|RequireAuth|PrivateRoute|AuthGuard|AuthRequired|RedirectToSignIn|authGuard|requiresAuth|clerkMiddleware|authMiddleware)\b|export\s+default\s+auth\b|\bauth\(\s*\)|middleware:\s*\[?\s*['"]auth[\w-]*['"]|redirect\(\s*(?:\d{3}\s*,\s*)?['"`]\/(?:login|signin|sign-in|auth)\b/;

/** First auth marker in a file, e.g. "requireUser in app/routes/dashboard.tsx". */
export async function authMarker(f: WalkedFile | undefined): Promise<string | null> {
  if (!f) return null;
  const t = await readText(f.abs);
  if (!t) return null;
  const m = authMarkerIn(t);
  return m ? `${m} in ${f.rel}` : null;
}

export function authMarkerIn(text: string): string | null {
  const m = AUTH_RE.exec(text);
  if (!m) return null;
  const s = m[0].replace(/\s+/g, ' ');
  if (s.startsWith('redirect')) return `redirect to ${s.replace(/^.*['"`]/, '')}`;
  if (s.startsWith('middleware')) return 'auth middleware';
  return s.replace(/[(\s]+\)?$/, '').slice(0, 40);
}

async function guardsFor(files: Array<WalkedFile | undefined>): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    const g = await authMarker(f);
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

/** `[id]` → `:id`, `[...slug]` → `:slug+` (or `:slug*`), `[[...slug]]` → `:slug*`, `[[id]]` → `:id?`, `[id=matcher]` → `:id`. */
export function bracketSegment(seg: string, restRequired: boolean): string {
  return seg
    .replace(/\[\[\.\.\.([\w$]+)(?:=[\w-]+)?\]\]/g, ':$1*')
    .replace(/\[\.\.\.([\w$]+)(?:=[\w-]+)?\]/g, restRequired ? ':$1+' : ':$1*')
    .replace(/\[\[([\w$]+)(?:=[\w-]+)?\]\]/g, ':$1?')
    .replace(/\[([\w$]+)(?:=[\w-]+)?\]/g, ':$1');
}

const isGroup = (s: string) => /^\(.+\)$/.test(s);

function kindOf(route: string, index: boolean): RouteKind {
  if (/:[\w$]+[*+]/.test(route)) return 'catch-all';
  return index ? 'index' : 'page';
}

function titleHint(route: string, fallback: string): string {
  const segs = route
    .split('/')
    .map((s) => s.replace(/:[\w$]+[?*+]?/g, '').replace(/^[-_.]+|[-_.]+$/g, ''))
    .filter(Boolean);
  return segs.at(-1) ?? fallback;
}

/** Literal values for params inside generateStaticParams / getStaticPaths / entries(). */
export function staticParamsIn(text: string, params: string[]): Record<string, string[]> | undefined {
  const at = text.search(/\b(generateStaticParams|getStaticPaths|export\s+(?:const|function|async function)\s+entries)\b/);
  if (at < 0 || !params.length) return undefined;
  const body = text.slice(at, at + 20_000);
  const out: Record<string, string[]> = {};
  for (const p of params) {
    const re = new RegExp(`["']?\\b${p.replace(/[$]/g, '\\$')}["']?\\s*:\\s*["'\`]([^"'\`$\\n]{1,80})["'\`]`, 'g');
    const vals = [...new Set([...body.matchAll(re)].map((m) => m[1]!))].slice(0, 5);
    if (vals.length) out[p] = vals;
  }
  return Object.keys(out).length ? out : undefined;
}

function paramNames(route: string): string[] {
  return [...route.matchAll(/:([\w$]+)/g)].map((m) => m[1]!);
}

async function withStatic(r: RawRoute, f: WalkedFile): Promise<RawRoute> {
  const names = paramNames(r.route);
  if (!names.length) return r;
  const t = await readText(f.abs);
  const sp = t ? staticParamsIn(t, names) : undefined;
  return sp ? { ...r, staticParams: sp } : r;
}

/** Ancestor-folder files matching `names` (e.g. layout.tsx) for a file under `dir`. */
function ancestors(files: Files, rootDir: string, dirSegs: string[], names: RegExp): WalkedFile[] {
  const out: WalkedFile[] = [];
  for (let i = 0; i <= dirSegs.length; i++) {
    const d = [rootDir, ...dirSegs.slice(0, i)].filter(Boolean).join('/');
    for (const [rel, f] of files) {
      if (path.posix.dirname(rel) === d && names.test(path.posix.basename(rel))) out.push(f);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Next.js App Router                                                  */
/* ------------------------------------------------------------------ */

export async function nextApp(files: Files): Promise<ConventionResult> {
  const routes: RawRoute[] = [];
  const skipped: SkippedRoute[] = [];
  for (const f of files.values()) {
    const m = /^((?:src\/)?app)\/(?:(.*)\/)?page\.(tsx|jsx|ts|js|mdx|md)$/.exec(f.rel);
    if (!m) continue;
    const dirs = m[2] ? m[2].split('/') : [];
    const out: string[] = [];
    const intercept = dirs.find((d) => /^\(\.{1,3}\)|^(\(\.\.\))+/.test(d));
    let skip: string | null = intercept
      ? `intercepting route ${intercept} (usually a modal shown over another route: model it as a state of that screen)`
      : null;
    for (const seg of skip ? [] : dirs) {
      if (seg.startsWith('@')) {
        skip = `parallel route slot ${seg} (renders inside a layout next to other content; often a modal or panel state)`;
        break;
      }
      if (/^\(\.{1,3}\)|^(\(\.\.\))+/.test(seg)) {
        skip = `intercepting route ${seg} (usually a modal shown over another route: model it as a state of that screen)`;
        break;
      }
      if (seg.startsWith('_')) {
        skip = `private folder ${seg} (not routed)`;
        break;
      }
      if (isGroup(seg)) continue;
      out.push(bracketSegment(seg, true));
    }
    const route = normalizeRoute(out.join('/'));
    if (skip) {
      skipped.push({ file: f.rel, reason: skip });
      continue;
    }
    const guards = await guardsFor([f, ...ancestors(files, m[1]!, dirs, /^(layout|template)\.(tsx|jsx|ts|js)$/)]);
    routes.push(await withStatic({ route, file: f.rel, framework: 'next-app', kind: kindOf(route, false), name: titleHint(route, 'home'), guards }, f));
  }
  return { routes, skipped };
}

/* ------------------------------------------------------------------ */
/* Next.js Pages Router                                                */
/* ------------------------------------------------------------------ */

export async function nextPages(files: Files): Promise<ConventionResult> {
  const routes: RawRoute[] = [];
  const skipped: SkippedRoute[] = [];
  for (const f of files.values()) {
    const m = /^(?:src\/)?pages\/(.*)\.(tsx|jsx|ts|js|mdx|md)$/.exec(f.rel);
    if (!m) continue;
    const segs = m[1]!.split('/');
    if (segs[0] === 'api') continue;
    if (segs.length === 1 && /^_(app|document|error|middleware)$/.test(segs[0]!)) continue;
    if (segs.length === 1 && /^(404|500)$/.test(segs[0]!)) {
      skipped.push({ file: f.rel, reason: `special page ${segs[0]} (error page, not a route)` });
      continue;
    }
    const index = segs.at(-1) === 'index';
    if (index) segs.pop();
    const route = normalizeRoute(segs.map((s) => bracketSegment(s, true)).join('/'));
    const guards = await guardsFor([f]);
    routes.push(await withStatic({ route, file: f.rel, framework: 'next-pages', kind: kindOf(route, index), name: titleHint(route, 'home'), guards }, f));
  }
  return { routes, skipped };
}

/* ------------------------------------------------------------------ */
/* Nuxt                                                                */
/* ------------------------------------------------------------------ */

export async function nuxt(files: Files): Promise<ConventionResult> {
  const routes: RawRoute[] = [];
  const all = [...files.keys()];
  for (const f of files.values()) {
    const m = /^((?:app\/)?pages)\/(.*)\.vue$/.exec(f.rel);
    if (!m) continue;
    const segs = m[2]!.split('/');
    const index = segs.at(-1) === 'index';
    const isLayout = !index && all.some((r) => r.startsWith(`${m[1]}/${m[2]}/`));
    if (index) segs.pop();
    const route = normalizeRoute(
      segs
        .filter((s) => !isGroup(s))
        .map((s) => bracketSegment(s, false))
        .join('/'),
    );
    const guards = await guardsFor([f]);
    routes.push({ route, file: f.rel, framework: 'nuxt', kind: isLayout ? 'layout' : kindOf(route, index), name: titleHint(route, 'home'), guards });
  }
  return { routes, skipped: [] };
}

/* ------------------------------------------------------------------ */
/* SvelteKit                                                           */
/* ------------------------------------------------------------------ */

export async function sveltekit(files: Files): Promise<ConventionResult> {
  const routes: RawRoute[] = [];
  for (const f of files.values()) {
    const m = /^src\/routes\/(?:(.*)\/)?\+page(?:@[^.]*)?\.svelte$/.exec(f.rel);
    if (!m) continue;
    const dirs = m[1] ? m[1].split('/') : [];
    const route = normalizeRoute(
      dirs
        .filter((s) => !isGroup(s))
        .map((s) => bracketSegment(s, false))
        .join('/'),
    );
    const dir = path.posix.dirname(f.rel);
    const sibling = (n: string) => files.get(`${dir}/${n}`);
    const guards = await guardsFor([
      f,
      sibling('+page.server.ts'),
      sibling('+page.server.js'),
      sibling('+page.ts'),
      sibling('+page.js'),
      ...ancestors(files, 'src/routes', dirs, /^\+layout(\.server)?\.(ts|js)$/),
    ]);
    let r: RawRoute = { route, file: f.rel, framework: 'sveltekit', kind: kindOf(route, false), name: titleHint(route, 'home'), guards };
    for (const s of ['+page.server.ts', '+page.server.js', '+page.ts', '+page.js']) {
      const sf = sibling(s);
      if (sf && !r.staticParams) r = await withStatic(r, sf);
    }
    routes.push(r);
  }
  return { routes, skipped: [] };
}

/* ------------------------------------------------------------------ */
/* Astro                                                               */
/* ------------------------------------------------------------------ */

export async function astro(files: Files): Promise<ConventionResult> {
  const routes: RawRoute[] = [];
  const skipped: SkippedRoute[] = [];
  for (const f of files.values()) {
    const m = /^src\/pages\/(.*)\.(astro|md|mdx|markdown|html)$/.exec(f.rel);
    if (!m) continue;
    const segs = m[1]!.split('/');
    if (segs.some((s) => s.startsWith('_'))) continue;
    if (segs.length === 1 && /^(404|500)$/.test(segs[0]!)) {
      skipped.push({ file: f.rel, reason: `special page ${segs[0]} (error page, not a route)` });
      continue;
    }
    const index = segs.at(-1) === 'index';
    if (index) segs.pop();
    const route = normalizeRoute(segs.map((s) => bracketSegment(s, false)).join('/'));
    const guards = await guardsFor([f]);
    routes.push(await withStatic({ route, file: f.rel, framework: 'astro', kind: kindOf(route, index), name: titleHint(route, 'home'), guards }, f));
  }
  return { routes, skipped };
}

/* ------------------------------------------------------------------ */
/* Remix / React Router v7 flat routes, TanStack Router file routes    */
/* ------------------------------------------------------------------ */

/** Split a flat route name on dots outside [escapes]. */
export function flatParts(name: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of name) {
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === '.' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

type FlatStyle = 'remix' | 'tanstack';

/** One flat-route part → URL segment ('' = none), or 'index'. */
function flatSegment(part: string, style: FlatStyle): { seg: string; index?: boolean } {
  if (style === 'remix' && part === '_index') return { seg: '', index: true };
  if (style === 'tanstack' && (part === 'index' || part === '_index')) return { seg: '', index: true };
  if (style === 'tanstack' && part === 'route') return { seg: '' };
  if (isGroup(part) && !/^\(\$/.test(part)) return { seg: '' }; // (group), or optional static segment: dropped
  if (part.startsWith('_')) return { seg: '' }; // pathless layout
  let p = part.endsWith('_') && part.length > 1 ? part.slice(0, -1) : part;
  const opt = /^\(\$([\w$]+)\)$/.exec(p) ?? /^\{-\$([\w$]+)\}$/.exec(p);
  if (opt) return { seg: `:${opt[1]}?` };
  if (p === '$') return { seg: ':splat*' };
  if (p.startsWith('$')) return { seg: `:${p.slice(1)}` };
  p = p.replace(/\[([^\]]*)\]/g, '$1');
  return { seg: p };
}

function flatRoute(parts: string[], style: FlatStyle): { route: string; index: boolean } {
  let index = false;
  const segs: string[] = [];
  for (const part of parts) {
    const s = flatSegment(part, style);
    if (s.index) index = true;
    if (s.seg) segs.push(s.seg);
  }
  return { route: normalizeRoute(segs.join('/')), index };
}

/** Remix v2 / React Router v7 `app/routes/*` flat routes. */
export async function remixFlat(files: Files, framework: Framework = 'remix', routesDir = 'app/routes'): Promise<ConventionResult> {
  const routes: RawRoute[] = [];
  const skipped: SkippedRoute[] = [];
  const named: Array<{ name: string; f: WalkedFile }> = [];
  const esc = routesDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const f of files.values()) {
    const flat = new RegExp(`^${esc}/([^/]+)\\.(tsx|jsx|ts|js|mdx|md)$`).exec(f.rel);
    const folder = new RegExp(`^${esc}/([^/]+)/route\\.(tsx|jsx|ts|js|mdx|md)$`).exec(f.rel);
    const name = flat?.[1] ?? folder?.[1];
    if (!name) continue;
    if (/\.(server|client)$/.test(name)) continue;
    named.push({ name, f });
  }
  const names = named.map((n) => n.name);
  for (const { name, f } of named) {
    const text = (await readText(f.abs)) ?? '';
    if (!/\.mdx?$/.test(f.rel) && !/export\s+default\b|export\s*\{[^}]*\bdefault\b/.test(text)) {
      skipped.push({ file: f.rel, reason: 'resource route (no default export, no UI)' });
      continue;
    }
    const parts = flatParts(name);
    const last = parts.at(-1)!;
    if (last.startsWith('_') && last !== '_index') continue; // pathless layout: no URL of its own
    const { route, index } = flatRoute(parts, 'remix');
    const isLayout = !index && names.some((n) => n.startsWith(`${name}.`));
    // Parent layouts: every proper prefix of the parts that is itself a route file.
    const parents = named.filter((n) => n.name !== name && name.startsWith(`${n.name}.`)).map((n) => n.f);
    const guards = await guardsFor([f, ...parents]);
    if (route === '/' && parts.length === 1 && parts[0] === '$') {
      skipped.push({ file: f.rel, route: '/:splat*', reason: 'catch-all (not-found page)' });
      continue;
    }
    routes.push({ route, file: f.rel, framework, kind: isLayout ? 'layout' : kindOf(route, index), name: titleHint(route, 'home'), guards });
  }
  return { routes, skipped };
}

function flatKey(rel: string): string {
  return rel
    .replace(/\.(tsx|jsx|ts|js)$/, '')
    .replace(/\.lazy$/, '')
    .split('/')
    .flatMap((p) => flatParts(p))
    .filter((p) => p !== 'route')
    .join('.');
}

/** TanStack Router file routes (src/routes or app/routes with __root.tsx). */
export async function tanstackFiles(files: Files, routesDir: string): Promise<ConventionResult> {
  const routes: RawRoute[] = [];
  const skipped: SkippedRoute[] = [];
  const prefix = `${routesDir}/`;
  for (const f of files.values()) {
    if (!f.rel.startsWith(prefix) || !/\.(tsx|jsx|ts|js)$/.test(f.rel)) continue;
    const rel = f.rel.slice(prefix.length).replace(/\.(tsx|jsx|ts|js)$/, '').replace(/\.lazy$/, '');
    const pieces = rel.split('/').flatMap((p) => flatParts(p));
    if (pieces.some((p) => p.startsWith('-')) || pieces[0] === '__root' || /routeTree\.gen$/.test(rel)) continue;
    const text = (await readText(f.abs)) ?? '';
    if (!/create(Lazy)?FileRoute\s*\(/.test(text)) continue;
    const own = (pieces.at(-1) === 'route' ? pieces.at(-2) : pieces.at(-1)) ?? '';
    if (own.startsWith('_') && own !== '_index') continue; // pathless layout
    const { route, index } = flatRoute(pieces, 'tanstack');
    const m = /create(?:Lazy)?FileRoute\s*\(/.exec(text);
    const guards: string[] = [];
    // This file and its parent layouts (files whose key is a prefix of this one's).
    const key = flatKey(f.rel.slice(prefix.length));
    for (const other of files.values()) {
      if (!other.rel.startsWith(prefix) || !/\.(tsx|jsx|ts|js)$/.test(other.rel)) continue;
      if (other !== f && !key.startsWith(`${flatKey(other.rel.slice(prefix.length))}.`)) continue;
      const t = other === f ? text : ((await readText(other.abs)) ?? '');
      if (/\bbeforeLoad\s*:/.test(t)) guards.push(`beforeLoad in ${other.rel}`);
      const g = authMarkerIn(t);
      if (g) guards.push(`${g} in ${other.rel}`);
    }
    if (route === '/' && pieces.length === 1 && pieces[0] === '$') {
      skipped.push({ file: f.rel, route: '/:splat*', reason: 'catch-all (not-found page)' });
      continue;
    }
    routes.push({ route, file: f.rel, line: m ? lineAt(text, m.index) : undefined, framework: 'tanstack-router', kind: kindOf(route, index), name: titleHint(route, 'home'), guards });
  }
  return { routes, skipped };
}
