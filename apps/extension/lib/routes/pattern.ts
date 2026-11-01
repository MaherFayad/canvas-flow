/**
 * Route patterns, one syntax for every framework: "/product/:id", optional
 * "/users/:id?", splat "/docs/*" (zero or more segments). Pure; used by the
 * MAIN-world sniffers (converters) and the canvas (matching, samples).
 */

/** "/a//b/" → "/a/b"; always one leading slash, no trailing slash. (A "?" here is an optional param, not a query.) */
export function normPattern(p: string): string {
  return '/' + p.split('/').filter(Boolean).join('/');
}

/** A concrete path without query and hash, normalised like a pattern. */
export const pathOnly = (p: string): string => normPattern(p.split(/[?#]/)[0] ?? '');

/** Join a child route path onto its parent (React Router: an absolute child path wins). */
export function joinPattern(parent: string, child: string): string {
  if (child.startsWith('/')) return normPattern(child);
  return normPattern(`${parent}/${child}`);
}

export const isDynamic = (pattern: string): boolean => /(^|\/)(:|\*)/.test(pattern);

/** "/" + "*" only: a catch-all (404) route, not a screen of its own. */
export const isCatchAll = (pattern: string): boolean => normPattern(pattern) === '/*';

/** Next.js / SvelteKit file-system segment → pattern segment. Returns null for segments that do not show in the URL. */
function fsSegment(seg: string): string | null {
  if (/^\(.*\)$/.test(seg) || seg.startsWith('@')) return null; // route group, parallel slot
  let m = /^\[\[\.\.\.([^\]=]+)(=[^\]]+)?\]\]$/.exec(seg);
  if (m) return '*';
  m = /^\[\.\.\.([^\]=]+)(=[^\]]+)?\]$/.exec(seg);
  if (m) return '*';
  m = /^\[\[([^\]=]+)(=[^\]]+)?\]\]$/.exec(seg);
  if (m) return `:${m[1]}?`;
  m = /^\[([^\]=]+)(=[^\]]+)?\]$/.exec(seg);
  if (m) return `:${m[1]}`;
  return seg;
}

/** Next.js page ("/product/[id]", "/docs/[...slug]") or SvelteKit route id ("/(app)/[[lang]]/x") → pattern. */
export function fromFileRoute(page: string): string {
  const segs = page.split('/').filter(Boolean);
  const out: string[] = [];
  for (const s of segs) {
    const p = fsSegment(s);
    if (p !== null) out.push(p);
  }
  return '/' + out.join('/');
}

/** Vue Router path ("/users/:id(\\d+)", "/:pathMatch(.*)*", "/p/:x?", "/c/:chapters+") → pattern. */
export function fromVuePath(path: string): string {
  const segs = normPattern(path).split('/').filter(Boolean);
  const out: string[] = [];
  for (const s of segs) {
    const m = /^:(\w+)(\([^/]*\))?([?*+])?$/.exec(s);
    if (!m) {
      out.push(s);
      continue;
    }
    const [, name, re, mod] = m;
    if (mod === '*' || mod === '+' || (re && /\.\*|\.\+/.test(re) && !mod)) out.push('*');
    else out.push(`:${name}${mod === '?' ? '?' : ''}`);
  }
  return '/' + out.join('/');
}

/** Angular route path ("user/:id", "**") → pattern segment(s) (no leading slash in Angular config). */
export function fromAngularPath(path: string): string {
  return path === '**' ? '*' : path;
}

type Seg = { kind: 'static'; value: string } | { kind: 'param'; name: string; optional: boolean } | { kind: 'splat' };

function parse(pattern: string): Seg[] {
  return normPattern(pattern)
    .split('/')
    .filter(Boolean)
    .map((s): Seg => {
      if (s === '*') return { kind: 'splat' };
      const m = /^:(\w+)(\?)?$/.exec(s);
      if (m) return { kind: 'param', name: m[1]!, optional: !!m[2] };
      return { kind: 'static', value: s };
    });
}

/**
 * Match a concrete path against a pattern. Returns the params (splat under "*")
 * or null. Query and hash are ignored; static segments compare case-sensitively,
 * after URI decoding.
 */
export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const segs = parse(pattern);
  const parts = pathOnly(path)
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  const go = (i: number, j: number, params: Record<string, string>): Record<string, string> | null => {
    if (i === segs.length) return j === parts.length ? params : null;
    const s = segs[i]!;
    if (s.kind === 'splat') return { ...params, '*': parts.slice(j).join('/') };
    if (s.kind === 'static') return parts[j] === s.value ? go(i + 1, j + 1, params) : null;
    if (j < parts.length) {
      const r = go(i + 1, j + 1, { ...params, [s.name]: parts[j]! });
      if (r) return r;
    }
    return s.optional ? go(i + 1, j, params) : null;
  };
  return go(0, 0, {});
}

/** Fill a pattern with params. Missing optional params drop their segment; a missing required one → null. */
export function fillPattern(pattern: string, params: Record<string, string>): string | null {
  const out: string[] = [];
  for (const s of parse(pattern)) {
    if (s.kind === 'static') out.push(s.value);
    else if (s.kind === 'splat') {
      const v = params['*'];
      if (v === undefined) return null;
      if (v) out.push(v);
    } else {
      const v = params[s.name];
      if (v === undefined || v === '') {
        if (s.optional) continue;
        return null;
      }
      out.push(encodeURIComponent(v));
    }
  }
  return '/' + out.join('/');
}

/** Specificity for picking the best of several matching patterns: more static segments first, splats last. */
export function specificity(pattern: string): number {
  let n = 0;
  for (const s of parse(pattern)) n += s.kind === 'static' ? 100 : s.kind === 'param' ? (s.optional ? 5 : 10) : 0;
  return n;
}

/** The most specific pattern that matches `path`, ignoring the root catch-all. */
export function bestMatch(patterns: Iterable<string>, path: string): string | null {
  let best: string | null = null;
  for (const p of patterns) {
    if (isCatchAll(p) || !matchPattern(p, path)) continue;
    if (best === null || specificity(p) > specificity(best)) best = p;
  }
  return best;
}
