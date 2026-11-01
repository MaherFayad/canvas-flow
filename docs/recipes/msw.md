# Recipe: apps already on MSW

If your app already mocks its API with [MSW](https://mswjs.io), keep your handlers and let the canvas pick a set per state.

```ts
// mocks/browser.ts
import { setupWorker } from 'msw/browser';
import { http, HttpResponse, delay } from 'msw';
import { fcHandlers } from '@flowcanvas/sdk/msw';
import { handlers } from './handlers'; // your normal handlers

const empty = [http.get('/api/products', () => HttpResponse.json({ items: [] }))];
const error = [http.get('/api/products', () => HttpResponse.json({ error: 'server' }, { status: 500 }))];
const loading = [http.get('/api/products', async () => { await delay('infinite'); return HttpResponse.json({}); })];

export const worker = setupWorker(...fcHandlers({ default: handlers, empty: [...empty, ...handlers], error: [...error, ...handlers], loading: [...loading, ...handlers] }));
```

```ts
// main.ts
import { fc } from '@flowcanvas/sdk';

fc.init({ screens: [{ id: 'catalog', path: '/catalog', states: ['default', 'loading', 'empty', 'error'] }] });
if (import.meta.env.DEV) {
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

- Call `fcHandlers` after `fc.init()`: the state comes from the `fc-state` URL param right away, so the worker starts with the right set before the canvas answers.
- Unknown states fall back to `default`.
- Handlers are matched in order, so put the state-specific ones first and your normal handlers after them.
- Node (`msw/node`, for SSR or API routes) works the same with `setupServer(...fcHandlers(map))`, but the state must reach the server: read it from the request URL or pass it along (see [nextjs.md](./nextjs.md)).

## Without the SDK

The canvas has its own mock layer for apps without the SDK: `mocks` in `flowcanvas.config.json`, keyed `"<screenId>:<state>"`, answering `fetch` and XHR in canvas frames. It wraps `fetch` in the page, so a matching rule answers before the request reaches MSW's service worker; unmatched requests continue to MSW as usual. The canvas sends the rules for a frame's `<screenId>:<state>` whenever the config has some, so with `fcHandlers` leave `mocks` empty for those states and MSW stays the only mock layer.
