import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Workspace TS source of the MCP link protocol and server (in-process link client test).
      '@flowcanvas/mcp/link-protocol': fileURLToPath(new URL('../../packages/mcp/src/link-protocol.ts', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'store/**/*.test.ts'],
    testTimeout: 20_000,
    environment: 'node',
  },
});
