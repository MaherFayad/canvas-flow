/**
 * Sample values for dynamic params, read from the repo: fixtures, seed data,
 * mocks, API handlers and content folders. A value like `id: 'canele-plate'`
 * is tied to the nearest collection name written before it (`PRODUCTS = [`,
 * `"products": [`), and a route's param gets the values of the collection that
 * matches the static segment before it (`/product/:id` → products).
 */
import path from 'node:path';
import { lineAt, readText, type WalkedFile } from './files.js';
import { paramsOf } from './pattern.js';
import type { SampleHint } from './types.js';

const DATA_PATH =
  /(^|\/)(data|fixtures?|mocks?|__mocks__|seeds?|db|server|api|handlers|msw|stubs?|samples?|content|prisma|supabase|testdata|test-data|dummy|placeholder|lib)(\/|\.|$)|(data|fixtures?|mocks?|seeds?|handlers|db|store|catalog)\.(ts|tsx|js|jsx|mjs|cjs|json)$/i;
const DATA_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml)$/;
const SKIP_JSON = /(^|\/)(package|package-lock|tsconfig[\w.-]*|jsconfig|composer|manifest|flowcanvas\.config|components|turbo|vercel|netlify|\.eslintrc|biome|deno)\.json$/;
const CONTENT_EXT = /\.(md|mdx|markdown|mdoc|json|ya?ml)$/;

/** Singular/plural stems of a word. */
export function stems(word: string): Set<string> {
  const w = word.toLowerCase();
  const out = new Set([w]);
  if (w.endsWith('ies')) out.add(w.slice(0, -3) + 'y');
  if (/(ss|x|ch|sh)es$/.test(w)) out.add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) out.add(w.slice(0, -1));
  out.add(w.endsWith('y') ? w.slice(0, -1) + 'ies' : w + 's');
  return out;
}

const words = (id: string) =>
  id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

/** Keywords that identify the collection a route's param comes from. */
export function routeKeywords(route: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const segs = route.split('/').filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const m = /^:([\w$]+)/.exec(s);
    if (!m) continue;
    const kws = new Set<string>();
    const prev = segs[i - 1];
    if (prev && !prev.startsWith(':')) for (const w of words(prev).slice(-1)) for (const x of stems(w)) kws.add(x);
    const pw = words(m[1]!).filter((w) => !['id', 'slug', 'uuid', 'key', 'handle', 'code', 'ref'].includes(w));
    for (const w of pw.slice(-1)) for (const x of stems(w)) kws.add(x);
    out.set(m[1]!, kws);
  }
  return out;
}

interface Found {
  value: string;
  key: string;
  source: string;
  /** Collection word the value sits under (lowercase), or null. */
  collection: string | null;
}

export interface SampleIndex {
  values: Found[];
  /** Content files grouped by their folder name (lowercase): blog posts, docs pages. */
  content: Map<string, Array<{ slug: string; source: string }>>;
}

/** Read fixture-like files once per scan. */
export async function buildSampleIndex(files: WalkedFile[], keywordUniverse: Set<string>, paramNames: string[] = [], maxFiles = 400): Promise<SampleIndex> {
  const extra = [...new Set(paramNames)].filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)).map((n) => n.replace(/\$/g, '\\$'));
  const valueRe = new RegExp(VALUE_SRC.replace('KEYS', ['id', 'slug', 'uuid', 'key', 'handle', 'code', 'ref', ...extra].join('|')), 'g');
  const values: Found[] = [];
  const content = new Map<string, Array<{ slug: string; source: string }>>();
  let read = 0;
  for (const f of files) {
    if (CONTENT_EXT.test(f.rel) && /\.(md|mdx|markdown|mdoc)$/.test(f.rel)) {
      const dir = path.posix.basename(path.posix.dirname(f.rel)).toLowerCase();
      const slug = path.posix.basename(f.rel).replace(/\.\w+$/, '');
      if (slug !== 'index' && !/^readme$/i.test(slug) && !/^(changelog|license|contributing)$/i.test(slug)) {
        const list = content.get(dir) ?? [];
        if (list.length < 20) list.push({ slug, source: f.rel });
        content.set(dir, list);
      }
    }
    if (read >= maxFiles || f.size > 1024 * 1024 || !DATA_EXT.test(f.rel) || SKIP_JSON.test(f.rel)) continue;
    if (!DATA_PATH.test(f.rel) && !f.test && !/\.json$/.test(f.rel)) continue;
    const text = await readText(f.abs);
    if (!text) continue;
    read++;
    values.push(...valuesIn(text, f.rel, keywordUniverse, valueRe));
  }
  return { values, content };
}

const VALUE_SRC = String.raw`["']?\b(KEYS|[a-z][\w]*(?:Id|Slug|_id|_slug))\b["']?\s*:\s*(?:["'\x60]([^"'\x60\n$]{1,80})["'\x60]|(\d{1,12})\b)`;
const COLLECTION_RE = /(?:^|[^\w$.])["']?([A-Za-z_$][\w$]*)["']?\s*(?::\s*[\w<>[\]\s|,.]*?)?\s*[:=]\s*(?:\w+\s*\(\s*)?\[/g;

function valuesIn(text: string, rel: string, universe: Set<string>, valueRe: RegExp): Found[] {
  // Collection markers: `PRODUCTS: Product[] = [`, `export const classes = [`, `"products": [`.
  const marks: Array<{ at: number; word: string }> = [];
  for (const m of text.matchAll(COLLECTION_RE)) {
    const ws = words(m[1]!);
    const last = ws.at(-1);
    if (!last) continue;
    const hit = [...stems(last)].find((s) => universe.has(s));
    if (hit) marks.push({ at: m.index!, word: last });
  }
  const out: Found[] = [];
  for (const m of text.matchAll(valueRe)) {
    const value = m[2] ?? m[3];
    if (!value || /^\s|\s$/.test(value) || value.length < 1) continue;
    if (/[\s<>{}]/.test(value) && !/^[\w-]+$/.test(value)) continue;
    let collection: string | null = null;
    for (let i = marks.length - 1; i >= 0; i--) {
      if (marks[i]!.at < m.index!) {
        collection = marks[i]!.word;
        break;
      }
    }
    out.push({ value, key: m[1]!, source: `${rel}:${lineAt(text, m.index!)}`, collection });
  }
  return out;
}

/** Up to `max` hints per dynamic param of `route`. */
const GENERIC = ['id', 'slug', 'uuid', 'key', 'handle', 'code', 'ref'];

export function hintsFor(route: string, index: SampleIndex, staticParams: Record<string, string[]> | undefined, file: string, max = 5): SampleHint[] {
  const out: SampleHint[] = [];
  const kw = routeKeywords(route);
  for (const p of paramsOf(route)) {
    const seen = new Set<string>();
    const add = (value: string, source: string) => {
      if (seen.has(value) || seen.size >= max) return;
      seen.add(value);
      out.push({ param: p.name, value, source });
    };
    for (const v of staticParams?.[p.name] ?? []) add(v, `${file} (static params)`);
    const keys = kw.get(p.name) ?? new Set<string>();
    const paramKey = p.name.toLowerCase();
    const generic = GENERIC.includes(paramKey) || /(id|slug|uuid|key)$/i.test(p.name);
    const inCollection = (f: Found) => !!f.collection && [...stems(f.collection)].some((s) => keys.has(s));
    // 1. Values under a matching collection with the param's own key ("city: 'berlin'" for :city).
    for (const f of index.values) if (inCollection(f) && f.key.toLowerCase() === paramKey) add(f.value, f.source);
    // 1b. For id-like params, the collection's ids and slugs.
    if (generic) for (const f of index.values) if (inCollection(f) && GENERIC.includes(f.key.toLowerCase())) add(f.value, f.source);
    // 2. Values whose key names the collection ("productId: 'x'").
    for (const f of index.values) {
      const kws = words(f.key);
      if (kws.length > 1 && [...stems(kws[0]!)].some((s) => keys.has(s))) add(f.value, f.source);
    }
    // 3. Content files in a folder named like the route (posts/, blog/, docs/).
    for (const [dir, list] of index.content) {
      if ([...stems(dir)].some((s) => keys.has(s)) || (p.rest && keys.size === 0)) for (const c of list) add(c.slug, c.source);
    }
  }
  return out;
}
