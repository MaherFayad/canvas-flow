/** @flowcanvas/sdk/react: hooks and a target wrapper for React 18+. */
import { Children, cloneElement, isValidElement, useEffect, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { fc, type FcScreen } from './index';

const subscribe = (cb: () => void) => fc.on('state', cb);
const serverState = () => 'default';

/** The forced state for this frame ('default' outside the canvas). Re-renders when the canvas welcome arrives. */
export function useFcState(): string {
  return useSyncExternalStore(subscribe, fc.state, serverState);
}

/** Call `fc.ready()` once `settled` turns true (data loaded, images in). */
export function useFcReady(settled = true): void {
  useEffect(() => {
    if (settled) fc.ready();
  }, [settled]);
}

/** Marks its only child as a canvas target: `<FcTarget id="get-started"><Link …/></FcTarget>` adds `data-fc="get-started"`. */
export function FcTarget({ id, children }: { id: string; children: ReactNode }): ReactElement | null {
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  return cloneElement(child as ReactElement<Record<string, unknown>>, fc.target(id));
}

/** Minimal shape of a React Router route object. */
export interface FcRouteLike {
  path?: string;
  index?: boolean;
  id?: string;
  children?: FcRouteLike[];
  handle?: { fc?: { id?: string; group?: string; title?: string; states?: string[] } };
}

/**
 * Turn a React Router route tree into a screen list for `fc.init({ screens })`.
 * Per-route details go in `handle.fc`. Layout routes (with children; their page is
 * the index child), pathless and splat routes are skipped.
 */
export function screensFromRoutes(routes: FcRouteLike[], base = ''): FcScreen[] {
  const out: FcScreen[] = [];
  for (const r of routes) {
    const seg = r.index ? '' : r.path ?? '';
    const full = seg.startsWith('/') ? seg : `${base.replace(/\/$/, '')}/${seg}`.replace(/\/+/g, '/');
    if ((r.index || r.path) && !r.children?.length && !seg.includes('*')) {
      const meta = r.handle?.fc ?? {};
      const id = meta.id ?? r.id ?? (full.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'home');
      out.push({ id, path: full || '/', group: meta.group, title: meta.title, states: meta.states });
    }
    if (r.children) out.push(...screensFromRoutes(r.children, r.path ? full : base));
  }
  return out;
}

export { fc };
