# `@flowcanvas/sdk` API reference

One tiny package (core under 2 KB gzipped, zero dependencies). It does nothing unless the page is inside a Flow Canvas frame, so it is safe to leave in dev builds, and it is replaced by a constant no-op in production builds.

```bash
npm i -D @flowcanvas/sdk
```

| Entry | For |
| --- | --- |
| `@flowcanvas/sdk` | Core: `fc` |
| `@flowcanvas/sdk/react` | `useFcState`, `useFcReady`, `<FcTarget>`, `screensFromRoutes` (React Router) |
| `@flowcanvas/sdk/next` | `fcStateFromSearchParams` (server components), `nextScreens` (Pages Router) |
| `@flowcanvas/sdk/vue` | `useFcState`, `screensFromRouter` (Vue Router) |
| `@flowcanvas/sdk/msw` | `fcHandlers` |
| `@flowcanvas/sdk/vite` | Vite plugin: `fcTarget` → `data-fc`, no-op SDK in production |
| `@flowcanvas/sdk/prod` | The no-op build (used automatically; see "Production") |

## Core: `fc`

```ts
import { fc } from '@flowcanvas/sdk';
```

| Call | Returns | What it does |
| --- | --- | --- |
| `fc.init(opts?)` | `void` | Starts the handshake with the canvas and sends the screen list for discovery. Call once, early (before the first render). No-op outside a canvas frame and in production. |
| `fc.active` | `boolean` | `true` only inside a canvas frame whose bridge answered the handshake (within 500 ms). |
| `fc.state()` | `string` | The forced state, or `'default'`. While the handshake is in flight it already returns the `fc-state` URL param, so the first render is right. |
| `fc.is(name)` | `boolean` | `fc.state() === name`. |
| `fc.ready()` | `void` | Tells the canvas the screen has settled (data loaded, fonts in). Screenshots and Player transitions wait for it. Sent once; sent automatically 1.5 s after `init` if you never call it. |
| `fc.target(id)` | `{ 'data-fc': id }` | Spread on an element to mark it as a trigger: `<button {...fc.target('get-started')}>`. Recorded edges then use `[data-fc="get-started"]`, which survives refactors. Works in production too. |
| `fc.on('state', fn)` | unsubscribe | Called when `fc.state()` may have changed (the welcome arrived, or the handshake gave up). |
| `fc.on('tokens', fn)` | unsubscribe | Token overrides from the canvas as `{ '--name': 'value' }`, for apps that keep tokens in JS (styled-components, Tamagui). CSS variables on `:root` are applied for you. |

`fc.init` options:

```ts
interface FcInitOptions {
  screens?: Array<{
    id: string;          // kebab-case, stable: edges point at it
    path: string;        // route, e.g. '/catalog'
    group?: string;      // section id on the canvas
    title?: string;
    states?: string[];   // first is the default; built-in badge names: default, loading, empty, partial, error, success
  }>;
}
```

### Using states in app code

```ts
// React Query
const { data, isLoading, error } = useQuery({
  queryKey: ['products'],
  queryFn: () => (fc.active ? fixtures.products[fc.state()] : api.products()),
});
```

```tsx
// Or at the top of a screen
if (fc.is('loading')) return <CatalogSkeleton />;
if (fc.is('error')) return <ErrorState onRetry={noop} />;
```

### How it stays safe

- Active only when the URL has `fc-frame`, the page is inside an iframe, and the Flow Canvas bridge answered `hello` within 500 ms. A random page that embeds your app cannot drive it.
- No `window` access at import time (SSR-safe).
- Talks only to the extension's content script through in-page events; no network.

## Production

The SDK must cost nothing in production. Three layers, any one is enough:

1. **Export condition**: the package's `production` export condition maps `@flowcanvas/sdk` to `dist/prod.js`, a constant no-op (`active: false`, `state() === 'default'`, `target()` still returns the attribute). Vite, webpack and Next.js honour it in production builds.
2. **`@flowcanvas/sdk/vite`** aliases `@flowcanvas/sdk` to `@flowcanvas/sdk/prod` in `vite build`.
3. **`process.env.NODE_ENV === 'production'`** turns the core into a no-op at runtime for bundlers that replace it.

## React: `@flowcanvas/sdk/react`

```tsx
import { useFcState, useFcReady, FcTarget, screensFromRoutes } from '@flowcanvas/sdk/react';

function Catalog() {
  const state = useFcState();              // re-renders when the canvas welcome arrives
  const { data, isLoading } = useProducts(state);
  useFcReady(!isLoading);                  // fc.ready() once settled
  return (
    <FcTarget id="product-card">
      <Link to="/product/1">…</Link>       {/* adds data-fc="product-card" to the child */}
    </FcTarget>
  );
}

// React Router: build the screen list from your route objects; details in handle.fc
fc.init({ screens: screensFromRoutes(routes) });
// { path: 'catalog', element: <Catalog />, handle: { fc: { id: 'catalog', group: 'browse', states: ['default', 'empty'] } } }
```

## Next.js: `@flowcanvas/sdk/next`

```tsx
// app/catalog/page.tsx (server component)
import { fcStateFromSearchParams } from '@flowcanvas/sdk/next';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const state = fcStateFromSearchParams(await searchParams); // 'default' unless fc-frame is present; always 'default' in production
  const products = state === 'empty' ? [] : await getProducts();
  …
}
```

`nextScreens()` reads the Pages Router build manifest in the browser. The App Router exposes no route list in the client, so declare screens by hand there. Recipe: [recipes/nextjs.md](./recipes/nextjs.md).

## Vue: `@flowcanvas/sdk/vue`

```ts
import { useFcState, screensFromRouter, fc } from '@flowcanvas/sdk/vue';
fc.init({ screens: screensFromRouter(router) }); // per-route details in meta.fc
const state = useFcState();                       // Readonly<Ref<string>>
```

## MSW: `@flowcanvas/sdk/msw`

```ts
import { fcHandlers } from '@flowcanvas/sdk/msw';
const worker = setupWorker(...fcHandlers({ default: handlers, empty: emptyHandlers, error: errorHandlers }));
```

Returns the handlers for `fc.state()`, falling back to `default`. Call after `fc.init()`. Recipe: [recipes/msw.md](./recipes/msw.md).

## Vite: `@flowcanvas/sdk/vite`

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { flowCanvas } from '@flowcanvas/sdk/vite';

export default defineConfig({ plugins: [flowCanvas(), react()] });
```

- Rewrites the JSX prop `fcTarget="id"` (or `fcTarget={expr}`) to `data-fc` in `.jsx` / `.tsx` files, using the TypeScript parser, so strings, comments and variables named `fcTarget` are never touched. Columns are kept, so source maps stay valid. On a component (`<Link fcTarget="x">`) the component receives `data-fc` and must pass it to its DOM element (most do).
- In `vite build` (mode other than `development`) aliases `@flowcanvas/sdk` to the no-op build.
- Needs `typescript` installed (it almost always is).

Options: `flowCanvas({ strip: 'auto' | true | false, include: /\.(jsx|tsx)$/, prop: 'fcTarget' })`.

To type the prop in TSX, add once (e.g. in `src/fc.d.ts`):

```ts
import 'react';
declare module 'react' {
  interface HTMLAttributes<T> {
    fcTarget?: string;
  }
}
```

## Protocol

The SDK and the extension share `@flowcanvas/protocol/lite` (constants, in-page channel, types). Messages between the canvas and frames are `{ fc: <type>, v: 1, nonce, frame, ...payload }`; see the "Message protocol" section of [BUILD_PLAN.md](./BUILD_PLAN.md).
