/**
 * Router sniffing (feature 2, source 2), MAIN world. Reads the app's router
 * from known globals and from the React fiber tree, best effort:
 *   - never throws (every read is guarded), never writes to the app,
 *   - stops after `budgetMs` and after `MAX_NODES` fibers.
 * Output: flat route paths with nesting resolved, still in the framework's own
 * syntax ("/product/[id]" for Next.js, "/users/:id(\\d+)" for Vue); the canvas
 * turns them into patterns (lib/canvas/sniff.ts), which keeps mock.js small.
 * `auth` is set only when a guard or a redirecting loader is visible on the
 * route (or a parent), never from its name.
 * Fetching manifests (Next.js, SvelteKit) happens on the canvas side.
 */
import type { SniffedRoute } from '@flowcanvas/protocol/lite';
import { joinPattern, normPattern } from '../routes/pattern';

export interface SniffResult {
  framework: string | null;
  routes: SniffedRoute[];
  meta?: Record<string, string>;
}

type O = Record<string, unknown>;
const MAX_NODES = 30_000;
const MAX_ROUTES = 1000;

/** Guarded property read. */
export function get(o: unknown, k: string): unknown {
  if (o === null || (typeof o !== 'object' && typeof o !== 'function')) return undefined;
  try {
    return (o as O)[k];
  } catch {
    return undefined;
  }
}
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const fnSource = (f: unknown): string => {
  if (typeof f !== 'function') return '';
  try {
    return Function.prototype.toString.call(f).slice(0, 4000);
  } catch {
    return '';
  }
};

/** A loader / guard whose source visibly redirects. */
export const redirects = (f: unknown): boolean => /\bredirect(Document)?\s*\(|\breplace\s*\(\s*['"`]\/|\bnavigate\s*\(\s*['"`]\//.test(fnSource(f));

/** Element types that wrap a route in an auth guard (RequireAuth, ProtectedRoute, PrivateRoute, AuthGuard). */
const GUARD_NAME = /^(Require|Protected|Private|Auth|Guard|Authenticated|SignedIn)\w*(Route|Auth|Guard|Outlet)?$|Guard$|^RequireAuth/;
function elementIsGuard(el: unknown): boolean {
  const t = get(el, 'type');
  const name = str(get(t, 'displayName')) ?? str(get(t, 'name')) ?? '';
  return !!name && GUARD_NAME.test(name);
}

class Collector {
  private seen = new Map<string, SniffedRoute>();
  add(path: string, auth = false, name?: string) {
    const p = normPattern(path);
    const prev = this.seen.get(p);
    if (prev) {
      if (auth) prev.auth = true;
      if (name && !prev.name) prev.name = name;
      return;
    }
    if (this.seen.size >= MAX_ROUTES) return;
    const r: SniffedRoute = { path: p };
    if (auth) r.auth = true;
    if (name) r.name = name;
    this.seen.set(p, r);
  }
  get list(): SniffedRoute[] {
    return [...this.seen.values()];
  }
}

/* ------------------------------ React Router ----------------------------- */

/** Data-router route objects (createBrowserRouter / RouterProvider): { path, index, children, loader, element }. */
export function flattenReactRoutes(routes: unknown, base = '/', out = new Collector(), guarded = false, depth = 0): Collector {
  if (depth > 30) return out;
  for (const r of arr(routes)) {
    const path = str(get(r, 'path'));
    const index = get(r, 'index') === true;
    const here = path !== undefined ? joinPattern(base, path) : base;
    const auth = guarded || redirects(get(r, 'loader')) || elementIsGuard(get(r, 'element'));
    if (index || path !== undefined) out.add(here, auth);
    flattenReactRoutes(get(r, 'children'), here, out, auth, depth + 1);
  }
  return out;
}

const REACT_ELEMENT = (x: unknown) => {
  const t = get(x, '$$typeof');
  return typeof t === 'symbol' && /react\.(transitional\.)?element/.test(t.toString());
};
const FRAGMENT = Symbol.for('react.fragment');

/** <Route> elements under a <Routes> → route objects (what createRoutesFromChildren does, read-only). */
export function routesFromElements(children: unknown, depth = 0): O[] {
  const out: O[] = [];
  if (depth > 30) return out;
  const list = Array.isArray(children) ? children.flat(Infinity as 1) : [children];
  for (const el of list) {
    if (!REACT_ELEMENT(el)) continue;
    const props = get(el, 'props');
    if (get(el, 'type') === FRAGMENT) {
      out.push(...routesFromElements(get(props, 'children'), depth + 1));
      continue;
    }
    const path = get(props, 'path');
    const index = get(props, 'index');
    if (typeof path !== 'string' && index !== true && !REACT_ELEMENT(get(props, 'element')) && !get(props, 'Component')) continue;
    out.push({ path, index, loader: get(props, 'loader'), element: get(props, 'element'), children: routesFromElements(get(props, 'children'), depth + 1) });
  }
  return out;
}

/** True when a fiber's children look like a <Routes> body (every element is a Route-like element). */
function isRoutesBody(children: unknown): boolean {
  const list = (Array.isArray(children) ? children.flat(Infinity as 1) : [children]).filter((c) => c != null && c !== false);
  if (!list.length) return false;
  return list.every((el) => {
    if (!REACT_ELEMENT(el)) return false;
    if (get(el, 'type') === FRAGMENT) return isRoutesBody(get(get(el, 'props'), 'children'));
    const p = get(el, 'props');
    return typeof get(p, 'path') === 'string' || get(p, 'index') === true;
  });
}

/** Root fibers of React apps on the page (createRoot: __reactContainer$*, legacy: _reactRootContainer). */
export function reactRoots(doc: Document): unknown[] {
  const out: unknown[] = [];
  const els: Element[] = [];
  for (const id of ['root', 'app', '__next', 'main']) {
    const e = doc.getElementById(id);
    if (e) els.push(e);
  }
  if (doc.body) els.push(doc.body, ...Array.from(doc.body.children).slice(0, 50));
  for (const el of els) {
    let keys: string[];
    try {
      keys = Object.keys(el);
    } catch {
      continue;
    }
    const k = keys.find((x) => x.startsWith('__reactContainer$'));
    if (k) out.push(get(el, k));
    const legacy = get(get(get(el, '_reactRootContainer'), '_internalRoot'), 'current');
    if (legacy) out.push(legacy);
  }
  return [...new Set(out)];
}

/** Pattern of the routes matched above a nested <Routes> (RouteContext matches), for descendant routes. */
function nestedBase(fiber: unknown): string {
  for (let f = get(fiber, 'return'), i = 0; f && i < 500; f = get(f, 'return'), i++) {
    const matches = arr(get(get(get(f, 'memoizedProps'), 'value'), 'matches'));
    if (!matches.length) continue;
    let base = '/';
    for (const m of matches) {
      const p = str(get(get(m, 'route'), 'path'));
      if (p) base = joinPattern(base, p.replace(/\/?\*$/, ''));
    }
    return base;
  }
  return '/';
}

/** Walk React fibers for a data router (router.routes) or <Routes><Route path> elements. */
export function sniffReactFibers(doc: Document, deadline: number): SniffResult | null {
  const roots = reactRoots(doc);
  if (!roots.length) return null;
  const out = new Collector();
  let kind: string | null = null;
  const stack = [...roots];
  let n = 0;
  while (stack.length && n++ < MAX_NODES) {
    if ((n & 255) === 0 && Date.now() > deadline) break;
    const f = stack.pop();
    const props = get(f, 'memoizedProps');
    const router = get(props, 'router') ?? get(get(props, 'value'), 'router');
    const routes = get(router, 'routes');
    if (Array.isArray(routes) && routes.length) {
      flattenReactRoutes(routes, '/', out);
      return { framework: 'react-router', routes: out.list, meta: { router: 'data' } };
    }
    const children = get(props, 'children');
    if (children && typeof get(f, 'type') === 'function' && isRoutesBody(children)) {
      kind = 'react-router';
      flattenReactRoutes(routesFromElements(children), nestedBase(f), out);
    }
    const sib = get(f, 'sibling');
    if (sib) stack.push(sib);
    const child = get(f, 'child');
    if (child) stack.push(child);
  }
  return kind ? { framework: kind, routes: out.list, meta: { router: 'elements' } } : null;
}

/** Remix / React Router framework mode: route manifest { id: { id, parentId, path, index } }. */
export function sniffRouteManifest(win: unknown): SniffResult | null {
  const rr = get(win, '__reactRouterManifest');
  const remix = get(win, '__remixManifest');
  const manifest = get(rr ?? remix, 'routes');
  if (!manifest || typeof manifest !== 'object') return null;
  const byParent = new Map<string, O[]>();
  for (const id of Object.keys(manifest as O)) {
    const r = get(manifest, id) as O;
    const parent = str(get(r, 'parentId')) ?? '';
    byParent.set(parent, [...(byParent.get(parent) ?? []), r]);
  }
  const tree = (parent: string, depth: number): O[] =>
    depth > 30 ? [] : (byParent.get(parent) ?? []).map((r) => ({ path: get(r, 'path'), index: get(r, 'index'), children: tree(str(get(r, 'id')) ?? '', depth + 1) }));
  const out = flattenReactRoutes(tree('', 0));
  return { framework: rr ? 'react-router-framework' : 'remix', routes: out.list };
}

/* --------------------------------- Vue ---------------------------------- */

/** Vue Router via the mounted app ([data-v-app] / #__nuxt / #app → __vue_app__ → $router.getRoutes()). */
export function sniffVue(doc: Document, win: unknown): SniffResult | null {
  const els = [doc.querySelector('[data-v-app]'), doc.getElementById('__nuxt'), doc.getElementById('app')];
  let app: unknown;
  for (const e of els) {
    app = get(e, '__vue_app__');
    if (app) break;
  }
  if (!app) return null;
  const nuxt = !!get(win, '__NUXT__') || !!get(win, 'useNuxtApp') || !!doc.getElementById('__nuxt');
  const gp = get(get(app, 'config'), 'globalProperties');
  const router = get(gp, '$router') ?? get(get(gp, '$nuxt'), '$router');
  const getRoutes = get(router, 'getRoutes');
  if (typeof getRoutes !== 'function') return { framework: nuxt ? 'nuxt' : 'vue', routes: [] };
  let records: unknown[];
  try {
    records = arr((getRoutes as () => unknown).call(router));
  } catch {
    return { framework: nuxt ? 'nuxt' : 'vue', routes: [] };
  }
  const out = new Collector();
  const guarded: string[] = [];
  for (const r of records) {
    const path = str(get(r, 'path'));
    if (path === undefined) continue;
    const meta = get(r, 'meta');
    const guard = !!get(r, 'beforeEnter') || get(meta, 'requiresAuth') === true || get(meta, 'auth') === true || typeof get(meta, 'middleware') === 'string' && /auth/i.test(String(get(meta, 'middleware')));
    if (guard) guarded.push(normPattern(path));
  }
  for (const r of records) {
    const path = str(get(r, 'path'));
    if (path === undefined || get(r, 'redirect')) continue;
    const np = normPattern(path);
    const auth = guarded.some((g) => np === g || np.startsWith(g === '/' ? '/' : `${g}/`));
    const name = get(r, 'name');
    out.add(path, auth, typeof name === 'string' ? name : undefined);
  }
  return { framework: nuxt ? 'nuxt' : 'vue', routes: out.list };
}

/* -------------------------------- Next.js -------------------------------- */

/** Pages Router: __NEXT_DATA__ (page, buildId) + __BUILD_MANIFEST.sortedPages. App Router: dev flight data names the page module. */
export function sniffNext(win: unknown): SniffResult | null {
  const data = get(win, '__NEXT_DATA__');
  const flight = get(win, '__next_f');
  if (!data && !Array.isArray(flight)) return null;
  const out = new Collector();
  const meta: Record<string, string> = {};
  const buildId = str(get(data, 'buildId'));
  if (buildId) meta.buildId = buildId;
  const page = str(get(data, 'page'));
  if (page) {
    meta.page = page;
    meta.router = 'pages';
  }
  for (const p of arr(get(get(win, '__BUILD_MANIFEST'), 'sortedPages'))) if (typeof p === 'string') addNextPage(out, p);
  if (page) addNextPage(out, page);
  if (Array.isArray(flight)) {
    meta.router = page ? 'pages+app' : 'app';
    for (const p of appPagesFromFlight(flight)) out.add(p);
  }
  return { framework: 'next', routes: out.list, meta };
}

const addNextPage = (out: Collector, page: string) => out.add(page);

/** App Router page modules named in RSC flight chunks (dev): "(rsc)/./app/studio/[id]/page.js" → "/studio/:id". */
export function appPagesFromFlight(flight: unknown[]): string[] {
  const out = new Set<string>();
  let budget = 2_000_000;
  for (const chunk of flight.slice(0, 500)) {
    const s = arr(chunk).find((x) => typeof x === 'string') as string | undefined;
    if (!s) continue;
    budget -= s.length;
    if (budget < 0) break;
    for (const m of s.matchAll(/\.\/(?:src\/)?app((?:\/[^/"\\]+)*)\/page\.(?:js|jsx|ts|tsx|mdx)/g)) out.add(m[1] || '/');
  }
  return [...out];
}

/* ------------------------- SvelteKit and Angular ------------------------- */

/** SvelteKit exposes only `__sveltekit_<hash>` (base, env): the route dictionary is fetched on the canvas side. */
export function sniffSvelteKit(win: unknown): SniffResult | null {
  let keys: string[];
  try {
    keys = Object.keys(win as O);
  } catch {
    return null;
  }
  const k = keys.find((x) => x.startsWith('__sveltekit_'));
  if (!k) return null;
  return { framework: 'sveltekit', routes: [], meta: { base: str(get(get(win, k), 'base')) ?? '' } };
}

/** Angular route config: `config` arrays of { path, children, canActivate }. */
export function flattenAngular(config: unknown, base = '/', out = new Collector(), guarded = false, depth = 0): Collector {
  if (depth > 30) return out;
  for (const r of arr(config)) {
    const path = str(get(r, 'path'));
    if (path === undefined || get(r, 'redirectTo') !== undefined) continue;
    const here = joinPattern(base, path);
    const auth = guarded || arr(get(r, 'canActivate')).length > 0 || arr(get(r, 'canMatch')).length > 0 || arr(get(r, 'canActivateChild')).length > 0;
    const children = get(r, 'children');
    if (get(r, 'component') || get(r, 'loadComponent') || !children) out.add(here, auth);
    flattenAngular(children, here, out, auth, depth + 1);
  }
  return out;
}

/** Angular (dev mode, window.ng): look for an injected Router (an object with a `config` route array) on the root component. Best effort. */
export function sniffAngular(doc: Document, win: unknown): SniffResult | null {
  const ng = get(win, 'ng');
  const root = doc.querySelector('[ng-version]');
  if (!root) return null;
  const getComponent = get(ng, 'getComponent');
  let comp: unknown;
  try {
    comp = typeof getComponent === 'function' ? (getComponent as (e: Element) => unknown).call(ng, root) : undefined;
  } catch {
    comp = undefined;
  }
  let config: unknown;
  if (comp) {
    let keys: string[];
    try {
      keys = Object.keys(comp as O);
    } catch {
      keys = [];
    }
    for (const k of keys) {
      const c = get(get(comp, k), 'config');
      if (Array.isArray(c) && c.some((r) => typeof get(r, 'path') === 'string')) {
        config = c;
        break;
      }
    }
  }
  const out = flattenAngular(config);
  return { framework: 'angular', routes: out.list, meta: { confidence: 'best-effort' } };
}

/* -------------------------------- Entry ---------------------------------- */

/**
 * Try every sniffer; the first that recognises a framework wins (Next.js and
 * framework-mode manifests before the fiber walk, which would also find them).
 */
export function sniffRoutes(win: Window, budgetMs = 1500): SniffResult {
  const deadline = Date.now() + budgetMs;
  const doc = win.document;
  const tries: Array<() => SniffResult | null> = [
    () => sniffNext(win),
    () => sniffRouteManifest(win),
    () => sniffVue(doc, win),
    () => sniffReactFibers(doc, deadline),
    () => sniffSvelteKit(win),
    () => sniffAngular(doc, win),
  ];
  let fallback: SniffResult | null = null;
  for (const t of tries) {
    if (Date.now() > deadline) break;
    let r: SniffResult | null;
    try {
      r = t();
    } catch {
      r = null;
    }
    if (!r) continue;
    if (r.routes.length) return r;
    fallback ??= r;
  }
  return fallback ?? { framework: null, routes: [] };
}
