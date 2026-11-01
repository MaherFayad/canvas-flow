// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeRoutes } from '../canvas/sniff';
import {
  appPagesFromFlight,
  flattenAngular,
  flattenReactRoutes,
  redirects,
  routesFromElements,
  sniffAngular,
  sniffNext,
  sniffReactFibers,
  sniffRouteManifest,
  sniffRoutes,
  sniffSvelteKit,
  sniffVue,
} from './sniff';
import { DEMO_PATTERNS, angularConfig, demoRouter, nextBuildManifest, nextData, nextFlight, remixManifest, vueRoutes } from './sniff.fixtures';

const EL = Symbol.for('react.transitional.element');
const FRAG = Symbol.for('react.fragment');
function Route() {}
function Routes() {}
function RouterProvider() {}
function RequireAuth() {}
const el = (type: unknown, props: Record<string, unknown>) => ({ $$typeof: EL, type, key: null, props });
const paths = (r: { path: string }[]) => r.map((x) => x.path);
const pats = (framework: string | null, r: { path: string; auth?: boolean }[]) => normalizeRoutes(framework, r).map((x) => x.pattern);

/** Minimal fiber: { type, memoizedProps, child, sibling, return }. */
type Fiber = Record<string, unknown>;
function fiber(type: unknown, props: Record<string, unknown>, children: Fiber[] = []): Fiber {
  const f: Fiber = { type, memoizedProps: props, child: null, sibling: null, return: null };
  children.forEach((c, i) => {
    c.return = f;
    if (i === 0) f.child = c;
    else children[i - 1]!.sibling = c;
  });
  return f;
}
function mount(root: unknown, legacy = false) {
  document.body.innerHTML = '<div id="root"></div>';
  const host = document.getElementById('root') as unknown as Record<string, unknown>;
  if (legacy) host._reactRootContainer = { _internalRoot: { current: root } };
  else host['__reactContainer$x1y2z3'] = root;
}

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__NEXT_DATA__', '__BUILD_MANIFEST', '__next_f', '__remixManifest', '__reactRouterManifest', 'ng', '__sveltekit_1abc', '__NUXT__'])
    delete (window as unknown as Record<string, unknown>)[k];
});

describe('React Router', () => {
  it('flattens the demo data router (recorded): 12 screens + the catch-all, nesting resolved', () => {
    expect(paths(flattenReactRoutes(demoRouter).list)).toEqual(DEMO_PATTERNS);
    expect(flattenReactRoutes(demoRouter).list.every((r) => !r.auth)).toBe(true);
  });

  it('joins relative children, keeps index routes, flags only visible redirects and guards', () => {
    const routes = [
      {
        path: '/app',
        loader: async () => {
          const user = null;
          if (!user) throw redirect('/login');
          return null;
        },
        children: [{ index: true }, { path: 'settings' }, { path: '/absolute' }],
      },
      { path: 'shop', children: [{ path: ':id?' }, { path: 'docs/*' }] },
      { path: 'account', loader: async () => ({ name: 'x' }) }, // name says nothing: no flag
      { path: 'vault', element: el(RequireAuth, {}) },
    ];
    const out = flattenReactRoutes(routes).list;
    expect(out).toEqual([
      { path: '/app', auth: true },
      { path: '/app/settings', auth: true },
      { path: '/absolute', auth: true },
      { path: '/shop' },
      { path: '/shop/:id?' },
      { path: '/shop/docs/*' },
      { path: '/account' },
      { path: '/vault', auth: true },
    ]);
  });

  it('finds a RouterProvider through the root container (createRoot and legacy roots)', () => {
    const tree = fiber('div', {}, [fiber(RouterProvider, { router: { routes: demoRouter } })]);
    for (const legacy of [false, true]) {
      mount(fiber(null, {}, [tree]), legacy);
      const r = sniffReactFibers(document, Date.now() + 1000)!;
      expect(r.framework).toBe('react-router');
      expect(paths(r.routes)).toEqual(DEMO_PATTERNS);
    }
  });

  it('reads <Routes><Route> elements (nested, fragments) and descendant <Routes> under a matched route', () => {
    const body = [
      el(Route, { path: '/', element: el('div', {}) }),
      el(FRAG, { children: [el(Route, { path: 'about', element: el('div', {}) })] }),
      el(Route, {
        path: 'users',
        element: el('div', {}),
        children: [el(Route, { index: true, element: el('div', {}) }), el(Route, { path: ':id', element: el('div', {}) })],
      }),
      el(Route, { path: 'app/*', element: el('div', {}) }),
    ];
    const nested = fiber(Routes, { children: [el(Route, { path: 'inbox', element: el('div', {}) }), el(Route, { path: 'inbox/:mid', element: el('div', {}) })] });
    const matched = fiber('ctx', { value: { matches: [{ route: { path: 'app/*' } }] } }, [nested]);
    const routesFiber = fiber(Routes, { children: body }, [matched]);
    mount(fiber(null, {}, [fiber('BrowserRouter', {}, [routesFiber])]));
    const r = sniffReactFibers(document, Date.now() + 1000)!;
    expect(r.meta).toEqual({ router: 'elements' });
    expect(paths(r.routes)).toEqual(['/', '/about', '/users', '/users/:id', '/app/*', '/app/inbox', '/app/inbox/:mid']);
    expect(routesFromElements([null, false, 'text'])).toEqual([]);
  });

  it('reads the Remix / framework-mode manifest (parentId tree)', () => {
    (window as unknown as Record<string, unknown>).__remixManifest = remixManifest;
    const r = sniffRouteManifest(window)!;
    expect(r.framework).toBe('remix');
    expect(paths(r.routes)).toEqual(['/', '/products', '/products/:id', '/docs/*']);
  });

  it('redirect detection reads loader source only', () => {
    expect(redirects(() => redirect('/login'))).toBe(true);
    expect(redirects(() => 1)).toBe(false);
    expect(redirects('redirect(')).toBe(false);
  });
});

describe('Vue Router / Nuxt', () => {
  it('getRoutes() (recorded): patterns normalised on the canvas side, beforeEnter flagged', () => {
    document.body.innerHTML = '<div id="app" data-v-app></div>';
    const routes = vueRoutes;
    (document.getElementById('app') as unknown as Record<string, unknown>).__vue_app__ = {
      config: { globalProperties: { $router: { getRoutes: () => routes } } },
    };
    const r = sniffVue(document, window)!;
    expect(r.framework).toBe('vue');
    expect(r.routes.find((x) => x.path === '/admin')).toEqual({ path: '/admin', auth: true });
    expect(r.routes.find((x) => x.path === '/users/:id(\\d+)')?.name).toBe('user-home');
    expect(pats('vue', r.routes)).toEqual(['/users/:id/posts/:postId?', '/users/:id', '/', '/about', '/admin', '/login', '/files/*', '/*']);
  });

  it('Nuxt: #__nuxt + __NUXT__; meta.requiresAuth guards children too; a throwing getRoutes is survived', () => {
    document.body.innerHTML = '<div id="__nuxt"></div>';
    (window as unknown as Record<string, unknown>).__NUXT__ = { state: {} };
    const app = document.getElementById('__nuxt') as unknown as Record<string, unknown>;
    app.__vue_app__ = { config: { globalProperties: { $router: { getRoutes: () => [{ path: '/account', meta: { requiresAuth: true } }, { path: '/account/billing', meta: {} }, { path: '/', meta: {} }] } } } };
    const r = sniffVue(document, window)!;
    expect(r.framework).toBe('nuxt');
    expect(r.routes).toEqual([{ path: '/account', auth: true }, { path: '/account/billing', auth: true }, { path: '/' }]);
    app.__vue_app__ = { config: { globalProperties: { $router: { getRoutes: () => { throw new Error('x'); } } } } };
    expect(sniffVue(document, window)).toEqual({ framework: 'nuxt', routes: [] });
  });
});

describe('Next.js', () => {
  it('Pages Router: __NEXT_DATA__ + __BUILD_MANIFEST.sortedPages (recorded); internals dropped on the canvas side', () => {
    const w = { __NEXT_DATA__: nextData, __BUILD_MANIFEST: nextBuildManifest };
    const r = sniffNext(w)!;
    expect(r.meta).toEqual({ buildId: 'development', page: '/about', router: 'pages' });
    expect(pats('next', r.routes)).toEqual(['/', '/about', '/account/settings', '/docs/*', '/orders/:id', '/product/:id']);
  });

  it('App Router: the page module named in dev flight data (recorded) gives the current route', () => {
    expect(appPagesFromFlight(nextFlight)).toEqual(['/studio/[id]']);
    const r = sniffNext({ __next_f: nextFlight })!;
    expect(r.meta).toEqual({ router: 'app' });
    expect(pats('next', r.routes)).toEqual(['/studio/:id']);
    expect(appPagesFromFlight([[1, '(rsc)/./src/app/(shop)/cart/[[...step]]/page.tsx'], [1, './app/page.js']])).toEqual(['/(shop)/cart/[[...step]]', '/']);
    expect(pats('next', [{ path: '/(shop)/cart/[[...step]]' }, { path: '/@modal/x' }])).toEqual(['/cart/*', '/x']);
  });
});

describe('SvelteKit and Angular (best effort, documented shapes)', () => {
  it('SvelteKit is detected by its __sveltekit_* global; routes come from the canvas-side fetch', () => {
    (window as unknown as Record<string, unknown>).__sveltekit_1abc = { base: '/app', env: {} };
    expect(sniffSvelteKit(window)).toEqual({ framework: 'sveltekit', routes: [], meta: { base: '/app' } });
  });

  it('Angular: Router config on the root component, canActivate flags the subtree, redirects skipped', () => {
    expect(paths(flattenAngular(angularConfig).list)).toEqual(['/', '/users/:id', '/admin', '/admin/reports', '/**']);
    expect(flattenAngular(angularConfig).list.find((r) => r.path === '/admin/reports')?.auth).toBe(true);
    document.body.innerHTML = '<app-root ng-version="18.2.0"></app-root>';
    const comp = { title: 'x', router: { config: angularConfig, navigate() {} } };
    (window as unknown as Record<string, unknown>).ng = { getComponent: () => comp };
    const r = sniffAngular(document, window)!;
    expect(r.meta).toEqual({ confidence: 'best-effort' });
    expect(pats('angular', r.routes)).toEqual(['/', '/users/:id', '/admin', '/admin/reports', '/*']);
  });
});

describe('sniffRoutes', () => {
  it('nothing recognised → framework null, no routes', () => {
    document.body.innerHTML = '<main>plain</main>';
    expect(sniffRoutes(window)).toEqual({ framework: null, routes: [] });
  });

  it('never throws on hostile globals and never writes to the app', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
    document.body.innerHTML = '<div id="root"></div><div data-v-app></div>';
    const root = document.getElementById('root') as unknown as Record<string, unknown>;
    root['__reactContainer$q'] = hostile;
    const w = window as unknown as Record<string, unknown>;
    w.__NEXT_DATA__ = hostile;
    w.__remixManifest = hostile;
    const before = JSON.stringify(Object.keys(w).sort());
    expect(() => sniffRoutes(window)).not.toThrow();
    expect(JSON.stringify(Object.keys(w).sort())).toBe(before);
  });

  it('stops walking fibers at the deadline', () => {
    let f = fiber(RouterProvider, { router: { routes: demoRouter } });
    for (let i = 0; i < 5000; i++) f = fiber('div', {}, [f]);
    mount(f);
    expect(sniffReactFibers(document, Date.now() - 1)).toBeNull();
    expect(sniffReactFibers(document, Date.now() + 5000)?.routes).toHaveLength(13);
  });
});

function redirect(to: string) {
  return new Response(null, { status: 302, headers: { location: to } });
}
