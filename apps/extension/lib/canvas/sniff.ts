/**
 * Canvas side of router sniffing (feature 2, source 2): turns what the frame's
 * MAIN-world sniffer reported (paths in the framework's own syntax) into route
 * patterns, and fills in what only the dev server knows by fetching its
 * manifests (Next.js, SvelteKit) and the sitemap. Pure parsers + small fetch
 * helpers; host permissions cover localhost, nothing leaves the machine.
 */
import type { SniffedRoute } from '@flowcanvas/protocol';
import { fromFileRoute, fromVuePath, isCatchAll, normPattern } from '../routes/pattern';
import { cleanPath } from '../url';

export interface RouteFound {
  pattern: string;
  auth?: boolean;
  name?: string;
}

/** Next.js internal pages that are not screens. */
export const NEXT_INTERNAL = /^\/(_app|_document|_error|404|500|api)(\/|$)/;

/** One framework path → pattern. */
export function toPattern(framework: string | null, raw: string): string {
  switch (framework) {
    case 'next':
    case 'sveltekit':
      return fromFileRoute(raw);
    case 'vue':
    case 'nuxt':
      return fromVuePath(raw);
    case 'angular':
      return normPattern(raw.split('/').map((s) => (s === '**' ? '*' : s)).join('/'));
    default:
      return normPattern(raw);
  }
}

/** Sniffed routes → unique patterns (auth flags merged), framework internals dropped. */
export function normalizeRoutes(framework: string | null, routes: SniffedRoute[]): RouteFound[] {
  const out = new Map<string, RouteFound>();
  for (const r of routes) {
    if ((framework === 'next' || framework === 'sveltekit') && NEXT_INTERNAL.test(r.path)) continue;
    const pattern = toPattern(framework, r.path);
    const prev = out.get(pattern);
    if (prev) {
      if (r.auth) prev.auth = true;
      if (r.name && !prev.name) prev.name = r.name;
      continue;
    }
    const f: RouteFound = { pattern };
    if (r.auth) f.auth = true;
    if (r.name) f.name = r.name;
    out.set(pattern, f);
  }
  return [...out.values()];
}

/** Routes that become screens: everything except the root catch-all (404). */
export const screenRoutes = (routes: RouteFound[]) => routes.filter((r) => !isCatchAll(r.pattern));

/* ------------------------------- parsers --------------------------------- */

/** Unescape a JS string literal body ("/" → "/", "\/" → "/"). */
function unescapeJs(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\(.)/g, (_m, u: string, x: string, c: string) => (u || x ? String.fromCharCode(parseInt(u || x, 16)) : c));
}

/** String literals inside the first `[ … ]` after `key:` (no eval). */
function stringArrayAfter(src: string, key: RegExp): string[] {
  const m = key.exec(src);
  if (!m) return [];
  const start = src.indexOf('[', m.index + m[0].length - 1);
  if (start < 0) return [];
  // Token scan: string literals (may contain "]"), identifiers (minified repeats), commas, up to the closing "]".
  const tok = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([\w$]+)|(,))/y;
  const out: string[] = [];
  for (let pos = start + 1; out.length < 5000; ) {
    tok.lastIndex = pos;
    const t = tok.exec(src);
    if (!t) break;
    pos = tok.lastIndex;
    if (t[1] !== undefined || t[2] !== undefined) out.push(unescapeJs(t[1] ?? t[2] ?? ''));
  }
  return out;
}

/** `/_next/static/<buildId>/_buildManifest.js` → `sortedPages`. */
export function parseNextBuildManifest(js: string): string[] {
  return stringArrayAfter(js, /["']?sortedPages["']?\s*:/);
}

/** `/_next/static/development/_devPagesManifest.json` (dev only: every Pages Router page). */
export function parseNextDevPagesManifest(json: string): string[] {
  try {
    const v = JSON.parse(json) as { pages?: unknown };
    return Array.isArray(v.pages) ? v.pages.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/** SvelteKit generated client (`export const dictionary = { "/": [2], "/product/[id]": [3] }`) → route ids. */
export function parseSvelteKitDictionary(js: string): string[] {
  const m = /dictionary\s*=\s*\{/.exec(js);
  if (!m) return [];
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < js.length && depth > 0; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') depth--;
  }
  const body = js.slice(start, i - 1);
  return [...body.matchAll(/"(\/[^"]*)"\s*:/g)].map((x) => x[1]!);
}

/** Same-origin paths in a sitemap (`<loc>` entries); nested sitemap indexes are returned separately. */
export function parseSitemap(xml: string, origin: string): { paths: string[]; sitemaps: string[] } {
  const paths: string[] = [];
  const sitemaps: string[] = [];
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const raw = m[1]!.replace(/&amp;/g, '&');
    let u: URL;
    try {
      u = new URL(raw, origin);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (isIndex) sitemaps.push(u.href);
    else paths.push(cleanPath(u.href));
  }
  return { paths, sitemaps };
}

/** `Sitemap:` lines of a robots.txt (same origin only). */
export function parseRobotsSitemaps(txt: string, origin: string): string[] {
  const out: string[] = [];
  for (const m of txt.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) {
    try {
      const u = new URL(m[1]!, origin);
      if (u.origin === origin) out.push(u.href);
    } catch {
      /* skip */
    }
  }
  return out;
}

/* -------------------------------- fetch ---------------------------------- */

export type Fetcher = (url: string) => Promise<string | null>;

/** GET a text resource from the dev server with a time limit. HTML answers (SPA fallbacks) count as missing unless `html`. */
export function makeFetcher(timeoutMs = 3000, f: typeof fetch = fetch): Fetcher {
  return async (url) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await f(url, { signal: ac.signal, credentials: 'omit', cache: 'no-store', redirect: 'follow' });
      if (!r.ok) return null;
      const text = await r.text();
      return text.slice(0, 2_000_000);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };
}

const looksHtml = (s: string) => /^\s*<(!doctype|html)/i.test(s);

/** Next.js: every page the dev server or the build manifest knows (raw "/product/[id]" form). */
export async function nextPages(origin: string, meta: Record<string, string> | undefined, get: Fetcher): Promise<string[]> {
  const out = new Set<string>();
  const dev = await get(`${origin}/_next/static/development/_devPagesManifest.json`);
  if (dev && !looksHtml(dev)) for (const p of parseNextDevPagesManifest(dev)) out.add(p);
  const id = meta?.buildId;
  if (id && /^[\w-]+$/.test(id)) {
    const bm = await get(`${origin}/_next/static/${id}/_buildManifest.js`);
    if (bm && !looksHtml(bm)) for (const p of parseNextBuildManifest(bm)) out.add(p);
  }
  return [...out];
}

/** SvelteKit dev: the generated client lists every route id. */
export async function svelteKitRoutes(origin: string, get: Fetcher): Promise<string[]> {
  for (const p of ['/.svelte-kit/generated/client/app.js', '/.svelte-kit/generated/client-optimized/app.js']) {
    const js = await get(origin + p);
    if (js && !looksHtml(js)) {
      const ids = parseSvelteKitDictionary(js);
      if (ids.length) return ids;
    }
  }
  return [];
}

/** robots.txt Sitemap lines + /sitemap.xml, one level of sitemap indexes, at most `max` paths. */
export async function sitemapPaths(origin: string, get: Fetcher, max = 300): Promise<string[]> {
  const robots = await get(`${origin}/robots.txt`);
  const queue = [...(robots && !looksHtml(robots) ? parseRobotsSitemaps(robots, origin) : []), `${origin}/sitemap.xml`];
  const seen = new Set<string>();
  const out = new Set<string>();
  for (let i = 0; i < queue.length && seen.size < 6 && out.size < max; i++) {
    const url = queue[i]!;
    if (seen.has(url)) continue;
    seen.add(url);
    const xml = await get(url);
    if (!xml || looksHtml(xml)) continue;
    const r = parseSitemap(xml, origin);
    for (const p of r.paths) if (out.size < max) out.add(p);
    queue.push(...r.sitemaps);
  }
  return [...out];
}
