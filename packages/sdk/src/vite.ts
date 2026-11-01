/**
 * @flowcanvas/sdk/vite: a Vite plugin.
 *
 * 1. Rewrites the JSX prop `fcTarget="id"` (or `fcTarget={expr}`) to
 *    `data-fc="id"` in `.jsx` / `.tsx` files, so triggers can be marked without
 *    importing the SDK: `<button fcTarget="get-started">`.
 * 2. In a production build, aliases `@flowcanvas/sdk` to its no-op build, so
 *    the SDK costs a few bytes in shipped bundles.
 *
 * The rewrite uses the TypeScript parser (a peer you almost certainly have),
 * so `fcTarget` inside strings, comments, template literals or plain
 * variables is never touched. `fcTarget` becomes `data-fc ` (with a trailing
 * space, valid JSX) so every column stays where it was and source maps need no
 * update.
 *
 *   // vite.config.ts
 *   import { flowCanvas } from '@flowcanvas/sdk/vite';
 *   export default defineConfig({ plugins: [flowCanvas(), react()] });
 */
import type { Plugin } from 'vite';

type TS = typeof import('typescript');

export interface FlowCanvasViteOptions {
  /**
   * Alias `@flowcanvas/sdk` to the no-op build. `'auto'` (default): only for
   * `vite build` in a mode other than `development`.
   */
  strip?: boolean | 'auto';
  /** Files to rewrite. Default: `.jsx` and `.tsx` outside node_modules. */
  include?: RegExp;
  /** JSX prop to rewrite. Default `fcTarget`. */
  prop?: string;
}

const ATTR = 'data-fc';

/**
 * Rewrite `<prop>=` JSX attributes to `data-fc` in `code`. Returns the new code,
 * or null when nothing changed. Same length as the input.
 */
export function rewriteFcTarget(ts: TS, code: string, fileName: string, prop = 'fcTarget'): string | null {
  if (!code.includes(prop)) return null;
  if (prop.length < ATTR.length) throw new Error(`prop must be at least ${ATTR.length} characters`);
  const kind = /\.jsx$/.test(fileName) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, kind);
  const at: number[] = [];
  const visit = (n: import('typescript').Node): void => {
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === prop) at.push(n.name.getStart(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!at.length) return null;
  const repl = ATTR + ' '.repeat(prop.length - ATTR.length);
  let out = '';
  let last = 0;
  for (const p of at.sort((a, b) => a - b)) {
    out += code.slice(last, p) + repl;
    last = p + prop.length;
  }
  return out + code.slice(last);
}

export function flowCanvas(opts: FlowCanvasViteOptions = {}): Plugin {
  const include = opts.include ?? /\.(jsx|tsx)$/;
  const prop = opts.prop ?? 'fcTarget';
  let ts: Promise<TS> | null = null;
  const loadTs = () =>
    (ts ??= import('typescript').then(
      (m) => ((m as { default?: TS }).default ?? m) as TS,
      () => {
        throw new Error('@flowcanvas/sdk/vite needs the `typescript` package to rewrite fcTarget props (npm i -D typescript).');
      },
    ));

  return {
    name: 'flowcanvas',
    enforce: 'pre',
    config(_config, env) {
      const strip = opts.strip ?? 'auto';
      const on = strip === 'auto' ? env.command === 'build' && env.mode !== 'development' : strip;
      if (!on) return;
      return { resolve: { alias: [{ find: /^@flowcanvas\/sdk$/, replacement: '@flowcanvas/sdk/prod' }] } };
    },
    async transform(code, id) {
      const file = id.split('?')[0]!;
      if (!include.test(file) || /[\\/]node_modules[\\/]/.test(file) || !code.includes(prop)) return null;
      const out = rewriteFcTarget(await loadTs(), code, file, prop);
      // Columns are unchanged, so map: null keeps the existing source map.
      return out === null ? null : { code: out, map: null };
    },
  };
}

export default flowCanvas;
