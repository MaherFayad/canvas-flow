import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const LOCALHOST = ['http://localhost/*', 'http://127.0.0.1/*', 'http://*.localhost/*'];

// See docs/BUILD_PLAN.md "Manifest". Content scripts declare their own
// matches / run_at / all_frames / world in entrypoints/*.content.ts.
export default defineConfig({
  // @vitejs/plugin-react directly (module-react pulls plugin-react 6, which needs vite 8).
  vite: () => ({
    plugins: [react(), tailwindcss()],
    // Workspace TS source of the MCP link protocol (zod schemas only, no Node server code).
    resolve: { alias: { '@flowcanvas/mcp/link-protocol': fileURLToPath(new URL('../../packages/mcp/src/link-protocol.ts', import.meta.url)) } },
  }),
  manifest: {
    name: 'Flow Canvas',
    description: 'A live map of the screens, states and flows of any localhost app.',
    permissions: ['storage', 'unlimitedStorage', 'declarativeNetRequest', 'scripting', 'tabs'],
    host_permissions: LOCALHOST,
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    declarative_net_request: {
      rule_resources: [{ id: 'unframe', enabled: true, path: 'rules.json' }],
    },
    // No default_popup: one click opens the canvas (feature 1). Recent
    // projects live in the canvas origin field instead of a popup.
    action: { default_title: 'Open Flow Canvas for this tab' },
  },
});
