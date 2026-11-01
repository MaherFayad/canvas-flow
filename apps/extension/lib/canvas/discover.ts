/**
 * Screen discovery (feature 2), pure parts:
 *   - Crawler: BFS over same-origin paths (links, sitemap, probe clicks), depth 3, max 60.
 *   - detectAuthWall: most pages land on the same other URL (a login page).
 *   - pickSamples: a real path for every dynamic route (crawl → SDK → inferred).
 *   - mergeDiscovery: SDK > router > crawl, de-duplicated by route pattern,
 *     never duplicating screens already in the config; one config change.
 */
import { toKebab, type FlowCanvasConfig, type Screen, type Section } from '@flowcanvas/config';
import type { ScreenDecl } from '@flowcanvas/protocol';
import { normPath } from '../url';
import { bestMatch, fillPattern, isCatchAll, isDynamic, matchPattern, normPattern, pathOnly } from '../routes/pattern';
import { UNSAFE_PATH } from '../routes/safety';
import { contentBottom, gridPositions } from './layout';
import { titleFromPath, uniqueScreenId } from './record';
import { SECTION_PAD, SECTION_TITLE_H } from './geometry';
import type { RouteFound } from './sniff';

export const UNSORTED = 'unsorted';
/** Paths never crawled (kept for callers of the old name). */
export const SKIP_CRAWL = UNSAFE_PATH;
/** Not pages: files the crawl must not load as screens. */
const FILE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|gz|xml|json|txt|css|m?js|map|woff2?|ttf|otf|mp4|webm|mp3|wav|csv|ics|webmanifest)$/i;

export const CRAWL_DEPTH = 3;
export const CRAWL_MAX_PAGES = 60;

/** BFS crawl state: follows same-origin paths `maxDepth` levels from `/`, at most `maxPages`. */
export class Crawler {
  private queue: Array<{ path: string; depth: number }> = [];
  private seen = new Set<string>();
  readonly visited: string[] = [];

  constructor(
    start = '/',
    private maxDepth = CRAWL_DEPTH,
    private maxPages = CRAWL_MAX_PAGES,
  ) {
    this.add(start, 0);
  }

  /** Queue a path found at `depth` (ignored past maxDepth, when unsafe, a file, or already seen). */
  add(path: string, depth: number): boolean {
    const p = normPath(path);
    if (depth > this.maxDepth || this.seen.has(p) || SKIP_CRAWL.test(p) || FILE_EXT.test(pathOnly(p))) return false;
    this.seen.add(p);
    this.queue.push({ path: p, depth });
    return true;
  }

  /** Mark a path as known without loading it (a redirect target that was already loaded). */
  know(path: string) {
    this.seen.add(normPath(path));
  }

  /** Next page to load, or null when done. */
  next(): { path: string; depth: number } | null {
    if (this.visited.length >= this.maxPages) return null;
    const n = this.queue.shift() ?? null;
    if (n) this.visited.push(n.path);
    return n;
  }

  /** Links found on a page loaded at `depth`. */
  addLinks(links: string[], depth: number) {
    for (const l of links) this.add(l, depth + 1);
  }

  get pending(): number {
    return this.queue.length;
  }

  stop() {
    this.queue = [];
  }
}

/* ------------------------------ auth wall -------------------------------- */

export interface Visit {
  requested: string;
  landed: string;
}

/** The URL that at least `min` different requested pages were redirected to (e.g. "/login"), or null. */
export function detectAuthWall(visits: Visit[], min = 3): string | null {
  const by = new Map<string, Set<string>>();
  for (const v of visits) {
    const req = pathOnly(v.requested);
    const land = pathOnly(v.landed);
    if (req === land) continue;
    const s = by.get(land) ?? new Set<string>();
    s.add(req);
    by.set(land, s);
  }
  for (const [land, reqs] of by) if (reqs.size >= min) return land;
  return null;
}

/* ------------------------------- samples --------------------------------- */

export type SampleFrom = 'crawl' | 'sdk' | 'inferred' | 'user';
export interface SampleChoice {
  path: string;
  from: SampleFrom;
}

const segs = (p: string) => normPattern(p).split('/').filter(Boolean);
const paramNames = (p: string) => segs(p).flatMap((s) => (s === '*' ? ['*'] : /^:(\w+)$/.test(s) ? [s.slice(1)] : []));

/**
 * A real path for every dynamic pattern: first a seen path (crawled links,
 * clicks, sitemap) that this pattern is the best match for, then an SDK path,
 * then one inferred from another sample sharing the same parameters in the
 * same prefix (/classes/:id/booked from /classes/tableware-course). The rest
 * is `missing` (ask the user once).
 */
export function pickSamples(patterns: string[], seen: string[], sdkPaths: string[]): { chosen: Map<string, SampleChoice>; missing: string[] } {
  const dyn = patterns.filter((p) => isDynamic(p) && !isCatchAll(p));
  const chosen = new Map<string, SampleChoice>();
  const claim = (list: string[], from: SampleFrom) => {
    for (const path of list) {
      const best = bestMatch(patterns, path);
      if (best && isDynamic(best) && !chosen.has(best) && dyn.includes(best)) chosen.set(best, { path: pathOnly(path), from });
    }
  };
  claim(seen, 'crawl');
  claim(sdkPaths, 'sdk');
  for (const q of dyn) {
    if (chosen.has(q)) continue;
    const need = paramNames(q).filter((n) => !segs(q).includes(`:${n}?`));
    if (!need.length) {
      const filled = fillPattern(q, {});
      if (filled) chosen.set(q, { path: filled, from: 'inferred' });
      continue;
    }
    let best: { shared: number; params: Record<string, string> } | null = null;
    for (const [p, c] of chosen) {
      if (c.from === 'inferred') continue;
      const a = segs(q);
      const b = segs(p);
      let shared = 0;
      while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
      const prefixParams = paramNames('/' + a.slice(0, shared).join('/'));
      if (!need.every((n) => prefixParams.includes(n))) continue;
      const params = matchPattern(p, c.path);
      if (params && (!best || shared > best.shared)) best = { shared, params };
    }
    const filled = best ? fillPattern(q, best.params) : null;
    if (filled && bestMatch(patterns, filled) === q) chosen.set(q, { path: filled, from: 'inferred' });
  }
  return { chosen, missing: dyn.filter((p) => !chosen.has(p)) };
}

/* -------------------------------- merge ---------------------------------- */

export type DiscoverySource = 'sdk' | 'router' | 'crawl';

export interface DiscoveryReport {
  framework: string | null;
  /** What each source found (SDK screens, router routes without the 404 catch-all, pages crawled). */
  found: Record<DiscoverySource, number>;
  /** Screens added to the project, per source. */
  added: Record<DiscoverySource, number>;
  /** Found but already in the project. */
  existing: number;
  /** Dynamic routes with no sample (not added). */
  needsSample: string[];
  samples: Array<{ route: string; path: string; from: SampleFrom }>;
  /** Routes with a visible guard / redirecting loader. */
  authRoutes: string[];
  /** Link-like elements not clicked because they look unsafe ("Log out: \"log out\""). */
  skippedClicks: string[];
  clicks: number;
  pages: number;
  /** Most pages redirected here (login page): "Login first". */
  authWall: string | null;
  ms: number;
}

export function emptyReport(): DiscoveryReport {
  return {
    framework: null,
    found: { sdk: 0, router: 0, crawl: 0 },
    added: { sdk: 0, router: 0, crawl: 0 },
    existing: 0,
    needsSample: [],
    samples: [],
    authRoutes: [],
    skippedClicks: [],
    clicks: 0,
    pages: 0,
    authWall: null,
    ms: 0,
  };
}

export interface MergeInput {
  sdk: ScreenDecl[] | null;
  routes: RouteFound[];
  /** Pages the crawl loaded (where they landed). */
  crawled: string[];
  /** Samples for dynamic routes (pattern → path); patterns without one are skipped. */
  samples: Map<string, SampleChoice>;
}

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** "/product/:id" → "Product detail", "/classes/:id/book" → "Book", "/" → "Home". */
export function titleFromPattern(pattern: string): string {
  const s = segs(pattern);
  if (!s.length) return 'Home';
  const stat = s.filter((x) => !x.startsWith(':') && x !== '*');
  const last = stat[stat.length - 1];
  if (!last) return 'Page';
  const words = titleCase(last.replace(/[-_]+/g, ' '));
  const t = words.charAt(0) + words.slice(1).toLowerCase();
  return isDynamic(s[s.length - 1]!) ? `${t} detail` : t;
}

/** Path with the dynamic segments removed: the base for a readable screen id. */
const idBase = (pattern: string) => '/' + segs(pattern).filter((x) => !x.startsWith(':') && x !== '*').join('/');

interface Candidate {
  key: string;
  path: string;
  route?: string;
  source: DiscoverySource;
  id?: string;
  title: string;
  states: string[];
  section: string;
  sectionTitle?: string;
}

/**
 * Merge every source into the config in one change. Priority SDK > router >
 * crawl by route pattern (a crawled path that matches a router route belongs to
 * that route). Screens already in the config are never duplicated: same route,
 * then same path, then an existing concrete path that the new route matches.
 */
export function mergeDiscovery(c: FlowCanvasConfig, input: MergeInput): { config: FlowCanvasConfig; added: Record<DiscoverySource, number>; existing: number; needsSample: string[] } {
  const routes = input.routes.filter((r) => !isCatchAll(r.pattern));
  const patterns = routes.map((r) => r.pattern);
  const keyOf = (path: string, declared?: string) => (declared ? normPattern(declared) : (bestMatch(patterns, path) ?? normPath(path)));

  const cands: Candidate[] = [];
  const claimed = new Set<string>();
  const push = (x: Candidate) => {
    if (claimed.has(x.key)) return;
    claimed.add(x.key);
    cands.push(x);
  };

  for (const d of input.sdk ?? []) {
    const path = d.path.startsWith('/') ? d.path : `/${d.path}`;
    const key = keyOf(path, d.route);
    const id = toKebab(d.id);
    // SDK screens are declared on purpose: two may share a route (different samples); only the id must be unique.
    if (cands.some((x) => x.id === id)) continue;
    claimed.add(key);
    cands.push({
      key,
      path,
      ...(isDynamic(key) ? { route: key } : {}),
      source: 'sdk',
      id,
      title: d.title ?? titleCase(d.id),
      states: d.states?.length ? d.states : ['default'],
      section: d.group ? toKebab(d.group) : UNSORTED,
      ...(d.group ? { sectionTitle: titleCase(d.group) } : {}),
    });
  }

  const needsSample: string[] = [];
  const routerCands: Candidate[] = [];
  for (const r of routes) {
    if (claimed.has(r.pattern)) continue;
    const dyn = isDynamic(r.pattern);
    const sample = dyn ? input.samples.get(r.pattern)?.path : r.pattern;
    if (!sample) {
      needsSample.push(r.pattern);
      continue;
    }
    routerCands.push({
      key: r.pattern,
      path: sample,
      ...(dyn ? { route: r.pattern } : {}),
      source: 'router',
      title: r.name ? titleCase(r.name) : titleFromPattern(r.pattern),
      states: ['default'],
      section: UNSORTED,
    });
  }
  // Router nesting → sections (only without an SDK): a top-level segment shared by 2+ routes.
  if (!input.sdk?.length) {
    const top = (p: string) => segs(p).find((x) => !x.startsWith(':') && x !== '*');
    const count = new Map<string, number>();
    for (const x of routerCands) {
      const t = top(x.key);
      if (t) count.set(t, (count.get(t) ?? 0) + 1);
    }
    for (const x of routerCands) {
      const t = top(x.key);
      if (t && (count.get(t) ?? 0) >= 2) {
        x.section = toKebab(t) || UNSORTED;
        x.sectionTitle = titleCase(t);
      }
    }
  }
  routerCands.forEach(push);

  for (const p of input.crawled) {
    const key = keyOf(p);
    if (isDynamic(key)) continue; // a sample of a router route: the route owns it
    push({ key, path: normPath(p), source: 'crawl', title: titleFromPath(p), states: ['default'], section: UNSORTED });
  }

  // Already in the project?
  const haveRoute = new Set(c.screens.map((s) => (s.route ? normPattern(s.route) : normPath(s.path))));
  const havePath = new Set(c.screens.map((s) => normPath(s.path)));
  const haveId = new Set(c.screens.map((s) => s.id));
  let existing = 0;
  const fresh = cands.filter((x) => {
    const dup =
      haveRoute.has(x.key) ||
      havePath.has(normPath(x.path)) ||
      (x.id !== undefined && haveId.has(x.id)) ||
      (!!x.route && c.screens.some((s) => !s.route && matchPattern(x.route!, s.path)));
    if (dup) existing++;
    return !dup;
  });

  const added: Record<DiscoverySource, number> = { sdk: 0, router: 0, crawl: 0 };
  if (!fresh.length) return { config: c, added, existing, needsSample };

  const sections: Section[] = [...c.sections];
  const ensureSection = (id: string, title: string, layout: Section['layout']) => {
    if (sections.some((s) => s.id === id)) return;
    const order = sections.reduce((m, s) => Math.max(m, s.order), -1) + 1;
    sections.push({ id, title, parent: null, color: 'grey', layout, collapsed: false, locked: false, order });
  };
  let work: FlowCanvasConfig = c;
  const screens: Screen[] = [];
  for (const x of fresh) {
    if (x.section === UNSORTED) ensureSection(UNSORTED, 'Unsorted', 'grid');
    else ensureSection(x.section, x.sectionTitle ?? titleCase(x.section), 'row');
    const id = x.id ?? uniqueScreenId(work, x.route ? idBase(x.route) : x.path);
    const s: Screen = { id, title: x.title, section: x.section, path: x.path, states: x.states, source: x.source };
    if (x.route) s.route = x.route;
    screens.push(s);
    work = { ...work, screens: [...work.screens, s] };
    added[x.source]++;
  }
  // Unsorted screens: a grid, 3 per row, below what is already on the canvas (feature 1).
  const loose = screens.filter((s) => s.section === UNSORTED);
  if (loose.length) {
    const top = c.screens.length ? contentBottom(c) + SECTION_TITLE_H + SECTION_PAD * 2 : 0;
    const pos = gridPositions(loose, { x: 0, y: top }, 3);
    for (const s of loose) s.position = pos.get(s.id);
  }
  return { config: { ...c, sections, screens: [...c.screens, ...screens] }, added, existing, needsSample };
}

/* ------------------------- older entry points ---------------------------- */

/** Crawled paths only (no router, no SDK). */
export function addPathScreens(c: FlowCanvasConfig, paths: string[]): FlowCanvasConfig {
  return mergeDiscovery(c, { sdk: null, routes: [], crawled: paths, samples: new Map() }).config;
}

/** SDK screen list only. */
export function addSdkScreens(c: FlowCanvasConfig, decls: ScreenDecl[]): FlowCanvasConfig {
  return mergeDiscovery(c, { sdk: decls, routes: [], crawled: [], samples: new Map() }).config;
}
