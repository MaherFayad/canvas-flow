# Recipe: Vite + React (+ React Router)

The demo app (`apps/demo`) is this setup; read it for a full example with 12 screens and 5 states each.

## 1. Install

```bash
npm i -D @flowcanvas/sdk
```

## 2. Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { flowCanvas } from '@flowcanvas/sdk/vite';

export default defineConfig({
  plugins: [flowCanvas(), react()],
});
```

`fcTarget="id"` props become `data-fc="id"`, and `vite build` ships the no-op SDK.

## 3. Declare screens

From your React Router route objects, with per-route details in `handle.fc`:

```tsx
// main.tsx
import { createBrowserRouter, RouterProvider } from 'react-router';
import { fc } from '@flowcanvas/sdk';
import { screensFromRoutes } from '@flowcanvas/sdk/react';

const routes = [
  { path: '/', element: <Welcome />, handle: { fc: { id: 'welcome', group: 'onboarding' } } },
  { path: '/catalog', element: <Catalog />, handle: { fc: { id: 'catalog', group: 'onboarding', states: ['default', 'loading', 'empty', 'partial', 'error'] } } },
];

fc.init({ screens: screensFromRoutes(routes) });
createRoot(document.getElementById('root')!).render(<RouterProvider router={createBrowserRouter(routes)} />);
```

Or list them by hand: `fc.init({ screens: [{ id: 'catalog', path: '/catalog', states: [...] }] })`.

## 4. Render the forced state

A small data hook keeps screens clean (this is what the demo's `useApi` does):

```tsx
import { useFcReady, useFcState } from '@flowcanvas/sdk/react';

const FIXTURES: Record<string, { status: number; body: unknown } | 'pending'> = {
  loading: 'pending',
  empty: { status: 200, body: { items: [] } },
  error: { status: 500, body: { error: 'server' } },
};

export function useApi<T>(url: string) {
  const state = useFcState();
  const [res, setRes] = useState<{ phase: 'loading' } | { phase: 'ok'; data: T } | { phase: 'error' }>({ phase: 'loading' });
  useEffect(() => {
    const fx = state === 'default' ? undefined : FIXTURES[state];
    if (fx === 'pending') return setRes({ phase: 'loading' });
    if (fx) return setRes(fx.status < 300 ? { phase: 'ok', data: fx.body as T } : { phase: 'error' });
    fetch(url).then(async (r) => setRes(r.ok ? { phase: 'ok', data: await r.json() } : { phase: 'error' }));
  }, [url, state]);
  useFcReady(res.phase !== 'loading' || state === 'loading'); // screenshots and Player wait for this
  return res;
}
```

## 5. Mark triggers

```tsx
<button fcTarget="get-started">Get started</button>        // with the Vite plugin
<Link to="/catalog" {...fc.target('skip')}>Skip</Link>      // without it
```

## No SDK?

Run the app as is and add `mocks` to `flowcanvas.config.json`; the canvas answers the app's `fetch` calls per state. The demo shows both: `VITE_FC_SDK=0 pnpm --filter @flowcanvas/demo dev` runs it without the SDK.
