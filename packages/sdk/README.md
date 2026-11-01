# @flowcanvas/sdk

Show your app in any state on the [Flow Canvas](https://github.com/MaherFayad/canvas-flow): loading, empty, partial, error, side by side, one click each. Under 2 KB gzipped, zero dependencies, a no-op outside the canvas and in production.

```bash
npm i -D @flowcanvas/sdk
```

```ts
import { fc } from '@flowcanvas/sdk';

fc.init({
  screens: [
    { id: 'welcome', path: '/', group: 'onboarding' },
    { id: 'catalog', path: '/catalog', group: 'onboarding', states: ['default', 'loading', 'empty', 'partial', 'error'] },
  ],
});

// In a screen
if (fc.is('loading')) return <CatalogSkeleton />;
if (fc.is('error')) return <ErrorState />;

// Mark a trigger: recorded flows get [data-fc="get-started"]
<button {...fc.target('get-started')}>Get started</button>
```

| Call | What it does |
| --- | --- |
| `fc.init({ screens })` | Handshake with the canvas; sends the screen list for discovery. |
| `fc.active` | `true` only inside a canvas frame that answered the handshake. |
| `fc.state()` / `fc.is(name)` | The forced state (`'default'` otherwise). |
| `fc.ready()` | The screen has settled; screenshots and Player transitions wait for it (auto after 1.5 s). |
| `fc.target(id)` | `{ 'data-fc': id }` to spread on a trigger element. |
| `fc.on('state' \| 'tokens', fn)` | Subscribe; returns an unsubscribe function. |

Adapters: `@flowcanvas/sdk/react` (`useFcState`, `useFcReady`, `<FcTarget>`, `screensFromRoutes`), `/next` (`fcStateFromSearchParams` for server components, `nextScreens`), `/vue` (`useFcState`, `screensFromRouter`), `/msw` (`fcHandlers`), `/vite` (plugin: `fcTarget="id"` → `data-fc`, no-op SDK in production builds).

Production builds get `dist/prod.js` (a constant no-op) through the `production` export condition, the Vite plugin, or a `NODE_ENV` check.

Docs: [SDK reference](https://github.com/MaherFayad/canvas-flow/blob/main/docs/sdk.md) · [recipes](https://github.com/MaherFayad/canvas-flow/tree/main/docs/recipes) · [getting started](https://github.com/MaherFayad/canvas-flow/blob/main/docs/getting-started.md)

MIT © 2026 Maher Fayad
