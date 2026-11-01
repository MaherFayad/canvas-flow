/**
 * scan_routes: find an app's routes statically (no running app, no canvas).
 * Detects the framework from package.json, applies its file conventions,
 * parses code-defined routers with the TypeScript compiler API, then adds
 * sample values for dynamic params from fixtures, seeds and mocks in the repo.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { clearReadCache, readText, walk, type WalkedFile } from './files.js';
import { astro, authMarker, nextApp, nextPages, nuxt, remixFlat, sveltekit, tanstackFiles, type ConventionResult } from './conventions.js';
import { scanCodeRoutes } from './code-routes.js';
import { fillRoute, isDynamic, paramsOf } from './pattern.js';
import { buildSampleIndex, hintsFor, stems } from './samples.js';
import type { Framework, RawRoute, RouteCandidate, SkippedRoute } from './types.js';

export type { RouteCandidate, SkippedRoute, SampleHint, Framework } from './types.js';

export interface ScanOptions {
  /** Include test files (default false). */
  includeTests?: boolean;
  maxFiles?: number;
}

export interface AppScan {
  /** App folder relative to the scanned folder ('.' for itself). */
  dir: string;
  name: string | null;
  /** Router frameworks found in package.json. */
  frameworks: string[];
}

export interface ScanResult {
  root: string;
  apps: AppScan[];
  routes: Array<RouteCandidate & { app: string }>;
  skipped: Array<SkippedRoute & { app: string }>;
  notes: string[];
  filesScanned: number;
}

const DEP_FRAMEWORKS: Array<[RegExp, string]> = [
  [/^next$/, 'next'],
  [/^nuxt3?$/, 'nuxt'],
  [/^@sveltejs\/kit$/, 'sveltekit'],
  [/^@remix-run\/(react|dev|node)$/, 'remix'],
  [/^@react-router\/dev$/, 'react-router-framework'],
  [/^astro$/, 'astro'],
  [/^@tanstack\/(react|solid)-router$/, 'tanstack-router'],
  [/^react-router(-dom)?$/, 'react-router'],
  [/^vue-router$/, 'vue-router'],
  [/^@angular\/router$/, 'angular-router'],
];

interface Pkg {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

async function readPkg(dir: string): Promise<Pkg | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as Pkg;
  } catch {
    return null;
  }
}

function frameworksOf(pkg: Pkg | null): string[] {
  if (!pkg) return [];
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
  const out: string[] = [];
  for (const [re, name] of DEP_FRAMEWORKS) if (deps.some((d) => re.test(d)) && !out.includes(name)) out.push(name);
  return out;
}

/** App folders to scan: the folder itself when it uses a router, else nested packages that do (monorepos). */
async function findApps(root: string, files: WalkedFile[]): Promise<Array<{ dir: string; pkg: Pkg | null; frameworks: string[] }>> {
  const rootPkg = await readPkg(root);
  const rootFw = frameworksOf(rootPkg);
  if (rootFw.length) return [{ dir: '.', pkg: rootPkg, frameworks: rootFw }];
  const nested: Array<{ dir: string; pkg: Pkg | null; frameworks: string[] }> = [];
  for (const f of files) {
    if (path.posix.basename(f.rel) !== 'package.json' || f.rel === 'package.json' || f.test) continue;
    const dir = path.posix.dirname(f.rel);
    if (dir.split('/').length > 3) continue;
    const pkg = await readPkg(path.join(root, dir));
    const fw = frameworksOf(pkg);
    if (fw.length) nested.push({ dir, pkg, frameworks: fw });
  }
  return nested.length ? nested : [{ dir: '.', pkg: rootPkg, frameworks: [] }];
}

function preferKind(a: RawRoute, b: RawRoute): RawRoute {
  const rank = { index: 0, page: 1, 'catch-all': 2, layout: 3 } as const;
  return rank[b.kind] < rank[a.kind] ? b : a;
}

export async function scanRoutes(rootDir: string, opts: ScanOptions = {}): Promise<ScanResult> {
  clearReadCache();
  const root = path.resolve(rootDir);
  const st = await fs.stat(root).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`Not a folder: ${root}`);
  const allFiles = await walk(root, { maxFiles: opts.maxFiles });
  const apps = await findApps(root, allFiles);
  const result: ScanResult = { root, apps: [], routes: [], skipped: [], notes: [], filesScanned: allFiles.length };
  if (allFiles.length >= (opts.maxFiles ?? 20_000)) result.notes.push(`Stopped after ${allFiles.length} files; pass a smaller dir to scan one app.`);

  for (const app of apps) {
    const prefix = app.dir === '.' ? '' : `${app.dir}/`;
    const appFiles = allFiles
      .filter((f) => f.rel.startsWith(prefix))
      // Nested apps are scanned on their own.
      .filter((f) => !apps.some((o) => o !== app && o.dir !== '.' && o.dir.startsWith(prefix) && o.dir !== app.dir && f.rel.startsWith(`${o.dir}/`)))
      .map((f) => ({ ...f, rel: f.rel.slice(prefix.length) }));
    const routeFiles = appFiles.filter((f) => opts.includeTests || !f.test);
    const byRel = new Map(routeFiles.map((f) => [f.rel, f]));
    const fw = new Set(app.frameworks);
    const parts: ConventionResult[] = [];
    const has = (re: RegExp) => routeFiles.some((f) => re.test(f.rel));

    if (fw.has('next')) {
      if (has(/^(src\/)?app\/(.*\/)?page\.(tsx|jsx|ts|js|mdx|md)$/)) parts.push(await nextApp(byRel));
      if (has(/^(src\/)?pages\//)) parts.push(await nextPages(byRel));
      const mw = byRel.get('middleware.ts') ?? byRel.get('middleware.js') ?? byRel.get('src/middleware.ts') ?? byRel.get('src/middleware.js');
      if (mw) {
        const g = await authMarker(mw);
        const text = (await readText(mw.abs)) ?? '';
        const matchers = [...text.matchAll(/matcher\s*:\s*(\[[^\]]*\]|['"`][^'"`]+['"`])/g)].flatMap((m) => [...m[1]!.matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]!));
        if (g || matchers.length) result.notes.push(`${prefix}${mw.rel} runs before routes${matchers.length ? ` matching ${matchers.join(', ')}` : ''}${g ? ` and checks auth (${g})` : ''}.`);
        if (g && matchers.length) {
          for (const part of parts) {
            for (const r of part.routes) {
              if (matchers.some((m) => r.route.startsWith(m.replace(/[:(].*$/, '').replace(/\/$/, '') || '/'))) r.guards.push(`middleware matcher in ${mw.rel}`);
            }
          }
        }
      }
    }
    if (fw.has('nuxt')) {
      parts.push(await nuxt(byRel));
      const globalMw = routeFiles.filter((f) => /^(app\/)?middleware\/.*\.global\.(ts|js)$/.test(f.rel));
      for (const m of globalMw) {
        const g = await authMarker(m);
        result.notes.push(`${prefix}${m.rel} is global route middleware${g ? ` (${g})` : ''}: some pages may need login.`);
      }
    }
    if (fw.has('sveltekit')) {
      parts.push(await sveltekit(byRel));
      const hooks = byRel.get('src/hooks.server.ts') ?? byRel.get('src/hooks.server.js');
      const g = hooks && (await authMarker(hooks));
      if (g) result.notes.push(`${prefix}${hooks!.rel} checks auth for requests (${g}).`);
    }
    if (fw.has('astro')) parts.push(await astro(byRel));
    // React Router v7 framework mode / Remix: app/routes.ts or flat routes in app/routes/.
    let flat = fw.has('remix');
    const code = await scanCodeRoutes(routeFiles, fw);
    if (code.usesFlatRoutes) flat = true;
    if ((fw.has('react-router-framework') || fw.has('remix')) && !byRel.has('app/routes.ts') && !byRel.has('app/routes.js')) flat = true;
    if (flat && has(/^app\/routes\//)) parts.push(await remixFlat(byRel, fw.has('remix') ? 'remix' : 'react-router'));
    if (fw.has('tanstack-router')) {
      for (const dir of ['src/routes', 'app/routes', 'routes']) {
        if (byRel.has(`${dir}/__root.tsx`) || byRel.has(`${dir}/__root.ts`) || byRel.has(`${dir}/__root.jsx`)) parts.push(await tanstackFiles(byRel, dir));
      }
    }
    // File-based frameworks define routes by files; code scanning would only find noise there.
    const fileBased = ['next', 'nuxt', 'sveltekit', 'astro'].some((x) => fw.has(x));
    if (!fileBased || fw.has('react-router') || fw.has('vue-router')) parts.push({ routes: code.routes, skipped: code.skipped });

    // De-duplicate by pattern (prefer index/page over layout).
    const merged = new Map<string, RawRoute>();
    for (const r of parts.flatMap((p) => p.routes)) {
      const prev = merged.get(r.route);
      if (!prev) merged.set(r.route, r);
      else {
        const keep = preferKind(prev, r);
        keep.guards = [...new Set([...prev.guards, ...r.guards])];
        if (!keep.staticParams) keep.staticParams = prev.staticParams ?? r.staticParams;
        merged.set(r.route, keep);
      }
    }
    const routes: RawRoute[] = [];
    const rootCatchAll: SkippedRoute[] = [];
    for (const r of merged.values()) {
      const segs = r.route.split('/').filter(Boolean);
      if (segs.length && segs.every((s) => s.startsWith(':')) && /[*+]$/.test(segs.at(-1)!)) {
        rootCatchAll.push({ file: r.file, ...(r.line ? { line: r.line } : {}), route: r.route, reason: 'catch-all at the root (a not-found page, or CMS pages: add real pages by hand)' });
      } else routes.push(r);
    }
    parts.push({ routes: [], skipped: rootCatchAll });

    // Sample values for dynamic params.
    const universe = new Set<string>();
    for (const r of routes) {
      for (const seg of r.route.split('/')) {
        const w = seg.replace(/^:/, '').replace(/[?*+]$/, '').split(/[^A-Za-z0-9]+/).filter(Boolean).at(-1);
        if (w) for (const s of stems(w.replace(/(Id|Slug)$/, ''))) universe.add(s.toLowerCase());
      }
    }
    const index = routes.some((r) => isDynamic(r.route)) ? await buildSampleIndex(appFiles, universe, routes.flatMap((r) => paramsOf(r.route).map((p) => p.name))) : { values: [], content: new Map() };

    for (const r of routes) {
      const params = paramsOf(r.route);
      const hints = params.length ? hintsFor(r.route, index, r.staticParams, r.file) : [];
      const first: Record<string, string> = {};
      for (const h of hints) first[h.param] ??= h.value;
      const sample = params.length ? fillRoute(r.route, first) : null;
      result.routes.push({
        route: r.route,
        file: prefix + r.file,
        ...(r.line ? { line: r.line } : {}),
        framework: r.framework,
        kind: r.kind,
        ...(r.name ? { name: r.name } : {}),
        dynamicParams: params.map((p) => p.name),
        sampleHints: hints.map((h) => ({ ...h, source: prefix + h.source })),
        ...(sample && params.length ? { samplePath: sample } : {}),
        ...(r.guards.length ? { guards: r.guards.map((g) => g.replace(/( in | at )(?=\S)/, `$1${prefix}`)) } : {}),
        app: app.dir,
      });
    }
    for (const s of parts.flatMap((p) => p.skipped)) result.skipped.push({ ...s, file: prefix + s.file, app: app.dir });
    result.apps.push({ dir: app.dir, name: app.pkg?.name ?? null, frameworks: app.frameworks });
    if (!routes.length) {
      result.notes.push(
        app.frameworks.length
          ? `No routes found in ${app.dir} (${app.frameworks.join(', ')}). Routes may be built at runtime; read the router setup by hand.`
          : `No router found in ${app.dir}. Pass dir to scan the app folder, or read the code by hand.`,
      );
    }
  }
  clearReadCache();
  return result;
}

export const SUPPORTED_FRAMEWORKS: Framework[] = ['next-app', 'next-pages', 'nuxt', 'sveltekit', 'remix', 'react-router', 'astro', 'vue-router', 'tanstack-router'];
