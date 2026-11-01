/** @flowcanvas/sdk/vue: composables for Vue 3. */
import { getCurrentScope, onScopeDispose, readonly, shallowRef, type Ref } from 'vue';
import { fc, type FcScreen } from './index';

/** Reactive forced state ('default' outside the canvas). Updates when the canvas welcome arrives. */
export function useFcState(): Readonly<Ref<string>> {
  const s = shallowRef(fc.state());
  const off = fc.on('state', (v) => {
    s.value = v;
  });
  if (getCurrentScope()) onScopeDispose(off);
  return readonly(s);
}

/** Minimal shape of a Vue Router route record (`router.getRoutes()`). */
export interface FcVueRouteLike {
  path: string;
  name?: string | symbol | null | undefined;
  meta?: { fc?: { id?: string; group?: string; title?: string; states?: string[] } } & Record<string, unknown>;
}

/** Screen list from `router.getRoutes()`; per-route details go in `meta.fc`. Catch-all routes are skipped. */
export function screensFromRouter(router: { getRoutes(): FcVueRouteLike[] }): FcScreen[] {
  return router
    .getRoutes()
    .filter((r) => !r.path.includes('(.*)') && !r.path.includes('*'))
    .map((r) => {
      const meta = r.meta?.fc ?? {};
      const id = meta.id ?? (typeof r.name === 'string' ? r.name : r.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'home');
      return { id, path: r.path, group: meta.group, title: meta.title, states: meta.states };
    });
}

export { fc };
