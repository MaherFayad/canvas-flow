# Recipe: Next.js (App Router, server components)

In the App Router most data is fetched on the server, where the browser SDK cannot help and the canvas's fetch mock layer cannot see the requests. The forced state is in the URL, though (`?fc-frame=…&fc-state=empty`), so server components read it from `searchParams`.

## 1. Install

```bash
npm i -D @flowcanvas/sdk
```

## 2. Server components: read the state from `searchParams`

```tsx
// app/catalog/page.tsx
import { fcStateFromSearchParams } from '@flowcanvas/sdk/next';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CatalogPage({ searchParams }: Props) {
  const state = fcStateFromSearchParams(await searchParams);

  if (state === 'loading') return <CatalogSkeleton />;
  if (state === 'error') return <ErrorState />;
  const products = state === 'empty' ? [] : state === 'partial' ? (await getProducts()).slice(0, 6) : await getProducts();
  return <Catalog products={products} />;
}
```

`fcStateFromSearchParams` returns `'default'` unless `fc-frame` is present too, and always `'default'` in production. (On Next 14 `searchParams` is a plain object; pass it directly.)

Reading `searchParams` makes the route dynamic, which is what you want in dev. If a page must stay static, wrap the state branch in a component under `<Suspense>` or read the state in a client component instead.

`loading.tsx` shows during navigation only; to show the loading state on the canvas, render the skeleton for `state === 'loading'` as above.

## 3. Client side: handshake, ready, targets

Create one client component and mount it in the root layout:

```tsx
// app/flow-canvas.tsx
'use client';
import { useEffect } from 'react';
import { fc } from '@flowcanvas/sdk';

const SCREENS = [
  { id: 'home', path: '/', group: 'onboarding' },
  { id: 'catalog', path: '/catalog', group: 'browse', states: ['default', 'loading', 'empty', 'partial', 'error'] },
];

export function FlowCanvas() {
  useEffect(() => {
    fc.init({ screens: SCREENS });
  }, []);
  return null;
}
```

```tsx
// app/layout.tsx
import { FlowCanvas } from './flow-canvas';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV !== 'production' && <FlowCanvas />}
        {children}
      </body>
    </html>
  );
}
```

The App Router has no client-side route list, so declare screens by hand. Pages Router apps can use `nextScreens()` from `@flowcanvas/sdk/next`, which reads the build manifest.

Client components use `useFcState()` from `@flowcanvas/sdk/react` as in any React app. Mark triggers with `{...fc.target('id')}` (works in server components too: it only returns `{ 'data-fc': id }`).

## 4. Production

Next.js resolves the `production` export condition in `next build`, so the SDK becomes the no-op build. `fcStateFromSearchParams` checks `NODE_ENV` itself.

## Route handlers and MSW

If data comes from your own API routes, you can instead mock at the API level with MSW in Node (`msw/node`) and pick handlers with `fcHandlers` (see [msw.md](./msw.md)); pass the state from the page to the API call, since route handlers do not see the page URL.
