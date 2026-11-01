/**
 * Code-defined routes, read with the TypeScript compiler API (parse only, no
 * type checking):
 *  - React Router: createBrowserRouter / createHashRouter / createMemoryRouter /
 *    useRoutes arrays, <Route path> JSX trees (nesting, index routes, layout
 *    routes, descendant <Routes> mounted under "path/*"), v7 `app/routes.ts`
 *    (route / index / layout / prefix).
 *  - Vue Router: createRouter({ routes }) and RouteRecordRaw arrays (children,
 *    redirects, :param(regex), beforeEnter / meta guards), also in .vue files.
 *  - TanStack Router: createRoute({ getParentRoute, path }) graphs.
 *  - Any other array of route objects ({ path, element | component | children … }).
 */
import path from 'node:path';
import type * as TS from 'typescript';
import { readText, type WalkedFile } from './files.js';
import { joinRoute, normalizeRoute } from './pattern.js';
import type { Framework, RawRoute, RouteKind, SkippedRoute } from './types.js';
import { authMarkerIn } from './conventions.js';

let tsPromise: Promise<typeof TS> | null = null;
/** typescript is loaded lazily so the server starts fast. */
export function loadTs(): Promise<typeof TS> {
  tsPromise ??= import('typescript').then((m) => ((m as unknown as { default?: typeof TS }).default ?? (m as unknown as typeof TS)));
  return tsPromise;
}

const MARKER =
  /createBrowserRouter|createHashRouter|createMemoryRouter|createStaticRouter|createRoutesFromElements|createRoutesFromChildren|<Route[\s>/]|useRoutes|createRouter|createRoute\s*\(|createRootRoute|RouteObject|RouteRecordRaw|RouteConfig|\broutes\s*[:=]|\bpath\s*:\s*['"`]/;
const CODE_EXT = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts|vue)$/;
const ROUTER_CALLS = new Set(['createBrowserRouter', 'createHashRouter', 'createMemoryRouter', 'createStaticRouter', 'createStaticHandler', 'useRoutes', 'createRouter']);
const ROUTE_KEYS = new Set(['element', 'component', 'Component', 'components', 'lazy', 'loader', 'children', 'redirect', 'beforeEnter', 'meta', 'errorElement', 'ErrorBoundary', 'loadComponent', 'loadChildren', 'handle', 'action']);
const UI_KEYS = ['element', 'Component', 'component', 'components', 'lazy', 'render', 'loadComponent', 'loadChildren'];
const GUARD_TAG = /^(Require\w*|Protected\w*|Private\w*|Auth(?:Guard|Required|enticated|Gate|Wall)?\w*|\w+Guard|SignedIn|WithAuth\w*|RedirectToSignIn|Authorized\w*)$/;
const AUTHY = /auth|login|signed|session|protect|private|guard|permission|role/i;

interface ParsedFile {
  rel: string;
  sf: TS.SourceFile;
  framework: Framework;
  /** local name → { module, imported } */
  imports: Map<string, { from: string; name: string }>;
  arrays: Map<string, TS.ArrayLiteralExpression>;
  objects: Map<string, TS.ObjectLiteralExpression>;
  strings: Map<string, string>;
  defaultArray?: TS.ArrayLiteralExpression;
}

export interface CodeRouteResult {
  routes: RawRoute[];
  skipped: SkippedRoute[];
  /** app/routes.ts calls flatRoutes(): the caller scans app/routes with flat-route conventions. */
  usesFlatRoutes: boolean;
}

/** Vue SFC: keep only <script> content, other lines blanked so line numbers still match. */
function vueScript(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const start = m.index! + m[0].indexOf('>') + 1;
    out += text.slice(last, start).replace(/[^\n]/g, ' ');
    out += m[1];
    last = start + m[1]!.length;
  }
  out += text.slice(last).replace(/[^\n]/g, ' ');
  return out;
}

export async function scanCodeRoutes(files: WalkedFile[], projectFrameworks: Set<string>): Promise<CodeRouteResult> {
  const ts = await loadTs();
  const parsed: ParsedFile[] = [];
  for (const f of files) {
    if (f.test || !CODE_EXT.test(f.rel) || f.size > 512 * 1024 || /\.d\.[cm]?ts$/.test(f.rel)) continue;
    let text = await readText(f.abs);
    if (!text || !MARKER.test(text)) continue;
    if (f.rel.endsWith('.vue')) text = vueScript(text);
    const kind = /\.(tsx|jsx|vue)$/.test(f.rel) || /\.(js|mjs|cjs)$/.test(f.rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(f.rel, text, ts.ScriptTarget.Latest, true, kind);
    parsed.push(indexFile(ts, f.rel, sf, projectFrameworks));
  }
  return new Collector(ts, parsed).run();
}

function frameworkOf(rel: string, imports: Map<string, { from: string }>, fw: Set<string>): Framework {
  const mods = [...imports.values()].map((i) => i.from);
  if (mods.some((m) => /^vue-router/.test(m)) || rel.endsWith('.vue')) return 'vue-router';
  if (mods.some((m) => /^@tanstack\/.*router/.test(m))) return 'tanstack-router';
  if (mods.some((m) => /react-router|@remix-run/.test(m))) return 'react-router';
  if (fw.has('vue-router') && !fw.has('react-router')) return 'vue-router';
  if (fw.has('tanstack-router') && !fw.has('react-router')) return 'tanstack-router';
  return 'react-router';
}

function unwrap(ts: typeof TS, e: TS.Expression | undefined): TS.Expression | undefined {
  let x = e;
  while (x && (ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isParenthesizedExpression(x) || ts.isTypeAssertionExpression(x) || ts.isNonNullExpression(x) || ts.isAwaitExpression(x))) {
    x = x.expression;
  }
  return x;
}

function indexFile(ts: typeof TS, rel: string, sf: TS.SourceFile, fw: Set<string>): ParsedFile {
  const imports = new Map<string, { from: string; name: string }>();
  const arrays = new Map<string, TS.ArrayLiteralExpression>();
  const objects = new Map<string, TS.ObjectLiteralExpression>();
  const strings = new Map<string, string>();
  let defaultArray: TS.ArrayLiteralExpression | undefined;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const from = st.moduleSpecifier.text;
      const cl = st.importClause;
      if (cl?.name) imports.set(cl.name.text, { from, name: 'default' });
      if (cl?.namedBindings && ts.isNamedImports(cl.namedBindings)) {
        for (const el of cl.namedBindings.elements) imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
      }
    }
    if (ts.isExportAssignment(st)) {
      const e = unwrap(ts, st.expression);
      if (e && ts.isArrayLiteralExpression(e)) defaultArray = e;
    }
  }
  const visit = (n: TS.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const init = unwrap(ts, n.initializer);
      if (init && ts.isArrayLiteralExpression(init)) arrays.set(n.name.text, init);
      else if (init && ts.isObjectLiteralExpression(init)) objects.set(n.name.text, init);
      else if (init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) strings.set(n.name.text, init.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { rel, sf, framework: frameworkOf(rel, imports, fw), imports, arrays, objects, strings, defaultArray };
}

class Collector {
  readonly routes: RawRoute[] = [];
  readonly skipped: SkippedRoute[] = [];
  usesFlatRoutes = false;
  private readonly visited = new Set<TS.Node>();
  /** Element tag of a "path/*" route → its base, for descendant <Routes>. */
  private readonly mounts = new Map<string, string>();
  private readonly byRel = new Map<string, ParsedFile>();

  constructor(
    private readonly ts: typeof TS,
    private readonly files: ParsedFile[],
  ) {
    for (const f of files) this.byRel.set(f.rel, f);
  }

  run(): CodeRouteResult {
    const ts = this.ts;
    const mountTags = this.collectMountTags();
    // 1. React Router v7 app/routes.ts
    for (const pf of this.files) {
      if (/^(.*\/)?app\/routes\.(ts|js|mts|mjs)$/.test(pf.rel) && pf.defaultArray) {
        const appDir = path.posix.dirname(pf.rel);
        this.rr7Array(pf, pf.defaultArray, '/', appDir);
      }
    }
    // 2. Router calls with route arrays.
    for (const pf of this.files) {
      const visit = (n: TS.Node) => {
        if (ts.isCallExpression(n)) {
          const callee = calleeName(ts, n.expression);
          if (callee && ROUTER_CALLS.has(callee) && n.arguments.length) {
            const arg = unwrap(ts, n.arguments[0]);
            let arr: { pf: ParsedFile; node: TS.ArrayLiteralExpression } | null = null;
            if (arg && ts.isObjectLiteralExpression(arg)) {
              const routes = prop(ts, arg, 'routes');
              if (routes) arr = this.resolveArray(pf, routes);
            } else if (arg) arr = this.resolveArray(pf, arg);
            if (arr && !this.visited.has(arr.node)) this.routeArray(arr.pf, arr.node, '/', []);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(pf.sf);
    }
    // 3. TanStack createRoute graphs.
    for (const pf of this.files) this.tanstack(pf);
    // 4. Object route arrays that nothing references as children.
    const consumed = this.consumedNames();
    for (const pf of this.files) {
      const visit = (n: TS.Node) => {
        if (ts.isArrayLiteralExpression(n) && !this.visited.has(n) && this.isRouteArray(n)) {
          const decl = n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) ? n.parent.name.text : null;
          const nested = isChildrenValue(ts, n);
          if (!nested && !(decl && consumed.has(decl))) this.routeArray(pf, n, '/', []);
        }
        ts.forEachChild(n, visit);
      };
      visit(pf.sf);
    }
    // 5. <Route> JSX trees; trees inside a component mounted under "path/*" get that base.
    const trees: Array<{ pf: ParsedFile; el: TS.JsxElement | TS.JsxSelfClosingElement; owner: string | null }> = [];
    for (const pf of this.files) {
      const visit = (n: TS.Node) => {
        if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && isRouteTag(ts, n) && !hasRouteAncestor(ts, n)) {
          trees.push({ pf, el: n, owner: ownerName(ts, n) });
        }
        ts.forEachChild(n, visit);
      };
      visit(pf.sf);
    }
    let pending = trees;
    for (let round = 0; round < 6 && pending.length; round++) {
      const next: typeof trees = [];
      for (const t of pending) {
        const deferred = t.owner && mountTags.has(t.owner) && !this.mounts.has(t.owner);
        if (deferred && round < 5) {
          next.push(t);
          continue;
        }
        const base = (t.owner && this.mounts.get(t.owner)) ?? '/';
        this.jsxRoute(t.pf, t.el, base, []);
      }
      if (next.length === pending.length) {
        for (const t of next) this.jsxRoute(t.pf, t.el, '/', []);
        break;
      }
      pending = next;
    }
    return { routes: this.routes, skipped: this.skipped, usesFlatRoutes: this.usesFlatRoutes };
  }

  /* ------------------------------ helpers ------------------------------ */

  private line(pf: ParsedFile, n: TS.Node): number {
    return pf.sf.getLineAndCharacterOfPosition(n.getStart(pf.sf)).line + 1;
  }

  private emit(pf: ParsedFile, n: TS.Node, route: string, kind: RouteKind, name: string | undefined, guards: string[], framework?: Framework, file?: string): void {
    this.routes.push({ route: normalizeRoute(route), file: file ?? pf.rel, line: file ? undefined : this.line(pf, n), framework: framework ?? pf.framework, kind, ...(name ? { name } : {}), guards: [...new Set(guards)] });
  }

  private resolveImport(pf: ParsedFile, name: string): { pf: ParsedFile; name: string } | null {
    const imp = pf.imports.get(name);
    if (!imp || !imp.from.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(pf.rel), imp.from));
    const tries = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue'].map((e) => base.replace(/\.(js|jsx|mjs)$/, '') + e), ...['ts', 'tsx', 'js', 'jsx'].map((e) => `${base}/index.${e}`)];
    for (const t of tries) {
      const f = this.byRel.get(t);
      if (f) return { pf: f, name: imp.name };
    }
    return null;
  }

  private resolveArray(pf: ParsedFile, e: TS.Expression): { pf: ParsedFile; node: TS.ArrayLiteralExpression } | null {
    const ts = this.ts;
    const x = unwrap(ts, e);
    if (!x) return null;
    if (ts.isArrayLiteralExpression(x)) return { pf, node: x };
    if (ts.isIdentifier(x)) {
      const local = pf.arrays.get(x.text);
      if (local) return { pf, node: local };
      const imp = this.resolveImport(pf, x.text);
      if (imp) {
        const node = imp.name === 'default' ? imp.pf.defaultArray : imp.pf.arrays.get(imp.name);
        if (node) return { pf: imp.pf, node };
      }
      const hits = this.files.filter((f) => f.arrays.has(x.text));
      if (hits.length === 1) return { pf: hits[0]!, node: hits[0]!.arrays.get(x.text)! };
    }
    return null;
  }

  private resolveObject(pf: ParsedFile, e: TS.Expression): { pf: ParsedFile; node: TS.ObjectLiteralExpression } | null {
    const ts = this.ts;
    const x = unwrap(ts, e);
    if (!x) return null;
    if (ts.isObjectLiteralExpression(x)) return { pf, node: x };
    if (ts.isIdentifier(x)) {
      const local = pf.objects.get(x.text);
      if (local) return { pf, node: local };
      const imp = this.resolveImport(pf, x.text);
      const node = imp && imp.pf.objects.get(imp.name);
      if (imp && node) return { pf: imp.pf, node };
    }
    return null;
  }

  private str(pf: ParsedFile, e: TS.Expression | undefined): string | undefined {
    const ts = this.ts;
    const x = unwrap(ts, e);
    if (!x) return undefined;
    if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return x.text;
    if (ts.isIdentifier(x)) return pf.strings.get(x.text);
    if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression)) {
      const o = this.resolveObject(pf, x.expression);
      const v = o && prop(ts, o.node, x.name.text);
      return v ? this.str(o!.pf, v) : undefined;
    }
    return undefined;
  }

  private isRouteObject(o: TS.ObjectLiteralExpression): boolean {
    const ts = this.ts;
    const p = prop(ts, o, 'path');
    const idx = prop(ts, o, 'index');
    return (!!p && (ts.isStringLiteral(p) || ts.isNoSubstitutionTemplateLiteral(p) || ts.isIdentifier(p) || ts.isPropertyAccessExpression(p))) || (!!idx && idx.kind === ts.SyntaxKind.TrueKeyword);
  }

  private isRouteArray(a: TS.ArrayLiteralExpression): boolean {
    const ts = this.ts;
    const objs = a.elements.map((e) => unwrap(ts, e)).filter((e): e is TS.ObjectLiteralExpression => !!e && ts.isObjectLiteralExpression(e));
    if (!objs.some((o) => this.isRouteObject(o))) return false;
    return objs.some((o) => o.properties.some((p) => p.name && ts.isIdentifier(p.name) && ROUTE_KEYS.has(p.name.text)));
  }

  /** Names used as `children: X`, `routes: X` or `...X` inside route arrays. */
  private consumedNames(): Set<string> {
    const ts = this.ts;
    const out = new Set<string>();
    for (const pf of this.files) {
      const visit = (n: TS.Node) => {
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && (n.name.text === 'children' || n.name.text === 'routes')) {
          const v = unwrap(ts, n.initializer);
          if (v && ts.isIdentifier(v)) out.add(v.text);
        }
        if (ts.isShorthandPropertyAssignment(n) && (n.name.text === 'children' || n.name.text === 'routes')) out.add(n.name.text);
        if (ts.isSpreadElement(n) && ts.isArrayLiteralExpression(n.parent)) {
          const v = unwrap(ts, n.expression);
          if (v && ts.isIdentifier(v)) out.add(v.text);
        }
        if (ts.isCallExpression(n)) {
          const c = calleeName(ts, n.expression);
          const a = n.arguments[0] && unwrap(ts, n.arguments[0]);
          if (c && ROUTER_CALLS.has(c) && a && ts.isIdentifier(a)) out.add(a.text);
        }
        ts.forEachChild(n, visit);
      };
      visit(pf.sf);
    }
    return out;
  }

  /** Element tags of routes whose path ends in "/*" (they render descendant <Routes>). */
  private collectMountTags(): Set<string> {
    const ts = this.ts;
    const tags = new Set<string>();
    for (const pf of this.files) {
      const visit = (n: TS.Node) => {
        if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && isRouteTag(ts, n)) {
          const a = jsxAttrs(ts, n);
          const p = a.get('path');
          const pv = p && this.jsxStr(pf, p);
          const el = a.get('element');
          if (pv && /\/\*$/.test(pv) && el) for (const t of jsxTags(ts, el)) tags.add(t);
        }
        ts.forEachChild(n, visit);
      };
      visit(pf.sf);
    }
    return tags;
  }

  /* -------------------------- object route arrays -------------------------- */

  private routeArray(pf: ParsedFile, arr: TS.ArrayLiteralExpression, base: string, guards: string[]): void {
    const ts = this.ts;
    if (this.visited.has(arr)) return;
    this.visited.add(arr);
    for (const raw of arr.elements) {
      if (ts.isSpreadElement(raw)) {
        const inner = this.resolveArray(pf, raw.expression);
        if (inner) this.routeArray(inner.pf, inner.node, base, guards);
        continue;
      }
      const el = unwrap(ts, raw);
      if (!el) continue;
      const obj = this.resolveObject(pf, el);
      if (obj) this.routeObject(obj.pf, obj.node, base, guards);
    }
  }

  private routeObject(pf: ParsedFile, o: TS.ObjectLiteralExpression, base: string, inherited: string[]): void {
    const ts = this.ts;
    const pathExpr = prop(ts, o, 'path');
    const rawPath = pathExpr ? this.str(pf, pathExpr) : undefined;
    const idx = prop(ts, o, 'index');
    const index = !!idx && idx.kind === ts.SyntaxKind.TrueKeyword;
    const children = prop(ts, o, 'children');
    const redirect = prop(ts, o, 'redirect');
    const guards = [...inherited, ...this.objectGuards(pf, o)];
    const name = this.objectName(pf, o);
    const hasUi = UI_KEYS.some((k) => !!prop(ts, o, k));
    const el = prop(ts, o, 'element');
    const isRedirectEl = !!el && jsxTags(ts, el).some((t) => t === 'Navigate' || t === 'Redirect');

    if (pathExpr && rawPath === undefined) {
      this.skipped.push({ file: pf.rel, line: this.line(pf, o), reason: 'route path is computed at runtime; read the code to find it' });
      return;
    }
    const conv = rawPath === undefined ? undefined : convertPath(rawPath, pf.framework);
    const full = conv === undefined ? base : joinRoute(base, conv.replace(/\/\*$/, ''));
    if (redirect || isRedirectEl) {
      this.skipped.push({ file: pf.rel, line: this.line(pf, o), route: full, reason: 'redirect' });
      return;
    }
    if (conv !== undefined && isNotFound(conv)) {
      this.skipped.push({ file: pf.rel, line: this.line(pf, o), route: joinRoute(base, conv), reason: 'catch-all (not-found page)' });
      return;
    }
    if (conv !== undefined && /\/\*$/.test(conv)) {
      if (el) for (const t of jsxTags(ts, el)) this.mounts.set(t, full);
    } else if (index) this.emit(pf, o, full, 'index', name, guards);
    else if (conv !== undefined && (hasUi || !children)) this.emit(pf, o, full, children ? 'layout' : kindFor(full), name, guards);
    if (children) {
      const arr = this.resolveArray(pf, children);
      if (arr) this.routeArray(arr.pf, arr.node, full, guards);
    }
  }

  private objectName(pf: ParsedFile, o: TS.ObjectLiteralExpression): string | undefined {
    const ts = this.ts;
    const n = prop(ts, o, 'name');
    const nv = n && this.str(pf, n);
    if (nv) return nv;
    for (const k of UI_KEYS) {
      const v = prop(ts, o, k);
      if (!v) continue;
      const tags = jsxTags(ts, v).filter((t) => !GUARD_TAG.test(t));
      if (tags.length) return tags.at(-1);
      const x = unwrap(ts, v);
      if (x && ts.isIdentifier(x)) return x.text;
      const imp = dynamicImport(ts, v);
      if (imp) return path.posix.basename(imp).replace(/\.\w+$/, '');
    }
    return undefined;
  }

  private objectGuards(pf: ParsedFile, o: TS.ObjectLiteralExpression): string[] {
    const ts = this.ts;
    const out: string[] = [];
    const at = `${pf.rel}:${this.line(pf, o)}`;
    for (const k of ['element', 'Component', 'component']) {
      const v = prop(ts, o, k);
      if (v) for (const t of jsxTags(ts, v)) if (GUARD_TAG.test(t)) out.push(`<${t}> at ${at}`);
    }
    if (prop(ts, o, 'beforeEnter')) out.push(`beforeEnter at ${at}`);
    if (prop(ts, o, 'beforeLoad')) out.push(`beforeLoad at ${at}`);
    for (const k of ['loader', 'canActivate', 'canMatch']) {
      const v = prop(ts, o, k);
      if (v && AUTHY.test(v.getText(pf.sf).slice(0, 200))) out.push(`${k} at ${at}`);
    }
    const meta = prop(ts, o, 'meta');
    const mo = meta && unwrap(ts, meta);
    if (mo && ts.isObjectLiteralExpression(mo)) {
      for (const p of mo.properties) {
        if (p.name && ts.isIdentifier(p.name) && AUTHY.test(p.name.text) && ts.isPropertyAssignment(p) && p.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
          out.push(`meta.${p.name.text} at ${at}`);
        }
      }
    }
    return out;
  }

  /* ------------------------------ JSX routes ------------------------------ */

  private jsxStr(pf: ParsedFile, a: TS.JsxAttribute): string | undefined {
    const ts = this.ts;
    const init = a.initializer;
    if (!init) return undefined;
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression) return this.str(pf, init.expression);
    return undefined;
  }

  private jsxRoute(pf: ParsedFile, n: TS.JsxElement | TS.JsxSelfClosingElement, base: string, inherited: string[]): void {
    const ts = this.ts;
    if (this.visited.has(n)) return;
    this.visited.add(n);
    const a = jsxAttrs(ts, n);
    const pAttr = a.get('path');
    const at = `${pf.rel}:${this.line(pf, n)}`;
    let paths: Array<string | undefined> = [undefined];
    if (pAttr) {
      const init = pAttr.initializer;
      const arr = init && ts.isJsxExpression(init) && init.expression && unwrap(ts, init.expression);
      if (arr && ts.isArrayLiteralExpression(arr)) paths = arr.elements.map((e) => this.str(pf, e));
      else paths = [this.jsxStr(pf, pAttr)];
      if (paths.every((p) => p === undefined)) {
        this.skipped.push({ file: pf.rel, line: this.line(pf, n), reason: 'route path is computed at runtime; read the code to find it' });
        return;
      }
    }
    const indexAttr = a.get('index');
    const index = !!indexAttr && (!indexAttr.initializer || (ts.isJsxExpression(indexAttr.initializer) && indexAttr.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword));
    const el = a.get('element') ?? a.get('Component') ?? a.get('component') ?? a.get('render');
    const tags = el ? jsxTags(ts, el) : [];
    const guards = [...inherited, ...tags.filter((t) => GUARD_TAG.test(t)).map((t) => `<${t}> at ${at}`)];
    const loader = a.get('loader');
    if (loader && AUTHY.test(loader.getText(pf.sf).slice(0, 200))) guards.push(`loader at ${at}`);
    const name = tags.filter((t) => !GUARD_TAG.test(t)).at(-1) ?? (el ? exprName(ts, el) : undefined);
    const kids = ts.isJsxElement(n) ? routeChildren(ts, n) : [];
    const redirect = tags.some((t) => t === 'Navigate' || t === 'Redirect');
    for (const p of paths) {
      const conv = p === undefined ? undefined : convertPath(p, pf.framework);
      const full = conv === undefined ? base : joinRoute(base, conv.replace(/\/\*$/, ''));
      if (redirect) {
        this.skipped.push({ file: pf.rel, line: this.line(pf, n), route: full, reason: 'redirect' });
        continue;
      }
      if (conv !== undefined && isNotFound(conv)) {
        this.skipped.push({ file: pf.rel, line: this.line(pf, n), route: joinRoute(base, conv), reason: 'catch-all (not-found page)' });
        continue;
      }
      if (conv !== undefined && /\/\*$/.test(conv)) {
        for (const t of tags) this.mounts.set(t, full);
      } else if (index) this.emit(pf, n, full, 'index', name, guards);
      else if (conv !== undefined && (el || !kids.length)) this.emit(pf, n, full, kids.length ? 'layout' : kindFor(full), name, guards);
      for (const k of kids) {
        this.visited.delete(k);
        this.jsxRoute(pf, k, full, guards);
      }
    }
  }

  /* ---------------------------- TanStack Router ---------------------------- */

  private tanstack(pf: ParsedFile): void {
    const ts = this.ts;
    interface TR {
      node: TS.Node;
      parent?: string;
      path?: string;
      root: boolean;
      name?: string;
      guards: string[];
    }
    const defs = new Map<string, TR>();
    const visit = (n: TS.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        // createRoute({...}), createRootRoute(), createRootRouteWithContext<Ctx>()({...})
        const call = unwrap(ts, n.initializer);
        if (call && ts.isCallExpression(call)) {
          const callee = calleeName(ts, ts.isCallExpression(call.expression) ? call.expression.expression : call.expression);
          if (callee === 'createRootRoute' || callee === 'createRootRouteWithContext') defs.set(n.name.text, { node: n, root: true, guards: [] });
          else if (callee === 'createRoute') {
            const o = call.arguments[0] && unwrap(ts, call.arguments[0]);
            if (o && ts.isObjectLiteralExpression(o)) {
              const gp = prop(ts, o, 'getParentRoute');
              let parent: string | undefined;
              const gpx = gp && unwrap(ts, gp);
              if (gpx && ts.isArrowFunction(gpx)) {
                const body = unwrap(ts, gpx.body as TS.Expression);
                if (body && ts.isIdentifier(body)) parent = body.text;
              }
              const p = prop(ts, o, 'path');
              const comp = prop(ts, o, 'component');
              const cx = comp && unwrap(ts, comp);
              const guards: string[] = [];
              if (prop(ts, o, 'beforeLoad')) guards.push(`beforeLoad at ${pf.rel}:${this.line(pf, o)}`);
              defs.set(n.name.text, { node: o, parent, path: p ? this.str(pf, p) : undefined, root: false, name: cx && ts.isIdentifier(cx) ? cx.text : undefined, guards });
              this.visited.add(o);
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(pf.sf);
    const full = (id: string, depth = 0): { route: string; guards: string[] } | null => {
      const d = defs.get(id);
      if (!d || depth > 20) return null;
      if (d.root) return { route: '/', guards: [] };
      const parent = d.parent ? full(d.parent, depth + 1) : { route: '/', guards: [] };
      if (!parent) return null;
      const seg = d.path === undefined ? '' : convertPath(d.path.replace(/^\//, ''), 'tanstack-router');
      return { route: joinRoute(parent.route, seg), guards: [...parent.guards, ...d.guards] };
    };
    for (const [id, d] of defs) {
      if (d.root || d.path === undefined) continue;
      const r = full(id);
      if (!r) continue;
      if (isNotFound(convertPath(d.path, 'tanstack-router'))) {
        this.skipped.push({ file: pf.rel, line: this.line(pf, d.node), route: r.route, reason: 'catch-all (not-found page)' });
        continue;
      }
      const index = (d.path === '/' || d.path === '') && !!d.parent && !defs.get(d.parent)?.root;
      this.emit(pf, d.node, r.route, index ? 'index' : kindFor(r.route), d.name ?? id.replace(/Route$/, ''), r.guards, 'tanstack-router');
    }
  }

  /* ------------------------- React Router v7 config ------------------------- */

  private rr7Array(pf: ParsedFile, arr: TS.ArrayLiteralExpression, base: string, appDir: string): void {
    const ts = this.ts;
    this.visited.add(arr);
    for (const raw of arr.elements) {
      let e: TS.Expression | undefined = ts.isSpreadElement(raw) ? raw.expression : raw;
      e = unwrap(ts, e);
      if (!e || !ts.isCallExpression(e)) {
        if (e && ts.isArrayLiteralExpression(e)) this.rr7Array(pf, e, base, appDir);
        continue;
      }
      const c = calleeName(ts, e.expression);
      const args = e.arguments;
      const arrArg = (i: number) => {
        const x = args[i] && unwrap(ts, args[i]);
        return x && ts.isArrayLiteralExpression(x) ? x : undefined;
      };
      const fileOf = (i: number) => {
        const s = this.str(pf, args[i]);
        return s ? path.posix.normalize(path.posix.join(appDir, s)) : undefined;
      };
      if (c === 'flatRoutes') {
        this.usesFlatRoutes = true;
      } else if (c === 'index') {
        this.emit(pf, e, base, 'index', fileOf(0) ? path.posix.basename(fileOf(0)!).replace(/\.\w+$/, '') : undefined, [], 'react-router', fileOf(0));
      } else if (c === 'route') {
        const p = this.str(pf, args[0]);
        if (p === undefined) continue;
        const conv = convertPath(p, 'react-router');
        const full = joinRoute(base, conv);
        const kids = arrArg(2) ?? arrArg(3);
        const file = fileOf(1);
        if (isNotFound(conv)) this.skipped.push({ file: file ?? pf.rel, route: full, reason: 'catch-all (not-found page)' });
        else this.emit(pf, e, full, kids ? 'layout' : kindFor(full), file ? path.posix.basename(file).replace(/\.\w+$/, '') : undefined, [], 'react-router', file);
        if (kids) this.rr7Array(pf, kids, full, appDir);
      } else if (c === 'layout') {
        const kids = arrArg(1) ?? arrArg(2);
        if (kids) this.rr7Array(pf, kids, base, appDir);
      } else if (c === 'prefix') {
        const p = this.str(pf, args[0]);
        const kids = arrArg(1);
        if (kids && p !== undefined) this.rr7Array(pf, kids, joinRoute(base, convertPath(p, 'react-router')), appDir);
      }
    }
  }
}

/* ------------------------------------------------------------------ */

/** Framework path syntax → ours: Vue ":id(\\d+)" → ":id", TanStack "$id" → ":id", "*" → ":splat*". */
export function convertPath(p: string, fw: Framework): string {
  let s = p.trim();
  s = s.replace(/(:[A-Za-z_$][\w$]*)\((?:[^()]|\([^()]*\))*\)/g, '$1'); // :id(\\d+) → :id
  if (fw === 'tanstack-router') {
    s = s
      .split('/')
      .map((seg) => (seg === '$' ? ':splat*' : /^\{-\$([\w$]+)\}$/.test(seg) ? seg.replace(/^\{-\$([\w$]+)\}$/, ':$1?') : seg.replace(/^\$([\w$]+)$/, ':$1')))
      .join('/');
  }
  s = s
    .split('/')
    .map((seg) => (seg === '*' || seg === '**' ? ':splat*' : seg))
    .join('/');
  // Keep a trailing "/*" marker distinguishable for descendant-route mounts.
  return s.replace(/\/:splat\*$/, (m) => (p.trim().endsWith('/*') ? '/*' : m));
}

/** "*", "/*", "/:pathMatch(.*)*", "**" and friends: a not-found page rather than a screen. */
function isNotFound(p: string): boolean {
  const segs = p.split('/').filter(Boolean);
  return segs.length === 1 && (/^:[\w$]+[*+]$/.test(segs[0]!) || segs[0] === '*');
}

function kindFor(route: string): RouteKind {
  return /:[\w$]+[*+]/.test(route) ? 'catch-all' : 'page';
}

function calleeName(ts: typeof TS, e: TS.Expression): string | undefined {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function prop(ts: typeof TS, o: TS.ObjectLiteralExpression, name: string): TS.Expression | undefined {
  for (const p of o.properties) {
    if (ts.isPropertyAssignment(p) && propName(ts, p.name) === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
    if ((ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p)) && propName(ts, p.name) === name) return p as unknown as TS.Expression;
  }
  return undefined;
}

function propName(ts: typeof TS, n: TS.PropertyName): string | undefined {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return undefined;
}

function isChildrenValue(ts: typeof TS, n: TS.Node): boolean {
  const p = n.parent;
  return !!p && ts.isPropertyAssignment(p) && propName(ts, p.name) === 'children';
}

function tagText(ts: typeof TS, t: TS.JsxTagNameExpression): string {
  if (ts.isIdentifier(t)) return t.text;
  if (ts.isPropertyAccessExpression(t)) return t.name.text;
  return t.getText();
}

function isRouteTag(ts: typeof TS, n: TS.JsxElement | TS.JsxSelfClosingElement): boolean {
  const t = ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName;
  return tagText(ts, t) === 'Route';
}

function hasRouteAncestor(ts: typeof TS, n: TS.Node): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && isRouteTag(ts, p)) return true;
    if (ts.isFunctionLike(p)) return false;
  }
  return false;
}

function routeChildren(ts: typeof TS, n: TS.JsxElement): Array<TS.JsxElement | TS.JsxSelfClosingElement> {
  const out: Array<TS.JsxElement | TS.JsxSelfClosingElement> = [];
  const walk = (kids: TS.NodeArray<TS.JsxChild>) => {
    for (const c of kids) {
      if ((ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) && isRouteTag(ts, c)) out.push(c);
      else if (ts.isJsxFragment(c)) walk(c.children);
      else if (ts.isJsxElement(c)) walk(c.children);
    }
  };
  walk(n.children);
  return out;
}

function jsxAttrs(ts: typeof TS, n: TS.JsxElement | TS.JsxSelfClosingElement): Map<string, TS.JsxAttribute> {
  const attrs = ts.isJsxElement(n) ? n.openingElement.attributes : n.attributes;
  const out = new Map<string, TS.JsxAttribute>();
  for (const a of attrs.properties) if (ts.isJsxAttribute(a) && ts.isIdentifier(a.name)) out.set(a.name.text, a);
  return out;
}

/** Every JSX tag name inside an attribute or expression, outermost first. */
function jsxTags(ts: typeof TS, n: TS.Node): string[] {
  const out: string[] = [];
  const visit = (x: TS.Node) => {
    if (ts.isJsxElement(x)) out.push(tagText(ts, x.openingElement.tagName));
    else if (ts.isJsxSelfClosingElement(x)) out.push(tagText(ts, x.tagName));
    ts.forEachChild(x, visit);
  };
  visit(n);
  return out.filter((t) => /^[A-Z]/.test(t));
}

function exprName(ts: typeof TS, a: TS.JsxAttribute): string | undefined {
  const init = a.initializer;
  if (init && ts.isJsxExpression(init) && init.expression && ts.isIdentifier(init.expression)) return init.expression.text;
  return undefined;
}

function dynamicImport(ts: typeof TS, n: TS.Node): string | undefined {
  let found: string | undefined;
  const visit = (x: TS.Node) => {
    if (found) return;
    if (ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.ImportKeyword && x.arguments[0] && ts.isStringLiteral(x.arguments[0])) {
      found = x.arguments[0].text;
      return;
    }
    ts.forEachChild(x, visit);
  };
  visit(n);
  return found;
}

/** Name of the component (function or const) that contains a node. */
function ownerName(ts: typeof TS, n: TS.Node): string | null {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
  }
  return null;
}

export { authMarkerIn };
