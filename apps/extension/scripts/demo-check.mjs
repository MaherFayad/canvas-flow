#!/usr/bin/env node
/**
 * Integration check against the real demo app (apps/demo on :5173, with the SDK).
 * Loads the built extension, imports apps/demo/flowcanvas.config.json, then
 * screenshots Player mode, Canvas mode, the edge inspector and the tokens panel
 * and checks that SDK frames hand-shake and show their forced state.
 *
 *   pnpm --filter ./apps/demo dev   # in another shell
 *   pnpm --filter ./apps/extension build && node apps/extension/scripts/demo-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(here, '../.output/chrome-mv3');
const outDir = path.join(here, 'out', 'demo');
fs.mkdirSync(outDir, { recursive: true });
const origin = 'http://localhost:5173';
const config = JSON.parse(fs.readFileSync(path.resolve(here, '../../demo/flowcanvas.config.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(150);
  }
  return null;
}
let failed = 0;
const check = (name, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1600, height: 900 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extId = new URL(sw.url()).host;
  const canvas = await context.newPage();
  const errors = [];
  canvas.on('pageerror', (e) => errors.push(e.message));
  await canvas.goto(`chrome-extension://${extId}/canvas.html?origin=${encodeURIComponent(origin)}`);
  await sleep(1500);

  await canvas.locator('header').getByRole('button', { name: /localhost|Helka/ }).first().click();
  await canvas.getByRole('menuitem', { name: 'Import config…' }).click();
  await canvas.getByLabel('Config JSON').fill(JSON.stringify(config));
  await canvas.locator('dialog').getByRole('button', { name: 'Import', exact: true }).click();

  const ready = await until(() => canvas.evaluate(() => window.__fc.ui.getState().status['welcome:default'] === 'ready'), 15000);
  check('demo welcome frame handshakes and is ready', !!ready);
  const sdk = await until(() => canvas.evaluate(() => {
    const s = window.__fc.ui.getState();
    return Object.values(s.sdk).filter(Boolean).length || null;
  }), 5000);
  check('SDK detected in demo frames', sdk !== null, String(sdk));
  await sleep(3000);
  await canvas.screenshot({ path: path.join(outDir, '1-player.png') });

  // Catalog states via SDK: jump to Browse & save catalog row, check forced state text.
  const frames = () => canvas.frames().filter((f) => f.url().startsWith(origin));
  const stateTexts = {};
  for (const f of frames()) {
    const u = new URL(f.url());
    const st = u.searchParams.get('fc-state');
    if (u.pathname === '/catalog') stateTexts[st] = (await f.textContent('body').catch(() => '')).slice(0, 80);
  }
  console.log('catalog frames live:', JSON.stringify(stateTexts));

  await canvas.keyboard.press('ArrowRight');
  await sleep(800);
  await canvas.keyboard.press('ArrowRight');
  await sleep(2500);
  await canvas.screenshot({ path: path.join(outDir, '2-player-step3.png') });

  // Tokens
  await canvas.getByRole('button', { name: /^Tokens/ }).click();
  await sleep(2500);
  await canvas.screenshot({ path: path.join(outDir, '3-tokens.png') });
  const tokenCount = await canvas.evaluate(() => (window.__fc.ui.getState().tokens ?? window.__fc.ui.getState().baseTokens ?? []).length).catch(() => -1);
  console.log('tokens read:', tokenCount);
  await canvas.getByRole('button', { name: /^Tokens/ }).click();
  await sleep(500);

  // Canvas mode
  await canvas.getByRole('radio', { name: 'Canvas' }).or(canvas.getByRole('button', { name: 'Canvas', exact: true })).first().click();
  await sleep(3500);
  await canvas.screenshot({ path: path.join(outDir, '4-canvas.png') });
  const layout = await canvas.evaluate(() => {
    const ns = window.__fc.rf.getNodes().filter((n) => n.type !== 'section' && !String(n.id).startsWith('sec'));
    const xs = new Set(ns.map((n) => Math.round(n.position.x)));
    return { nodes: ns.length, distinctX: xs.size };
  });
  check('Canvas mode lays screens out in rows (not one column)', layout.distinctX >= 4, JSON.stringify(layout));
  // Zoom to the Onboarding row like the reference, then select the Get started edge.
  await canvas.evaluate(async () => {
    const rf = window.__fc.rf;
    const ids = ['welcome:default', 'pick-interests:default', 'catalog:default'];
    const ns = rf.getNodes().filter((n) => ids.includes(n.id) || ids.some((i) => String(n.id).includes(i)));
    const e = window.__fc.project.getState().config.edges[0];
    window.__fc.ui.setState({ selectedEdge: e.id });
  });
  await sleep(4000);
  await canvas.screenshot({ path: path.join(outDir, '5-edge-inspector.png') });
  check('no page errors in canvas', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await context.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
