/**
 * Route patterns as stored in `screens[].route`:
 *   /product/:id        dynamic segment
 *   /docs/:lang?        optional segment
 *   /docs/:slug+        catch-all (one or more segments)
 *   /shop/:slug*        optional catch-all (zero or more segments)
 *   /user-:id           a param inside a segment (Nuxt "user-[id]")
 * Every scanner converts its framework's syntax to this one.
 */

export interface RouteParam {
  name: string;
  optional: boolean;
  /** Catch-all: matches several segments. */
  rest: boolean;
}

const PARAM_RE = /:([A-Za-z_$][\w$]*)([?*+])?/g;

/** Params of a pattern, in order. */
export function paramsOf(route: string): RouteParam[] {
  const out: RouteParam[] = [];
  for (const m of route.matchAll(PARAM_RE)) {
    const mod = m[2];
    out.push({ name: m[1]!, optional: mod === '?' || mod === '*', rest: mod === '*' || mod === '+' });
  }
  return out;
}

export function isDynamic(route: string): boolean {
  return paramsOf(route).length > 0;
}

/** Clean up a joined pattern: one leading slash, no double or trailing slashes. */
export function normalizeRoute(p: string): string {
  let s = ('/' + p).replace(/\/{2,}/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s || '/';
}

/** Join a parent pattern and a child path (absolute children replace the parent). */
export function joinRoute(base: string, child: string | undefined): string {
  if (child === undefined || child === '') return normalizeRoute(base);
  if (child.startsWith('/')) return normalizeRoute(child);
  return normalizeRoute(`${base.replace(/\/+$/, '')}/${child}`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** RegExp for a pattern; groups are named by param. */
export function routeRegExp(route: string): RegExp {
  const segs = normalizeRoute(route).split('/').filter(Boolean);
  let re = '^';
  for (const seg of segs) {
    const whole = /^:([A-Za-z_$][\w$]*)([?*+])?$/.exec(seg);
    if (whole) {
      const [, , mod] = whole;
      if (mod === '?') re += '(?:/[^/]+)?';
      else if (mod === '+') re += '/.+';
      else if (mod === '*') re += '(?:/.*)?';
      else re += '/[^/]+';
      continue;
    }
    let part = '';
    let last = 0;
    for (const m of seg.matchAll(PARAM_RE)) {
      part += escapeRe(seg.slice(last, m.index)) + '[^/]+';
      last = m.index! + m[0].length;
    }
    re += '/' + part + escapeRe(seg.slice(last));
  }
  return new RegExp(re + '/?$');
}

/** True when a concrete path (query and hash ignored) is an instance of the pattern. */
export function matchesRoute(route: string, path: string): boolean {
  const p = path.split(/[?#]/)[0] || '/';
  if (normalizeRoute(route) === '/') return p === '/' || p === '';
  return routeRegExp(route).test(p);
}

/** Fill a pattern with values; optional params without a value are dropped. Returns null when a required one is missing. */
export function fillRoute(route: string, values: Record<string, string | undefined>): string | null {
  let missing = false;
  const segs = normalizeRoute(route)
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      seg.replace(PARAM_RE, (_m, name: string, mod?: string) => {
        const v = values[name];
        if (v === undefined || v === '') {
          if (mod === '?' || mod === '*') return '';
          missing = true;
          return '';
        }
        return mod === '*' || mod === '+' ? v.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(v);
      }),
    )
    .filter(Boolean);
  return missing ? null : '/' + segs.join('/');
}

/** True when a path still looks like a pattern (":id", "[id]", "$id", "*") rather than a concrete sample. */
export function looksLikePattern(path: string): boolean {
  const p = path.split(/[?#]/)[0]!;
  return /(^|\/)(:|\$)[A-Za-z_]/.test(p) || /\[[^\]]*\]/.test(p) || /(^|\/)\*/.test(p) || /\{[^}]*\}/.test(p);
}
