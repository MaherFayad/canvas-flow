import { defineConfig } from '@playwright/test';
import { DEMO, DEMO_NOSDK, DEMO_PORT, NOSDK_PORT, ROOT } from './fixtures/paths';

const CI = !!process.env.CI;

/**
 * E2E against apps/demo with the unpacked extension.
 *
 *   pnpm e2e                 # builds the extension, starts both demo servers, runs headless
 *   HEADED=1 pnpm e2e        # watch it
 *   E2E_SKIP_BUILD=1 pnpm e2e  # reuse apps/extension/.output (CI builds once before)
 *
 * Browsers: the Chromium that matches @playwright/test (pinned to the same
 * version as the pre-installed browsers; CI installs it with
 * `npx playwright install --with-deps chromium`).
 */
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  // One worker: every test launches its own Chromium profile, and the perf spec
  // must not share the CPU with another browser.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // Demo with the SDK.
      command: `pnpm --filter @flowcanvas/demo exec vite --port ${DEMO_PORT} --strictPort`,
      cwd: ROOT,
      url: DEMO,
      reuseExistingServer: !CI,
      timeout: 60_000,
      stdout: 'ignore',
    },
    {
      // Same demo without the SDK: the canvas falls back to its fetch mock layer.
      command: `pnpm --filter @flowcanvas/demo exec vite --port ${NOSDK_PORT} --strictPort`,
      cwd: ROOT,
      url: DEMO_NOSDK,
      env: { VITE_FC_SDK: '0' },
      reuseExistingServer: !CI,
      timeout: 60_000,
      stdout: 'ignore',
    },
  ],
});
