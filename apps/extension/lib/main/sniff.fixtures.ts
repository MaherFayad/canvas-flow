/**
 * Router objects recorded from real apps (Playwright, dev servers), trimmed to
 * what the sniffers read. Functions were recorded as source text and are
 * restored here as functions with the same body.
 *   - demoRouter: apps/demo (react-router 7, createBrowserRouter) → router.routes
 *   - vueRoutes: vue-router 4.5 `$router.getRoutes()` of a test app with nested,
 *     optional, regex and catch-all routes and a beforeEnter guard
 *   - next*: Next.js 15.5 dev, Pages Router `/about` and App Router `/studio/north`
 * Remix / React Router framework, SvelteKit and Angular are hand-written from
 * their documented shapes (not recorded: no app was run for them).
 */

export const demoRouter = [
  {
    id: '0',
    hasErrorBoundary: false,
    children: [
      { id: '0-0', path: '/', hasErrorBoundary: false },
      { id: '0-1', path: '/interests', hasErrorBoundary: false },
      { id: '0-2', path: '/catalog', hasErrorBoundary: false },
      { id: '0-3', path: '/product/:id', hasErrorBoundary: false },
      { id: '0-4', path: '/wishlist', hasErrorBoundary: false },
      { id: '0-5', path: '/bag', hasErrorBoundary: false },
      { id: '0-6', path: '/checkout', hasErrorBoundary: false },
      { id: '0-7', path: '/order-confirmed', hasErrorBoundary: false },
      { id: '0-8', path: '/classes', hasErrorBoundary: false },
      { id: '0-9', path: '/classes/:id', hasErrorBoundary: false },
      { id: '0-10', path: '/classes/:id/book', hasErrorBoundary: false },
      { id: '0-11', path: '/classes/:id/booked', hasErrorBoundary: false },
      { id: '0-12', path: '*', hasErrorBoundary: false },
    ],
  },
];

export const DEMO_PATTERNS = [
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
  '/*',
];

export const vueRoutes = [
  { path: '/users/:id(\\d+)/posts/:postId?', name: 'user-posts', meta: {} },
  { path: '/users/:id(\\d+)', name: 'user-home', meta: {} },
  { path: '/users/:id(\\d+)', meta: {} },
  { path: '/', name: 'home', meta: {} },
  { path: '/about', meta: {} },
  { path: '/admin', meta: {}, beforeEnter: () => '/login' },
  { path: '/login', meta: {} },
  { path: '/files/:path(.*)*', meta: {} },
  { path: '/:pathMatch(.*)*', meta: {} },
];

export const nextData = {
  props: { pageProps: {} },
  page: '/about',
  query: {},
  buildId: 'development',
  nextExport: true,
  autoExport: true,
  isFallback: false,
  scriptLoader: [],
};

export const nextBuildManifest = {
  __rewrites: { afterFiles: [], beforeFiles: [], fallback: [] },
  '/': ['static/chunks/pages/index.js'],
  '/about': ['static/chunks/pages/about.js'],
  sortedPages: ['/', '/_app', '/_error', '/about', '/account/settings', '/docs/[...slug]', '/orders/[id]', '/product/[id]'],
};

/** `self.__next_f` chunks of an App Router page in dev (trimmed around the page module). */
export const nextFlight: unknown[] = [
  [0],
  [
    1,
    'e],["Function.all","",0,0,0,0,true]]\n2d:{"name":"Studio","key":null,"env":"Server","stack":[],"props":{"params":"$@2e","searchParams":"$@2f"}}\n30:[["Studio","webpack-internal:///(rsc)/./app/studio/[id]/page.js",9,87,8,1,false]]\n31:[["Function.all","",0,0,0,0,tru',
  ],
  [1, '{"children":["__PAGE__",["$","$6","c",{"children":[["$","$L4","c-page",{"type":"page","pagePath":"studio/[id]/page.js","children":"$2c"},null,"$2b",1]'],
];

/** Raw string of Next.js dev `/_next/static/development/_buildManifest.js` (recorded). */
export const nextBuildManifestJs =
  'self.__BUILD_MANIFEST = (function(a){return {__rewrites:{afterFiles:[],beforeFiles:[],fallback:[]},__routerFilterStatic:a,__routerFilterDynamic:a,"/":["static\\u002Fchunks\\u002Fpages\\u002Findex.js"],"/_error":["static\\u002Fchunks\\u002Fpages\\u002F_error.js"],sortedPages:["\\u002F","\\u002F_app","\\u002F_error","\\u002Fproduct\\u002F[id]"]}}(void 0));self.__BUILD_MANIFEST_CB && self.__BUILD_MANIFEST_CB()';

/** Remix / React Router framework-mode manifest (documented shape). */
export const remixManifest = {
  routes: {
    root: { id: 'root', path: '', hasLoader: true },
    'routes/_index': { id: 'routes/_index', parentId: 'root', index: true },
    'routes/products': { id: 'routes/products', parentId: 'root', path: 'products' },
    'routes/products.$id': { id: 'routes/products.$id', parentId: 'routes/products', path: ':id' },
    'routes/docs.$': { id: 'routes/docs.$', parentId: 'root', path: 'docs/*' },
  },
};

/** Angular Router config as found on an injected Router (documented shape). */
export const angularConfig = [
  { path: '', component: class Home {} },
  { path: 'users/:id', component: class User {} },
  {
    path: 'admin',
    canActivate: [() => true],
    children: [
      { path: '', component: class AdminHome {} },
      { path: 'reports', component: class Reports {} },
    ],
  },
  { path: 'old', redirectTo: 'users/1' },
  { path: '**', component: class NotFound {} },
];

/** SvelteKit dev generated client (documented shape of `.svelte-kit/generated/client/app.js`). */
export const svelteKitClientJs = `export { matchers } from './matchers.js';
export const nodes = [() => import('./nodes/0'), () => import('./nodes/1')];
export const server_loads = [];
export const dictionary = {
		"/": [2],
		"/(app)/dashboard": [~3, [2]],
		"/blog/[slug]": [4],
		"/docs/[...rest]": [5],
		"/[[lang]]/about": [6]
	};
export const hooks = { handleError: (({ error }) => { console.error(error) }) };`;
