import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts', 'link-protocol': 'src/link-protocol.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Inline the workspace packages' types too (they are not published).
  dts: { entry: { index: 'src/index.ts', 'link-protocol': 'src/link-protocol.ts' }, resolve: [/^@flowcanvas\//] },
  clean: true,
  sourcemap: true,
  // Workspace packages are TS source: bundle them. Everything else stays a dependency.
  noExternal: [/^@flowcanvas\//],
});
