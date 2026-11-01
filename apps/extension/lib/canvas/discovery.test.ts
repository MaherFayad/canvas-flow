import { describe, expect, it } from 'vitest';
import { emptyConfig, parseConfig, type FlowCanvasConfig } from '@flowcanvas/config';
import { Crawler, detectAuthWall, mergeDiscovery, pickSamples, titleFromPattern, type SampleChoice } from './discover';
import {
  makeFetcher,
  nextPages,
  normalizeRoutes,
  parseNextBuildManifest,
  parseNextDevPagesManifest,
  parseRobotsSitemaps,
  parseSitemap,
  parseSvelteKitDictionary,
  sitemapPaths,
  svelteKitRoutes,
  toPattern,
  type Fetcher,
} from './sniff';
import { DEMO_PATTERNS, nextBuildManifestJs, svelteKitClientJs } from '../main/sniff.fixtures';

const ORIGIN = 'http://localhost:5174';
const cfg = (screens: FlowCanvasConfig['screens'] = [], sections: FlowCanvasConfig['sections'] = []): FlowCanvasConfig => ({
  ...emptyConfig(ORIGIN),
  screens,
  sections,
});
const routes = (ps: string[]) => ps.map((pattern) => ({ pattern }));
const fake =
  (files: Record<string, string>): Fetcher =>
  async (url) =>
    files[url] ?? null;

/** The demo's SDK list (apps/demo/src/screens.ts), trimmed. */
const DEMO_SDK = [
  { id: 'welcome', title: 'Welcome', path: '/', group: 'onboarding', states: ['default', 'loading', 'error'] },
  { id: 'catalog', title: 'Catalog', path: '/catalog', group: 'onboarding', states: ['default', 'empty'] },
  { id: 'product', title: 'Product detail', path: '/product/canele-dinner-plate', group: 'browse', states: ['default', 'saved'] },
  { id: 'class', title: 'Class', path: '/classes/tableware-course', group: 'classes', states: ['default'] },
];

describe('crawler', () => {
  it('depth 3, max 60, skips unsafe paths and files, dedupes', () => {
    const c = new Crawler('/');
    expect(c.next()).toEqual({ path: '/', depth: 0 });
    c.addLinks(['/a', '/a/', '/logout', '/items/1/delete', '/report.pdf', '/feed.xml', '/b?x=1'], 0);
    expect(c.pending).toBe(2);
    c.add('/deep', 3);
    c.add('/too-deep', 4);
    expect(c.pending).toBe(3);
    const big = new Crawler('/', 3, 3);
    big.addLinks(['/1', '/2', '/3', '/4'], 0);
    expect([big.next(), big.next(), big.next(), big.next()].filter(Boolean)).toHaveLength(3);
  });
});

describe('login wall detection', () => {
  it('needs 3 different pages landing on the same other URL', () => {
    const v = (requested: string, landed: string) => ({ requested, landed });
    expect(detectAuthWall([v('/', '/login'), v('/a', '/login')])).toBeNull();
    expect(detectAuthWall([v('/', '/login'), v('/a', '/login?next=/a'), v('/b', '/login')])).toBe('/login');
    expect(detectAuthWall([v('/a', '/login'), v('/a', '/login'), v('/a', '/login')])).toBeNull(); // same page thrice
    expect(detectAuthWall([v('/login', '/login'), v('/x', '/x'), v('/y', '/y'), v('/z', '/z')])).toBeNull();
  });
});

describe('dynamic route samples', () => {
  it('prefers seen links, then the SDK, then inference from a sibling sample; the rest is missing', () => {
    const pats = DEMO_PATTERNS;
    const seen = ['/', '/catalog', '/product/tall-mug', '/product/canele-plate', '/classes', '/classes/glaze-lab'];
    const { chosen, missing } = pickSamples(pats, seen, []);
    expect(Object.fromEntries(chosen)).toEqual({
      '/product/:id': { path: '/product/tall-mug', from: 'crawl' },
      '/classes/:id': { path: '/classes/glaze-lab', from: 'crawl' },
      '/classes/:id/book': { path: '/classes/glaze-lab/book', from: 'inferred' },
      '/classes/:id/booked': { path: '/classes/glaze-lab/booked', from: 'inferred' },
    });
    expect(missing).toEqual([]);
    // A link straight to the booking page beats inference.
    expect(pickSamples(pats, [...seen, '/classes/evening/book'], []).chosen.get('/classes/:id/book')).toEqual({ path: '/classes/evening/book', from: 'crawl' });
    // SDK when nothing was crawled.
    expect(pickSamples(pats, ['/'], ['/product/canele-dinner-plate']).chosen.get('/product/:id')).toEqual({ path: '/product/canele-dinner-plate', from: 'sdk' });
    // Nothing to go on: ask.
    expect(pickSamples(['/', '/product/:id', '/u/:uid/orders/:oid'], ['/'], []).missing).toEqual(['/product/:id', '/u/:uid/orders/:oid']);
  });

  it('a path is a sample only of its most specific route; optional-only and splat routes', () => {
    const r = pickSamples(['/classes/:id', '/classes/new', '/docs/*', '/:lang?/about', '/*'], ['/classes/new', '/docs/a/b'], []);
    expect(r.chosen.get('/classes/:id')).toBeUndefined();
    expect(r.chosen.get('/docs/*')).toEqual({ path: '/docs/a/b', from: 'crawl' });
    expect(r.chosen.get('/:lang?/about')).toEqual({ path: '/about', from: 'inferred' });
    expect(r.missing).toEqual(['/classes/:id']); // the catch-all never needs a sample
  });
});

describe('merge and dedupe', () => {
  const samples = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, path]): [string, SampleChoice] => [k, { path, from: 'crawl' }]));

  it('router only: every route once, samples as paths, route + source set, sections from shared top segments', () => {
    const r = mergeDiscovery(cfg(), {
      sdk: null,
      routes: routes(DEMO_PATTERNS),
      crawled: ['/', '/catalog', '/product/tall-mug', '/product/other', '/classes/glaze-lab'],
      samples: samples({ '/product/:id': '/product/tall-mug', '/classes/:id': '/classes/glaze-lab', '/classes/:id/book': '/classes/glaze-lab/book', '/classes/:id/booked': '/classes/glaze-lab/booked' }),
    });
    const s = r.config.screens;
    expect(s).toHaveLength(12);
    expect(r.added).toEqual({ sdk: 0, router: 12, crawl: 0 });
    expect(s.every((x) => x.source === 'router')).toBe(true);
    expect(s.find((x) => x.route === '/product/:id')).toMatchObject({ id: 'product', path: '/product/tall-mug', title: 'Product detail', section: 'unsorted' });
    expect(s.find((x) => x.path === '/classes/glaze-lab/book')).toMatchObject({ id: 'classes-book', route: '/classes/:id/book', section: 'classes', title: 'Book' });
    expect(s.find((x) => x.path === '/catalog')!.route).toBeUndefined();
    expect(r.config.sections.map((x) => x.id)).toEqual(['unsorted', 'classes']);
    expect(parseConfig(r.config).ok).toBe(true);
  });

  it('SDK > router > crawl: SDK groups win, router fills gaps (Unsorted), crawl adds only pages no route claims', () => {
    const r = mergeDiscovery(cfg(), {
      sdk: DEMO_SDK,
      routes: routes(['/', '/catalog', '/product/:id', '/classes/:id', '/help']),
      crawled: ['/', '/product/x', '/legacy.html', '/help'],
      samples: samples({ '/product/:id': '/product/x', '/classes/:id': '/classes/tableware-course' }),
    });
    const by = (p: string) => r.config.screens.find((x) => x.path === p);
    expect(r.added).toEqual({ sdk: 4, router: 1, crawl: 1 });
    expect(by('/product/canele-dinner-plate')).toMatchObject({ id: 'product', route: '/product/:id', source: 'sdk', section: 'browse', states: ['default', 'saved'] });
    expect(by('/help')).toMatchObject({ source: 'router', section: 'unsorted' });
    expect(by('/legacy.html')).toMatchObject({ source: 'crawl', section: 'unsorted' });
    expect(by('/product/x')).toBeUndefined();
    expect(r.config.sections.map((x) => x.id)).toEqual(['onboarding', 'browse', 'classes', 'unsorted']);
  });

  it('never duplicates screens already in the config (by route, then path, then a concrete path the route matches)', () => {
    const existing = cfg(
      [
        { id: 'catalog', title: 'Catalog', section: null, path: '/catalog', states: ['default'] },
        { id: 'p', title: 'Product', section: null, path: '/product/canele-dinner-plate', states: ['default'] }, // older config: no route
        { id: 'c', title: 'Class', section: null, path: '/classes/other', route: '/classes/:id', states: ['default'] },
      ],
      [],
    );
    const r = mergeDiscovery(existing, {
      sdk: null,
      routes: routes(['/catalog', '/product/:id', '/classes/:id', '/bag']),
      crawled: ['/catalog'],
      samples: samples({ '/product/:id': '/product/x', '/classes/:id': '/classes/y' }),
    });
    expect(r.existing).toBe(3);
    expect(r.config.screens.map((x) => x.path)).toEqual(['/catalog', '/product/canele-dinner-plate', '/classes/other', '/bag']);
    // Running it again adds nothing and returns the same config object (no undo step).
    const again = mergeDiscovery(r.config, { sdk: null, routes: routes(['/catalog', '/bag']), crawled: ['/bag'], samples: new Map() });
    expect(again.config).toBe(r.config);
  });

  it('dynamic routes without a sample are reported, not added; the catch-all is never a screen', () => {
    const r = mergeDiscovery(cfg(), { sdk: null, routes: routes(['/', '/u/:id', '/*']), crawled: ['/'], samples: new Map() });
    expect(r.needsSample).toEqual(['/u/:id']);
    expect(r.config.screens.map((x) => x.path)).toEqual(['/']);
  });

  it('titles from patterns', () => {
    expect(titleFromPattern('/')).toBe('Home');
    expect(titleFromPattern('/product/:id')).toBe('Product detail');
    expect(titleFromPattern('/order-confirmed')).toBe('Order confirmed');
    expect(titleFromPattern('/:lang')).toBe('Page');
  });
});

describe('canvas-side sniff helpers', () => {
  it('normalises per framework and drops Next.js internals', () => {
    expect(toPattern('next', '/blog/[slug]')).toBe('/blog/:slug');
    expect(toPattern('vue', '/u/:id(\\d+)')).toBe('/u/:id');
    expect(toPattern('angular', '/a/**')).toBe('/a/*');
    expect(toPattern('react-router', '/a/:b?')).toBe('/a/:b?');
    expect(normalizeRoutes('next', [{ path: '/_app' }, { path: '/api/x' }, { path: '/404' }, { path: '/p/[id]' }, { path: '/p/[id]', auth: true }])).toEqual([{ pattern: '/p/:id', auth: true }]);
  });

  it('parses Next.js manifests (recorded dev build manifest), SvelteKit dictionary, sitemaps and robots.txt', () => {
    expect(parseNextBuildManifest(nextBuildManifestJs)).toEqual(['/', '/_app', '/_error', '/product/[id]']);
    expect(parseNextBuildManifest('self.__BUILD_MANIFEST={"sortedPages":["/","/a"]}')).toEqual(['/', '/a']);
    expect(parseNextBuildManifest('nothing here')).toEqual([]);
    expect(parseNextDevPagesManifest('{"pages":["/","/about","/docs/[...slug]"]}')).toEqual(['/', '/about', '/docs/[...slug]']);
    expect(parseNextDevPagesManifest('<html>')).toEqual([]);
    expect(parseSvelteKitDictionary(svelteKitClientJs).map((x) => toPattern('sveltekit', x))).toEqual(['/', '/dashboard', '/blog/:slug', '/docs/*', '/:lang?/about']);
    const sm = parseSitemap(
      `<?xml version="1.0"?><urlset><url><loc>${ORIGIN}/a</loc></url><url><loc> ${ORIGIN}/b?x=1&amp;y=2 </loc></url><url><loc>https://other.dev/c</loc></url></urlset>`,
      ORIGIN,
    );
    expect(sm).toEqual({ paths: ['/a', '/b?x=1&y=2'], sitemaps: [] });
    expect(parseSitemap(`<sitemapindex><sitemap><loc>${ORIGIN}/s1.xml</loc></sitemap></sitemapindex>`, ORIGIN).sitemaps).toEqual([`${ORIGIN}/s1.xml`]);
    expect(parseRobotsSitemaps(`User-agent: *\nDisallow: /x\nSitemap: ${ORIGIN}/maps/main.xml\nsitemap: https://evil.dev/s.xml`, ORIGIN)).toEqual([`${ORIGIN}/maps/main.xml`]);
  });

  it('fetches: Next dev pages manifest + build manifest, SvelteKit client, sitemap via robots (SPA HTML fallbacks ignored)', async () => {
    const html = '<!doctype html><html><body><div id="root"></div></body></html>';
    const next = fake({
      [`${ORIGIN}/_next/static/development/_devPagesManifest.json`]: '{"pages":["/","/a"]}',
      [`${ORIGIN}/_next/static/abc123/_buildManifest.js`]: 'self.__BUILD_MANIFEST={sortedPages:["/b"]}',
    });
    expect(await nextPages(ORIGIN, { buildId: 'abc123' }, next)).toEqual(['/', '/a', '/b']);
    expect(await nextPages(ORIGIN, { buildId: '../x' }, next)).toEqual(['/', '/a']);
    expect(await svelteKitRoutes(ORIGIN, fake({ [`${ORIGIN}/.svelte-kit/generated/client/app.js`]: svelteKitClientJs }))).toHaveLength(5);
    const site = fake({
      [`${ORIGIN}/robots.txt`]: `Sitemap: ${ORIGIN}/index.xml`,
      [`${ORIGIN}/index.xml`]: `<sitemapindex><sitemap><loc>${ORIGIN}/pages.xml</loc></sitemap></sitemapindex>`,
      [`${ORIGIN}/pages.xml`]: `<urlset><url><loc>${ORIGIN}/pricing</loc></url></urlset>`,
      [`${ORIGIN}/sitemap.xml`]: `<urlset><url><loc>${ORIGIN}/about</loc></url></urlset>`,
    });
    expect((await sitemapPaths(ORIGIN, site)).sort()).toEqual(['/about', '/pricing']);
    expect(await sitemapPaths(ORIGIN, fake({ [`${ORIGIN}/robots.txt`]: html, [`${ORIGIN}/sitemap.xml`]: html }))).toEqual([]);
  });

  it('makeFetcher: non-OK and errors are null, slow answers time out', async () => {
    const ok = makeFetcher(1000, (async () => new Response('hi')) as typeof fetch);
    expect(await ok('http://x/')).toBe('hi');
    expect(await makeFetcher(1000, (async () => new Response('no', { status: 404 })) as typeof fetch)('http://x/')).toBeNull();
    expect(await makeFetcher(1000, (async () => Promise.reject(new Error('down'))) as typeof fetch)('http://x/')).toBeNull();
    const slow = makeFetcher(20, ((_u: string, init?: RequestInit) =>
      new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch);
    expect(await slow('http://x/')).toBeNull();
  });
});
