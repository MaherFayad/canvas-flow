import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRoutes, type ScanResult } from '../src/discover/scan.js';
import { fillRoute, matchesRoute, paramsOf, looksLikePattern } from '../src/discover/pattern.js';

const fx = (name: string) => fileURLToPath(new URL(`./fixtures/routes/${name}`, import.meta.url));
const DEMO = fileURLToPath(new URL('../../../apps/demo', import.meta.url));

const routesOf = (r: ScanResult) => r.routes.map((x) => x.route).sort();
const byRoute = (r: ScanResult, route: string) => r.routes.find((x) => x.route === route);
const skippedReasons = (r: ScanResult) => r.skipped.map((s) => `${s.route ?? s.file}: ${s.reason}`);

describe('route patterns', () => {
  it('params, matching and filling', () => {
    expect(paramsOf('/docs/:lang?/:slug+')).toEqual([
      { name: 'lang', optional: true, rest: false },
      { name: 'slug', optional: false, rest: true },
    ]);
    expect(matchesRoute('/product/:id', '/product/canele-plate')).toBe(true);
    expect(matchesRoute('/product/:id', '/product')).toBe(false);
    expect(matchesRoute('/product/:id', '/product/a/b')).toBe(false);
    expect(matchesRoute('/shop/:f*', '/shop')).toBe(true);
    expect(matchesRoute('/shop/:f*', '/shop/a/b')).toBe(true);
    expect(matchesRoute('/docs/:s+', '/docs')).toBe(false);
    expect(matchesRoute('/:lang?/about', '/about')).toBe(true);
    expect(matchesRoute('/:lang?/about', '/de/about')).toBe(true);
    expect(matchesRoute('/user-:name', '/user-ada')).toBe(true);
    expect(matchesRoute('/classes/:id/book', '/classes/glaze-lab/book?seats=2')).toBe(true);
    expect(fillRoute('/classes/:id/book', { id: 'glaze-lab' })).toBe('/classes/glaze-lab/book');
    expect(fillRoute('/shop/:f*', {})).toBe('/shop');
    expect(fillRoute('/product/:id', {})).toBeNull();
    expect(looksLikePattern('/product/:id')).toBe(true);
    expect(looksLikePattern('/product/[id]')).toBe(true);
    expect(looksLikePattern('/product/canele')).toBe(false);
  });
});

describe('scan_routes: apps/demo (createBrowserRouter)', () => {
  it('finds all 12 routes with real sample values for the dynamic ones', async () => {
    const r = await scanRoutes(DEMO);
    expect(r.apps).toEqual([{ dir: '.', name: '@flowcanvas/demo', frameworks: ['react-router'] }]);
    expect(routesOf(r)).toEqual(
      [
        '/',
        '/interests',
        '/catalog',
        '/product/:id',
        '/wishlist',
        '/bag',
        '/checkout',
        '/order-confirmed',
        '/classes',
        '/classes/:id',
        '/classes/:id/book',
        '/classes/:id/booked',
      ].sort(),
    );
    // Router order is kept (it follows the app's flow).
    expect(r.routes.map((x) => x.route).slice(0, 3)).toEqual(['/', '/interests', '/catalog']);
    for (const x of r.routes) {
      expect(x.framework).toBe('react-router');
      expect(x.file).toBe('src/App.tsx');
    }
    const product = byRoute(r, '/product/:id')!;
    expect(product.name).toBe('Product');
    expect(product.dynamicParams).toEqual(['id']);
    expect(product.sampleHints[0]).toMatchObject({ param: 'id', value: 'tall-mug-periwinkle' });
    expect(product.sampleHints.map((h) => h.value)).toEqual(['tall-mug-periwinkle', 'cappuccino-cup-butter', 'serving-bowl-apricot', 'side-plate-chantilly', 'big-bowl-periwinkle']);
    expect(product.sampleHints[0]!.source).toMatch(/^src\/data\.ts:\d+$/);
    expect(product.samplePath).toBe('/product/tall-mug-periwinkle');
    for (const route of ['/classes/:id', '/classes/:id/book', '/classes/:id/booked']) {
      const c = byRoute(r, route)!;
      expect(c.sampleHints.map((h) => h.value)).toEqual(['tableware-course', 'evening-workshop', 'glaze-lab']);
    }
    expect(byRoute(r, '/classes/:id/book')!.samplePath).toBe('/classes/tableware-course/book');
    expect(skippedReasons(r)).toEqual(['/:splat*: catch-all (not-found page)']);
  });
});

describe('scan_routes: file-based frameworks', () => {
  it('Next.js App Router: groups, dynamic, catch-all, optional catch-all, parallel / intercepting / private skipped, guards from layouts', async () => {
    const r = await scanRoutes(fx('next-app'));
    expect(routesOf(r)).toEqual(['/', '/about', '/blog/:slug', '/dashboard/settings', '/docs/:slug+', '/photo/:id', '/shop/:filters*']);
    expect(r.routes.every((x) => x.framework === 'next-app')).toBe(true);
    expect(byRoute(r, '/blog/:slug')!.sampleHints.map((h) => h.value)).toEqual(['hello-world', 'second-post']);
    expect(byRoute(r, '/photo/:id')!.samplePath).toBe('/photo/sunset-42');
    expect(byRoute(r, '/docs/:slug+')!.kind).toBe('catch-all');
    expect(byRoute(r, '/dashboard/settings')!.guards).toEqual(['getServerSession in app/dashboard/layout.tsx']);
    const reasons = skippedReasons(r).join('\n');
    expect(reasons).toMatch(/intercepting route \(\.\)photo/);
    expect(reasons).toMatch(/private folder _components/);
    // test files and route handlers are not pages
    expect(r.routes.some((x) => x.file.includes('test') || x.file.includes('api/'))).toBe(false);
  });

  it('Next.js src/app and middleware matchers', async () => {
    const r = await scanRoutes(fx('next-src-app'));
    expect(routesOf(r)).toEqual(['/', '/account', '/cart']);
    expect(byRoute(r, '/account')!.guards).toEqual(['middleware matcher in middleware.ts']);
    expect(byRoute(r, '/cart')!.guards).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/middleware\.ts runs before routes matching \/account\/:path\*/);
  });

  it('Next.js Pages Router: skips _app, _document, api/ and 404', async () => {
    const r = await scanRoutes(fx('next-pages'));
    expect(routesOf(r)).toEqual(['/', '/docs/:slug*', '/files/:path+', '/posts/:id', '/settings']);
    expect(r.routes.every((x) => x.framework === 'next-pages')).toBe(true);
    expect(byRoute(r, '/posts/:id')!.samplePath).toBe('/posts/42');
    expect(byRoute(r, '/settings')!.guards![0]).toMatch(/withPageAuthRequired/);
    expect(skippedReasons(r).join()).toMatch(/special page 404/);
  });

  it('Nuxt: index, nested, groups, optional, catch-all, middleware guard', async () => {
    const r = await scanRoutes(fx('nuxt'));
    expect(routesOf(r)).toEqual(['/', '/posts/:page?', '/pricing', '/user-:name', '/users', '/users/:id']);
    expect(byRoute(r, '/users')!.file).toBe('pages/users/index.vue');
    expect(byRoute(r, '/users/:id')!.guards![0]).toMatch(/auth middleware/);
    expect(byRoute(r, '/users/:id')!.samplePath).toBe('/users/ada');
    expect(skippedReasons(r).join()).toMatch(/\/:slug\*: catch-all at the root/);
  });

  it('SvelteKit: +page.svelte, (group), [[optional]], [...rest], [param=matcher], layout guards, entries()', async () => {
    const r = await scanRoutes(fx('sveltekit'));
    expect(routesOf(r)).toEqual(['/', '/:lang?/about', '/blog/:slug', '/dashboard', '/files/:path*', '/items/:id']);
    expect(byRoute(r, '/dashboard')!.guards).toEqual(['redirect to /login in src/routes/(app)/+layout.server.ts']);
    expect(byRoute(r, '/blog/:slug')!.samplePath).toBe('/blog/hello-svelte');
    expect(byRoute(r, '/:lang?/about')!.samplePath).toBe('/about');
  });

  it('Remix flat routes: _index, $param, pathless _layout, trailing _, ($optional), [escape], folders, resource routes', async () => {
    const r = await scanRoutes(fx('remix'));
    expect(routesOf(r)).toEqual(['/', '/:lang?/docs', '/about', '/concerts', '/concerts/:city', '/concerts/mine', '/dashboard', '/login', '/sitemap.xml']);
    expect(byRoute(r, '/concerts')!.file).toBe('app/routes/concerts._index.tsx');
    expect(byRoute(r, '/concerts/:city')!.samplePath).toBe('/concerts/berlin');
    expect(byRoute(r, '/dashboard')!.file).toBe('app/routes/dashboard/route.tsx');
    expect(byRoute(r, '/dashboard')!.guards![0]).toMatch(/requireUserId/);
    const reasons = skippedReasons(r).join('\n');
    expect(reasons).toMatch(/api\.health\.ts: resource route/);
    expect(reasons).toMatch(/\/:splat\*: catch-all at the root/);
  });

  it('React Router v7 app/routes.ts: index, route, layout, prefix', async () => {
    const r = await scanRoutes(fx('react-router-config'));
    expect(routesOf(r)).toEqual(['/', '/about', '/concerts', '/concerts/:city', '/concerts/trending', '/login', '/register']);
    expect(byRoute(r, '/concerts/:city')!.file).toBe('app/concerts/city.tsx');
    expect(byRoute(r, '/login')!.file).toBe('app/auth/login.tsx');
    expect(skippedReasons(r).join()).toMatch(/not-found/);
  });

  it('Astro: src/pages, _ excluded, endpoints excluded, getStaticPaths and content samples', async () => {
    const r = await scanRoutes(fx('astro'));
    expect(routesOf(r)).toEqual(['/', '/about', '/blog/:slug', '/docs/:path*']);
    expect(byRoute(r, '/blog/:slug')!.sampleHints.map((h) => h.value)).toEqual(['first-post', 'second-post']);
    expect(byRoute(r, '/docs/:path*')!.samplePath).toBe('/docs/getting-started');
  });

  it('TanStack Router file routes: index, $param, pathless _layout with beforeLoad, (group), -ignored, splat', async () => {
    const r = await scanRoutes(fx('tanstack-files'));
    expect(routesOf(r)).toEqual(['/', '/faq', '/files/:splat*', '/posts', '/posts/:postId', '/profile']);
    expect(byRoute(r, '/posts')!.kind).toBe('index');
    expect(byRoute(r, '/profile')!.guards).toEqual(['beforeLoad in src/routes/_auth.tsx']);
  });
});

describe('scan_routes: code-defined routers (TypeScript compiler API)', () => {
  it('React Router <Route> JSX: nesting, index, layout routes, guards, descendant <Routes> under path/*, redirects, tests ignored', async () => {
    const r = await scanRoutes(fx('react-router-jsx'));
    expect(routesOf(r)).toEqual(['/', '/app', '/app/reports/:reportId', '/settings', '/users', '/users/:userId']);
    expect(byRoute(r, '/')!.name).toBe('Home');
    expect(byRoute(r, '/settings')!.guards![0]).toMatch(/^<RequireAuth> at src\/App\.tsx:\d+$/);
    expect(byRoute(r, '/users/:userId')!.samplePath).toBe('/users/u-ada');
    expect(byRoute(r, '/app/reports/:reportId')!.file).toBe('src/AppRoutes.tsx');
    expect(byRoute(r, '/app/reports/:reportId')!.samplePath).toBe('/app/reports/q3-sales');
    const reasons = skippedReasons(r).join('\n');
    expect(reasons).toMatch(/\/old-home: redirect/);
    expect(reasons).toMatch(/not-found/);
  });

  it('Vue Router createRouter({ routes }): children, empty child path, :id(regex), redirects, meta / beforeEnter guards', async () => {
    const r = await scanRoutes(fx('vue-router'));
    expect(routesOf(r)).toEqual(['/', '/about', '/admin', '/admin/users', '/users/:id']);
    expect(r.routes.every((x) => x.framework === 'vue-router')).toBe(true);
    expect(byRoute(r, '/about')!.name).toBe('About');
    expect(byRoute(r, '/users/:id')!.guards![0]).toMatch(/meta\.requiresAuth/);
    expect(byRoute(r, '/users/:id')!.samplePath).toBe('/users/1001');
    expect(byRoute(r, '/admin/users')!.guards![0]).toMatch(/beforeEnter/);
    expect(skippedReasons(r).join('\n')).toMatch(/\/home: redirect/);
  });

  it('TanStack Router createRoute graph: parents, index, pathless layout, $param', async () => {
    const r = await scanRoutes(fx('tanstack-code'));
    expect(routesOf(r)).toEqual(['/', '/dashboard', '/posts', '/posts/:postId']);
    expect(byRoute(r, '/dashboard')!.guards![0]).toMatch(/beforeLoad/);
    expect(byRoute(r, '/posts')!.kind).toBe('index');
  });

  it('monorepo: finds the app package and resolves imported child route arrays', async () => {
    const r = await scanRoutes(fx('monorepo'));
    expect(r.apps.map((a) => a.dir)).toEqual(['apps/web']);
    expect(routesOf(r)).toEqual(['/', '/admin', '/admin/users/:userId']);
    expect(byRoute(r, '/admin/users/:userId')!.file).toBe('apps/web/src/admin/routes.tsx');
  });

  it('a folder without a router says so', async () => {
    const r = await scanRoutes(fileURLToPath(new URL('./fixtures/routes/monorepo/packages/ui', import.meta.url)));
    expect(r.routes).toEqual([]);
    expect(r.notes.join()).toMatch(/No router found/);
  });
});
