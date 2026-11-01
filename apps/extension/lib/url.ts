import { PARAM_FRAME, PARAM_STATE } from '@flowcanvas/protocol/lite';

/** path + search of a URL, without fc-frame / fc-state and without hash. */
export function cleanPath(href: string, base = 'http://x'): string {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return href;
  }
  u.searchParams.delete(PARAM_FRAME);
  u.searchParams.delete(PARAM_STATE);
  const q = u.searchParams.toString();
  return u.pathname + (q ? `?${q}` : '');
}

/** Normalize a path for comparison: no trailing slash (except root), no fc params. */
export function normPath(p: string): string {
  const c = cleanPath(p);
  const [path = '/', q] = c.split('?');
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return q ? `${trimmed}?${q}` : trimmed;
}

export { isLocalOrigin } from './origin';

/** Same-origin <a href> paths on a page (crawl discovery). */
export function collectLinks(doc: Document): string[] {
  const origin = doc.location?.origin;
  const out = new Set<string>();
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, doc.location?.href ?? 'http://x');
    } catch {
      continue;
    }
    if (origin && u.origin !== origin) continue;
    out.add(cleanPath(u.href));
  }
  return [...out];
}
