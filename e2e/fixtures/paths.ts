import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(E2E_DIR, '..');
export const EXT_DIR = path.join(ROOT, 'apps/extension/.output/chrome-mv3');
export const DEMO_CONFIG = path.join(ROOT, 'apps/demo/flowcanvas.config.json');
export const OUT_DIR = path.join(E2E_DIR, 'test-results');

/** Demo with the SDK (`pnpm --filter @flowcanvas/demo dev`). */
export const DEMO_PORT = Number(process.env.E2E_DEMO_PORT ?? 5173);
/** Same demo built with VITE_FC_SDK=0: the canvas falls back to its fetch mock layer. */
export const NOSDK_PORT = Number(process.env.E2E_NOSDK_PORT ?? 5174);
export const DEMO = `http://localhost:${DEMO_PORT}`;
export const DEMO_NOSDK = `http://localhost:${NOSDK_PORT}`;
