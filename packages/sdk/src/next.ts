/** @flowcanvas/sdk/next: helpers for Next.js (App Router and Pages Router). */
import { fc, type FcScreen } from './index';

type SearchParamsLike =
  | URLSearchParams
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

function isProd(): boolean {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

function read(sp: SearchParamsLike | null | undefined, name: string): string | null {
  if (!sp) return null;
  if (typeof (sp as URLSearchParams).get === 'function') return (sp as URLSearchParams).get(name);
  const v = (sp as Record<string, string | string[] | undefined>)[name];
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

/**
 * Forced state for server components, read from the page's `searchParams`
 * (await it first on Next 15+). Only honoured when `fc-frame` is present too.
 * Always 'default' in production.
 *
 * ```tsx
 * export default async function Page({ searchParams }) {
 *   const state = fcStateFromSearchParams(await searchParams);
 * ```
 */
export function fcStateFromSearchParams(searchParams: SearchParamsLike | null | undefined): string {
  if (isProd() || !read(searchParams, 'fc-frame')) return 'default';
  return read(searchParams, 'fc-state') || 'default';
}

const SKIP = /^\/(_app|_error|_document|404|500|api)(\/|$)/;

/**
 * Best-effort route list in the browser, for `fc.init({ screens: nextScreens() })`.
 * Reads the Pages Router build manifest (`self.__BUILD_MANIFEST.sortedPages`) and
 * the current page from `__NEXT_DATA__`. App Router apps expose no route list in
 * the client, so declare screens by hand there.
 */
export function nextScreens(): FcScreen[] {
  if (typeof window === 'undefined') return [];
  const w = window as unknown as {
    __BUILD_MANIFEST?: { sortedPages?: string[] };
    __NEXT_DATA__?: { page?: string };
  };
  const pages = new Set<string>(w.__BUILD_MANIFEST?.sortedPages ?? []);
  if (w.__NEXT_DATA__?.page) pages.add(w.__NEXT_DATA__.page);
  return [...pages]
    .filter((p) => !SKIP.test(p))
    .map((p) => ({
      id: p.replace(/\[+\.*([^\]]+)\]+/g, '$1').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'home',
      path: p.replace(/\[+\.*([^\]]+)\]+/g, ':$1'),
    }));
}

export { fc };
