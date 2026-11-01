/**
 * Discovery (feature 2). A hidden iframe loads the app's pages; sources:
 *   1. SDK `screens` (best),
 *   2. router sniffing in the page (React Router, Next.js, Vue Router / Nuxt,
 *      Remix, SvelteKit, Angular) plus the dev server's manifests,
 *   3. a crawl: sitemap, same-origin links and safe clicks on link-like
 *      elements (depth 3, max 60 pages), stopping at a login wall.
 * Dynamic routes get a real sample path (crawl → SDK → inferred → asked once).
 * Everything lands in the project as one undo step, with a small report.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { frameUrl, type Clickable, type Message, type MessageOf, type ScreenDecl, type SniffedRoute } from '@flowcanvas/protocol';
import {
  CRAWL_MAX_PAGES,
  Crawler,
  detectAuthWall,
  emptyReport,
  mergeDiscovery,
  pickSamples,
  type DiscoveryReport,
  type SampleChoice,
  type Visit,
} from '@/lib/canvas/discover';
import { makeFetcher, nextPages, normalizeRoutes, screenRoutes, sitemapPaths, svelteKitRoutes, type RouteFound } from '@/lib/canvas/sniff';
import { DISCOVER_PREFIX } from '@/lib/main/guard';
import { MAX_CLICKS_PER_PAGE } from '@/lib/routes/safety';
import { isDynamic, matchPattern } from '@/lib/routes/pattern';
import { WINDOW_NAME_PREFIX } from '@/lib/frame';
import { normPath } from '@/lib/url';
import { useProject } from '@/store/project';
import { useUi } from '@/store/ui';
import { useHost } from './host';

const PAGE_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 3000;
/** Whole run (without the time the user spends in the samples dialog). */
const TOTAL_BUDGET_MS = 150_000;
/** Time spent on probe clicks (each reloads the page first). */
const CLICK_BUDGET_MS = 60_000;
/** Probe clicks only on pages this shallow. */
const CLICK_MAX_DEPTH = 2;

interface PageResult {
  landed: string;
  links: string[];
  screens: ScreenDecl[] | null;
  routes: MessageOf<'routes-result'> | null;
  clickables: Clickable[];
}

type Ask = { patterns: string[]; resolve: (samples: Record<string, string> | null) => void };

export function Discovery({ run }: { run: number }) {
  const host = useHost();
  const origin = useUi((s) => s.origin);
  const ref = useRef<HTMLIFrameElement>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  useEffect(() => {
    if (!run || !host || !origin) return;
    let cancelled = false;
    const iframe = ref.current!;
    let seq = 0;
    const t0 = Date.now();
    const setUi = (p: Partial<NonNullable<ReturnType<typeof useUi.getState>['discovery']>>) => {
      const d = useUi.getState().discovery ?? { running: true, done: 0, total: 1 };
      useUi.getState().set({ discovery: { ...d, ...p } });
    };

    /** Load `path` in the hidden frame; run `onReady` once it is ready (or after a full-page navigation away). */
    const withPage = <T,>(path: string, onReady: (frameId: string, screens: () => ScreenDecl[] | null) => Promise<T>, onNav?: (to: string) => T | undefined) =>
      new Promise<T | null>((resolve) => {
        const frameId = `${DISCOVER_PREFIX}${seq++}~${Math.random().toString(36).slice(2, 7)}`;
        host.register(frameId, { screen: '__discover', state: 'default', path, discover: true }, iframe);
        let settled = false;
        let screens: ScreenDecl[] | null = null;
        let readySeen = false;
        const finish = (v: T | null) => {
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
          if (msg.fc === 'screens' && msg.screens.length) screens = msg.screens;
          else if (msg.fc === 'nav') {
            if (readySeen && onNav) {
              const v = onNav(msg.to);
              if (v !== undefined) finish(v);
            }
          } else if (msg.fc === 'ready' && !readySeen) {
            readySeen = true;
            void onReady(frameId, () => screens).then(finish, () => finish(null));
          }
        });
        iframe.name = WINDOW_NAME_PREFIX + frameId;
        iframe.src = frameUrl(origin, path, frameId, 'default');
      });

    const loadPage = (path: string, opts: { routes: boolean }) =>
      withPage<PageResult>(path, async (frameId, sdkScreens) => {
        const [links, routes, clicks] = await Promise.all([
          host.request<MessageOf<'links-result'>>(frameId, { fc: 'links', id: '' }, PROBE_TIMEOUT_MS),
          opts.routes ? host.request<MessageOf<'routes-result'>>(frameId, { fc: 'routes', id: '' }, PROBE_TIMEOUT_MS) : Promise.resolve(null),
          host.request<MessageOf<'clickables-result'>>(frameId, { fc: 'clickables', id: '' }, PROBE_TIMEOUT_MS),
        ]);
        // Where the page is now (server redirect = second hello, client redirect = nav; frameHost tracks both).
        const landed = host.frames.get(frameId)?.currentPath ?? path;
        return { landed, links: links?.links ?? [], screens: sdkScreens(), routes, clickables: clicks?.items ?? [] };
      });

    /** Reload `path`, click candidate `c`, report where the page went (null = nowhere new). */
    const clickOn = (path: string, c: Clickable) =>
      withPage<string | null>(
        path,
        async (frameId) => {
          const r = await host.request<MessageOf<'click-probe-result'>>(frameId, { fc: 'click-probe', id: '', index: c.index, label: c.label }, PROBE_TIMEOUT_MS);
          return r?.ok ? r.url : null;
        },
        (to) => to, // full-page navigation: the bridge says hello from the new page
      );

    void (async () => {
      const report: DiscoveryReport = emptyReport();
      const crawler = new Crawler('/');
      const seen: string[] = [];
      const seenSet = new Set<string>();
      const see = (p: string) => {
        const n = normPath(p);
        if (!seenSet.has(n)) {
          seenSet.add(n);
          seen.push(n);
        }
      };
      const crawled: string[] = [];
      const visits: Visit[] = [];
      let sdk: ScreenDecl[] | null = null;
      let framework: string | null = null;
      const raw: SniffedRoute[] = [];
      let routes: RouteFound[] = [];
      let perPageRoutes = false;
      let sniffed = false;
      const tried = new Set<string>();
      const skipped = new Map<string, string>();
      let clickMs = 0;
      const fetcher = makeFetcher();
      const sitemap = sitemapPaths(origin, fetcher).catch(() => [] as string[]);
      let sitemapAdded = false;

      const patterns = () => screenRoutes(routes).map((r) => r.pattern);
      const missing = () => pickSamples(patterns(), seen, sdk?.map((d) => d.path) ?? []).missing;
      const progress = (msg: string) =>
        setUi({ running: true, done: crawled.length, total: Math.max(crawled.length + crawler.pending, 1), note: msg });

      progress('Discovering screens… reading the app’s routes');
      for (let page = crawler.next(); page && !cancelled; page = crawler.next()) {
        if (Date.now() - t0 > TOTAL_BUDGET_MS) break;
        const r = await loadPage(page.path, { routes: !sniffed || perPageRoutes });
        if (cancelled) return;
        if (r) {
          const landed = normPath(r.landed);
          visits.push({ requested: normPath(page.path), landed });
          see(landed);
          crawler.know(landed);
          if (!crawled.includes(landed)) crawled.push(landed);
          if (r.screens && !sdk) sdk = r.screens;
          for (const l of r.links) see(l);
          crawler.addLinks(r.links, page.depth);

          if (r.routes && !sniffed) {
            sniffed = true;
            framework = r.routes.framework;
            raw.push(...r.routes.routes);
            if (framework === 'next') {
              raw.push(...(await nextPages(origin, r.routes.meta, fetcher)).map((p) => ({ path: p })));
              // App Router pages are only named in their own page's flight data: sniff every page, crawl on.
              perPageRoutes = true;
            } else if (framework === 'sveltekit') {
              raw.push(...(await svelteKitRoutes(origin, fetcher)).map((p) => ({ path: p })));
            }
          } else if (r.routes) raw.push(...r.routes.routes);
          routes = normalizeRoutes(framework, raw);

          if (!sitemapAdded) {
            sitemapAdded = true;
            for (const p of await sitemap) {
              see(p);
              crawler.add(p, 1);
            }
          }

          // Unsafe link-like elements: listed, never clicked.
          for (const c of r.clickables) if (c.skip && !skipped.has(c.label)) skipped.set(c.label, c.skip);

          // Login wall: three or more pages land on the same other URL.
          const wall = detectAuthWall(visits);
          if (wall) {
            report.authWall = wall;
            crawler.stop();
            break;
          }

          // The SDK and the router are the authorities; then the crawl only has to find samples.
          // (Next.js is the exception: App Router pages show up one page at a time.)
          const needSamples = missing().length > 0;
          // A redirected start page hints at a login wall: load a few known routes to confirm before stopping.
          const checkWall = visits.length < 3 && visits.some((v) => v.requested !== v.landed);
          if (checkWall) for (const p of patterns().filter((x) => !isDynamic(x)).slice(0, 4)) crawler.add(p, 1);
          if ((sdk || (routes.length > 0 && framework !== 'next')) && !needSamples && !checkWall) break;

          // Probe clicks: buttons in nav / tabs / role=link / data-fc, safe ones only, each signature once.
          // Only when no router was read, or a dynamic route still has no sample.
          if ((routes.length === 0 || needSamples) && page.depth <= CLICK_MAX_DEPTH && clickMs < CLICK_BUDGET_MS) {
            let n = 0;
            for (const c of r.clickables) {
              if (c.skip || n >= MAX_CLICKS_PER_PAGE || clickMs >= CLICK_BUDGET_MS || cancelled) continue;
              const sig = `${c.target}|${c.label}`;
              if (tried.has(sig)) continue;
              tried.add(sig);
              n++;
              const start = Date.now();
              const to = await clickOn(page.path, c);
              clickMs += Date.now() - start;
              report.clicks++;
              if (to && normPath(to) !== normPath(page.path)) {
                see(to);
                crawler.add(to, page.depth + 1);
              }
              progress(`Discovering screens… ${crawled.length} pages, ${report.clicks} clicks`);
            }
          }
        }
        const fw = framework ? ` · ${routes.length} routes from ${framework}` : '';
        progress(`Discovering screens… ${crawled.length}/${CRAWL_MAX_PAGES} pages${fw}`);
      }
      iframe.src = 'about:blank';
      if (cancelled) return;

      // Samples for dynamic routes; ask once for the ones the crawl could not find.
      const pats = patterns();
      const { chosen, missing: miss } = pickSamples(pats, seen, sdk?.map((d) => d.path) ?? []);
      const samples = new Map<string, SampleChoice>(chosen);
      if (miss.length && !report.authWall) {
        const answer = await new Promise<Record<string, string> | null>((resolve) => setAsk({ patterns: miss, resolve }));
        setAsk(null);
        if (cancelled) return;
        for (const [p, v] of Object.entries(answer ?? {})) if (v) samples.set(p, { path: normPath(v), from: 'user' });
      }

      // One undo step for the whole discovery.
      let merged: ReturnType<typeof mergeDiscovery> | null = null;
      useProject.getState().update((c) => {
        merged = mergeDiscovery(c, { sdk, routes, crawled, samples });
        return merged.config;
      });
      const m = merged as ReturnType<typeof mergeDiscovery> | null;

      report.framework = framework;
      report.found = { sdk: sdk?.length ?? 0, router: screenRoutes(routes).length, crawl: crawled.length };
      report.added = m?.added ?? { sdk: 0, router: 0, crawl: 0 };
      report.existing = m?.existing ?? 0;
      report.needsSample = m?.needsSample ?? [];
      report.samples = [...samples].map(([route, s]) => ({ route, path: s.path, from: s.from }));
      report.authRoutes = routes.filter((x) => x.auth).map((x) => x.pattern);
      report.skippedClicks = [...skipped].map(([label, why]) => `${label}: ${why}`);
      report.pages = crawled.length;
      report.ms = Date.now() - t0;

      const added = report.added.sdk + report.added.router + report.added.crawl;
      const reached = crawled.length > 0;
      const note = report.authWall
        ? `Most pages redirect to ${report.authWall}. Log in to the app in a normal tab, then Discover again.`
        : !reached
          ? `Could not reach ${origin}. Is the dev server running?`
          : added
            ? `Discovered ${added} screen${added > 1 ? 's' : ''}${sourcesLine(report.added)}.`
            : report.existing
              ? 'No new screens: everything found is already on the canvas.'
              : 'No screens found.';
      useUi.getState().set({ discovery: { running: false, done: added, total: added, note, report }, announce: note });
    })();
    return () => {
      cancelled = true;
      setAsk((a) => (a?.resolve(null), null));
    };
  }, [run, host, origin]);

  return (
    <>
      <iframe
        ref={ref}
        title="Screen discovery"
        aria-hidden
        tabIndex={-1}
        width={1280}
        height={800}
        style={{ position: 'fixed', insetInlineStart: -20000, insetBlockStart: 0, border: 0, visibility: 'hidden' }}
      />
      {ask && <SamplesDialog patterns={ask.patterns} onDone={ask.resolve} />}
      <DiscoveryReportCard />
    </>
  );
}

function sourcesLine(a: Record<'sdk' | 'router' | 'crawl', number>): string {
  const parts = [a.sdk && `${a.sdk} from the SDK`, a.router && `${a.router} from the router`, a.crawl && `${a.crawl} by crawling`].filter(Boolean);
  return parts.length ? `: ${parts.join(', ')}` : '';
}

/** Asks once for a sample path per dynamic route the crawl could not find. Blank = skip that route. */
function SamplesDialog({ patterns, onDone }: { patterns: string[]; onDone: (v: Record<string, string> | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const bad = (p: string) => {
    const v = values[p]?.trim();
    return !!v && !matchPattern(p, v.startsWith('/') ? v : `/${v}`);
  };
  const anyBad = patterns.some(bad);
  const done = (v: Record<string, string> | null) => {
    ref.current?.close();
    onDone(v);
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby="samples-title"
      className="m-auto w-[440px] max-w-[92vw] rounded-lg border border-[#e6e6e6] p-0 backdrop:bg-black/20"
      style={{ boxShadow: 'var(--fc-shadow)', fontSize: 11 }}
      onCancel={(e) => {
        e.preventDefault();
        done(null);
      }}
    >
      <form
        method="dialog"
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (anyBad) return;
          const out: Record<string, string> = {};
          for (const p of patterns) {
            const v = values[p]?.trim();
            if (v) out[p] = v.startsWith('/') ? v : `/${v}`;
          }
          done(out);
        }}
      >
        <div>
          <h2 id="samples-title" className="font-semibold" style={{ fontSize: 13 }}>
            Sample pages for dynamic routes
          </h2>
          <p style={{ color: 'var(--fc-muted)' }}>No link to these routes was found. Enter one real path each to add them, or skip.</p>
        </div>
        <div className="flex max-h-[50vh] flex-col gap-2 overflow-auto">
          {patterns.map((p, i) => (
            <div key={p} className="flex flex-col gap-1">
              <label htmlFor={`sample-${i}`} className="mono" style={{ fontSize: 11 }}>
                {p}
              </label>
              <input
                id={`sample-${i}`}
                className="fc-input mono"
                placeholder={p.replace(/:(\w+)\??/g, '…').replace(/\*/g, '…')}
                value={values[p] ?? ''}
                aria-invalid={tried && bad(p)}
                aria-describedby={tried && bad(p) ? `sample-${i}-err` : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
              />
              {tried && bad(p) && (
                <span id={`sample-${i}-err`} style={{ color: 'var(--fc-red)', fontSize: 10 }}>
                  Must match {p}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="fc-btn" onClick={() => done(null)}>
            Skip
          </button>
          <button type="submit" className="fc-btn primary">
            Add screens
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Small summary after a run: counts per source, routes needing samples, skipped clicks, login note. */
function DiscoveryReportCard() {
  const d = useUi((s) => s.discovery);
  const [hidden, setHidden] = useState<DiscoveryReport | null>(null);
  const [hold, setHold] = useState(false);
  const r = d?.report;
  const authWall = !!r?.authWall;
  // Out of the way and self-dismissing: it must never sit on the canvas the user
  // is working on. Stays while hovered/focused, and always for the login warning.
  useEffect(() => {
    if (!r || d?.running || authWall || hold) return;
    const t = setTimeout(() => setHidden(r), 10_000);
    return () => clearTimeout(t);
  }, [r, d?.running, authWall, hold]);
  if (!r || d?.running || hidden === r) return null;
  const again = () => useUi.getState().set({ discoverRun: useUi.getState().discoverRun + 1 });
  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-3">
      <span style={{ color: 'var(--fc-muted)' }}>{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
  const inferred = r.samples.filter((s) => s.from === 'inferred');
  return (
    <section
      aria-labelledby="discovery-report-title"
      className="fixed z-30 w-[300px] rounded-lg border border-[#e6e6e6] bg-white p-3"
      style={{ insetInlineStart: 64, insetBlockEnd: 56, boxShadow: 'var(--fc-shadow)', fontSize: 11 }}
      data-testid="discovery-report"
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 id="discovery-report-title" className="font-semibold" style={{ fontSize: 12 }}>
          Discovery report
        </h2>
        <button type="button" className="fc-btn" aria-label="Close discovery report" onClick={() => setHidden(r)}>
          ×
        </button>
      </div>
      {r.authWall && (
        <div role="alert" className="mb-2 rounded-md p-2" style={{ background: '#fef3c7', color: '#78350f' }}>
          <strong className="block">Login first</strong>
          Most pages redirect to <span className="mono">{r.authWall}</span>. Log in to the app in a normal tab, then Discover again.
          <div className="mt-1">
            <button type="button" className="fc-btn primary" onClick={again}>
              Discover again
            </button>
          </div>
        </div>
      )}
      <div className="fc-label mb-1" style={{ color: 'var(--fc-muted)' }}>
        Screens added
      </div>
      {row('From the SDK', `${r.added.sdk} of ${r.found.sdk}`)}
      {row(`From the router${r.framework ? ` (${r.framework})` : ''}`, `${r.added.router} of ${r.found.router}`)}
      {row('From crawling', `${r.added.crawl} · ${r.pages} pages, ${r.clicks} clicks`)}
      {r.existing > 0 && row('Already on the canvas', r.existing)}
      {r.needsSample.length > 0 && (
        <details className="mt-2">
          <summary>Routes needing a sample ({r.needsSample.length})</summary>
          <ul className="mono ps-3">
            {r.needsSample.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
      {inferred.length > 0 && (
        <details className="mt-2">
          <summary>Samples inferred ({inferred.length})</summary>
          <ul className="mono ps-3">
            {inferred.map((s) => (
              <li key={s.route}>{s.path}</li>
            ))}
          </ul>
        </details>
      )}
      {r.authRoutes.length > 0 && (
        <details className="mt-2">
          <summary>Guarded routes ({r.authRoutes.length})</summary>
          <ul className="mono ps-3">
            {r.authRoutes.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
      {r.skippedClicks.length > 0 && (
        <details className="mt-2">
          <summary>Not clicked, unsafe ({r.skippedClicks.length})</summary>
          <ul className="ps-3">
            {r.skippedClicks.slice(0, 30).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
