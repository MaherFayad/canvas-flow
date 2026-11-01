// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build, type ConfigEnv, type Plugin, type UserConfig } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { flowCanvas, rewriteFcTarget } from './vite';

const rw = (code: string, file = 'a.tsx') => rewriteFcTarget(ts, code, file);

describe('rewriteFcTarget', () => {
  it('turns fcTarget props into data-fc, keeping every column', () => {
    const src = `export const A = () => <button fcTarget="get-started" className="x">Go</button>;`;
    const out = rw(src)!;
    expect(out).toBe(`export const A = () => <button data-fc ="get-started" className="x">Go</button>;`);
    expect(out.length).toBe(src.length);
  });

  it('handles expressions, self-closing tags, components, nesting and many props', () => {
    const src = [
      'const A = ({ id }: { id: string }) => (',
      '  <div fcTarget={`row-${id}`}>',
      '    <Link to="/x" fcTarget="link" />',
      '    <input fcTarget={id} />',
      '    {list.map((i) => <li key={i} fcTarget={"item-" + i} />)}',
      '  </div>',
      ');',
    ].join('\n');
    const out = rw(src)!;
    expect(out.match(/data-fc /g)).toHaveLength(4);
    expect(out).not.toContain('fcTarget');
  });

  it('leaves strings, comments, template text, variables and object keys alone', () => {
    const src = [
      'const fcTarget = "fcTarget=\\"x\\"";',
      '// <a fcTarget="no">',
      '/* fcTarget="no" */',
      'const t = `<b fcTarget="no">`;',
      'const o = { fcTarget: 1 };',
      'function f<T>(fcTarget: T) { return fcTarget; }',
      'const el = <p title="fcTarget=x">fcTarget="text"</p>;',
    ].join('\n');
    expect(rw(src)).toBeNull();
  });

  it('works on .jsx files and on TSX generics', () => {
    expect(rw('const A = () => <a fcTarget="x" href="/" />;', 'a.jsx')).toContain('data-fc ="x"');
    expect(rw('const f = <T,>(x: T) => x;\nconst A = () => <a fcTarget="y" />;')).toContain('data-fc ="y"');
  });

  it('returns null when there is no prop to rewrite', () => {
    expect(rw('const A = () => <a href="/" />;')).toBeNull();
  });
});

describe('flowCanvas() plugin', () => {
  type Hooks = {
    enforce?: Plugin['enforce'];
    config: (c: UserConfig, e: ConfigEnv) => UserConfig | undefined;
    transform: (code: string, id: string) => Promise<{ code: string; map: null } | null>;
  };
  const p = flowCanvas() as unknown as Hooks;

  it('aliases the SDK to the no-op build only for production builds', () => {
    const prod = p.config({}, { command: 'build', mode: 'production' });
    expect(prod?.resolve?.alias).toEqual([{ find: /^@flowcanvas\/sdk$/, replacement: '@flowcanvas/sdk/prod' }]);
    expect(p.config({}, { command: 'serve', mode: 'development' })).toBeUndefined();
    expect(p.config({}, { command: 'build', mode: 'development' })).toBeUndefined();
    const never = flowCanvas({ strip: false }) as unknown as Hooks;
    expect(never.config({}, { command: 'build', mode: 'production' })).toBeUndefined();
    const always = flowCanvas({ strip: true }) as unknown as Hooks;
    expect(always.config({}, { command: 'serve', mode: 'development' })).toBeTruthy();
  });

  it('runs before JSX is compiled and only on .jsx / .tsx outside node_modules', async () => {
    expect(p.enforce).toBe('pre');
    const code = 'const A = () => <a fcTarget="x" />;';
    expect((await p.transform(code, '/app/src/A.tsx?v=1'))?.code).toContain('data-fc ="x"');
    expect(await p.transform(code, '/app/src/A.ts')).toBeNull();
    expect(await p.transform(code, '/app/node_modules/lib/A.tsx')).toBeNull();
    expect((await p.transform(code, '/app/src/A.tsx'))?.map).toBeNull();
  });
});

describe('vite build with the plugin', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = mkdtempSync(path.join(here, '..', '.vite-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('ships data-fc attributes and the no-op SDK in a production build', async () => {
    writeFileSync(
      path.join(dir, 'main.tsx'),
      [
        "import { fc } from '@flowcanvas/sdk';",
        "fc.init({ screens: [{ id: 'home', path: '/' }] });",
        'export const App = () => <button fcTarget="get-started">{fc.state()}</button>;',
      ].join('\n'),
    );
    const res = await build({
      configFile: false,
      root: dir,
      logLevel: 'silent',
      mode: 'production',
      plugins: [flowCanvas()],
      esbuild: { jsx: 'automatic' },
      build: {
        write: false,
        minify: false,
        lib: { entry: path.join(dir, 'main.tsx'), formats: ['es'], fileName: 'out' },
        rollupOptions: { external: [/^react/] },
      },
    });
    const out = (Array.isArray(res) ? res[0]! : (res as { output: { code?: string }[] })).output.map((o) => (o as { code?: string }).code ?? '').join('\n');
    expect(out).toContain('"data-fc": "get-started"');
    expect(out).not.toContain('fcTarget');
    // The real SDK talks to the bridge over this event; the no-op build never does.
    expect(out).not.toContain('flowcanvas:sdk');
  });
});
