import { defineConfig } from 'tsup';

/**
 * Adapters import the core as `./index`. In the build that import is rewritten to
 * the package itself (`@flowcanvas/sdk`) and kept external, so `./react` and `.`
 * share one core instance (one handshake, one state) and the `production` export
 * condition also strips the core used by the adapters.
 */
const coreExternal = {
  name: 'core-external',
  setup(build: { onResolve: (o: { filter: RegExp }, cb: (a: { importer: string }) => unknown) => void }) {
    build.onResolve({ filter: /^\.\/index(\.ts)?$/ }, (args) =>
      /[\\/]src[\\/]index\.ts$/.test(args.importer) ? undefined : { path: '@flowcanvas/sdk', external: true },
    );
  },
};

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    prod: 'src/prod.ts',
    react: 'src/react.ts',
    next: 'src/next.ts',
    vue: 'src/vue.ts',
    msw: 'src/msw.ts',
    vite: 'src/vite.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  minify: true,
  treeshake: true,
  target: 'es2019',
  platform: 'browser',
  external: ['react', 'vue', 'msw', 'vite', 'typescript', '@flowcanvas/sdk'],
  esbuildPlugins: [coreExternal as never],
});
