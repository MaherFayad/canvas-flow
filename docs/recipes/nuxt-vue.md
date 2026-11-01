# Recipe: Nuxt 3 and Vue 3

## Vue 3 + Vue Router (Vite)

```bash
npm i -D @flowcanvas/sdk
```

```ts
// main.ts
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { fc, screensFromRouter } from '@flowcanvas/sdk/vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'welcome', component: Welcome, meta: { fc: { group: 'onboarding' } } },
    { path: '/catalog', name: 'catalog', component: Catalog, meta: { fc: { group: 'onboarding', states: ['default', 'loading', 'empty', 'partial', 'error'] } } },
  ],
});

fc.init({ screens: screensFromRouter(router) }); // ids from route names, details from meta.fc
createApp(App).use(router).mount('#app');
```

```vue
<!-- Catalog.vue -->
<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { fc, useFcState } from '@flowcanvas/sdk/vue';

const state = useFcState(); // Readonly<Ref<string>>, updates when the canvas answers
const { data, pending, error } = useProducts(state);
watchEffect(() => {
  if (!pending.value) fc.ready();
});
</script>

<template>
  <CatalogSkeleton v-if="state === 'loading' || pending" />
  <ErrorState v-else-if="state === 'error' || error" />
  <EmptyState v-else-if="state === 'empty'" />
  <ProductGrid v-else :items="data" />
  <button v-bind="fc.target('checkout')">Checkout</button>
</template>
```

Add `flowCanvas()` from `@flowcanvas/sdk/vite` to `vite.config.ts` for the production strip (the `fcTarget` rewrite is for JSX only; in templates use `v-bind="fc.target('id')"` or plain `data-fc="id"`).

## Nuxt 3

Initialise on the client only, with a plugin:

```ts
// plugins/flow-canvas.client.ts
import { fc, screensFromRouter } from '@flowcanvas/sdk/vue';

export default defineNuxtPlugin((nuxtApp) => {
  if (import.meta.dev) fc.init({ screens: screensFromRouter(nuxtApp.$router as never) });
});
```

Per-page details go in `definePageMeta({ fc: { states: ['default', 'empty', 'error'] } })`, which lands in the route `meta` that `screensFromRouter` reads.

Server-rendered data (`useFetch`, `useAsyncData`) runs on the server first. Read the state from the query so SSR and the client agree:

```ts
// composables/useFcStateSsr.ts
export function useFcStateSsr() {
  const route = useRoute();
  return computed(() => (import.meta.dev && route.query['fc-frame'] ? String(route.query['fc-state'] ?? 'default') : 'default'));
}
```

```ts
const state = useFcStateSsr();
const { data } = await useFetch('/api/products', {
  key: () => `products-${state.value}`,
  transform: (d) => (state.value === 'empty' ? { items: [] } : d),
});
```

Without the SDK, client-side `$fetch` calls are mocked by the canvas from the config's `mocks`; server-side calls are not, which is why the query-based state above is the path for SSR data.
