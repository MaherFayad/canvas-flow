/**
 * Discovery (feature 2, minimum viable): a hidden iframe loads `/`.
 * If the app's SDK sends `screens`, those become the screens. Otherwise a
 * crawl follows same-origin links 2 levels deep, max 50 pages, skipping
 * logout / signout / delete / remove, and lays the paths out in "Unsorted".
 */
import { useEffect, useRef } from 'react';
import { frameUrl, type Message, type MessageOf, type ScreenDecl } from '@flowcanvas/protocol';
import { Crawler } from '@/lib/canvas/discover';
import { WINDOW_NAME_PREFIX } from '@/lib/frame';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { useHost } from './host';

const PAGE_TIMEOUT_MS = 6000;

export function Discovery({ run }: { run: number }) {
  const host = useHost();
  const origin = useUi((s) => s.origin);
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!run || !host || !origin) return;
    let cancelled = false;
    const iframe = ref.current!;

    const loadPage = (path: string, n: number) =>
      new Promise<{ links: string[]; screens: ScreenDecl[] | null } | null>((resolve) => {
        const frameId = `discover~${n}~${Math.random().toString(36).slice(2, 7)}`;
        host.register(frameId, { screen: '__discover', state: 'default', path, discover: true }, iframe);
        let settled = false;
        const finish = (v: { links: string[]; screens: ScreenDecl[] | null } | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          off();
          host.unregister(frameId);
          resolve(v);
        };
        const timer = setTimeout(() => finish(null), PAGE_TIMEOUT_MS);
        const off = host.subscribe((f, msg: Message) => {
          if (f.frameId !== frameId) return;
          if (msg.fc === 'screens' && msg.screens.length) finish({ links: [], screens: msg.screens });
          if (msg.fc === 'ready') {
            void host.request<MessageOf<'links-result'>>(frameId, { fc: 'links', id: '' }, 2000).then((r) => finish({ links: r?.links ?? [], screens: null }));
          }
        });
        iframe.name = WINDOW_NAME_PREFIX + frameId;
        iframe.src = frameUrl(origin, path, frameId, 'default');
      });

    void (async () => {
      const crawler = new Crawler('/');
      const found: string[] = [];
      let sdk: ScreenDecl[] | null = null;
      let n = 0;
      useUi.getState().set({ discovery: { running: true, done: 0, total: 1 } });
      for (let page = crawler.next(); page && !cancelled; page = crawler.next()) {
        const r = await loadPage(page.path, n++);
        if (cancelled) return;
        if (r) {
          found.push(page.path);
          if (r.screens) {
            sdk = r.screens;
            break;
          }
          crawler.addLinks(r.links, page.depth);
        }
        useUi.getState().set({ discovery: { running: true, done: found.length, total: found.length + crawler.pending } });
      }
      iframe.src = 'about:blank';
      if (cancelled) return;
      if (sdk) useProject.getState().addSdkScreens(sdk);
      else if (found.length) useProject.getState().addDiscoveredPaths(found);
      const count = sdk ? sdk.length : found.length;
      const note = count
        ? `Discovered ${count} screen${count > 1 ? 's' : ''}${sdk ? ' from the SDK' : ' by crawling links'}.`
        : `Could not reach ${origin}. Is the dev server running?`;
      useUi.getState().set({ discovery: { running: false, done: count, total: count, note }, announce: note });
    })();
    return () => {
      cancelled = true;
    };
  }, [run, host, origin]);

  return (
    <iframe
      ref={ref}
      title="Screen discovery"
      aria-hidden
      tabIndex={-1}
      width={1280}
      height={800}
      style={{ position: 'fixed', insetInlineStart: -20000, insetBlockStart: 0, border: 0, visibility: 'hidden' }}
    />
  );
}
