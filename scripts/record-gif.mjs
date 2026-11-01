#!/usr/bin/env node
/**
 * Record docs/media/flow-canvas.gif: the Player stepping through Onboarding on
 * the demo app, then Canvas mode with an edge selected.
 *
 *   pnpm --filter @flowcanvas/extension build
 *   node scripts/record-gif.mjs            # starts the demo on :5173 if it is not running
 *
 * Needs ffmpeg. Uses Playwright from the e2e package (no browser download).
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(root, 'e2e/package.json'))('@playwright/test');
const ext = path.join(root, 'apps/extension/.output/chrome-mv3');
const origin = 'http://localhost:5173';
const work = path.join(root, 'e2e/test-results/gif');
const out = path.join(root, 'docs/media/flow-canvas.gif');
const W = 1280;
const H = 760;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(path.join(ext, 'manifest.json'))) throw new Error('build the extension first');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(path.dirname(out), { recursive: true });

let demo = null;
const up = async () => fetch(origin).then((r) => r.ok, () => false);
if (!(await up())) {
  demo = spawn('pnpm', ['--filter', '@flowcanvas/demo', 'exec', 'vite', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  for (let i = 0; i < 100 && !(await up()); i++) await sleep(200);
}

const config = JSON.parse(readFileSync(path.join(root, 'apps/demo/flowcanvas.config.json'), 'utf8'));
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: W, height: H },
  recordVideo: { dir: work, size: { width: W, height: H } },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  // Close the blank start page so the only video is the canvas.
  for (const p of context.pages()) await p.close();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/canvas.html?origin=${encodeURIComponent(origin)}`);
  const fc = (src) => page.evaluate(`(() => { const fc = window.__fc; ${src} })()`);
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => !!window.__fc && !window.__fc.ui.getState().discovery?.running)) break;
    await sleep(200);
  }
  await fc(`fc.project.getState().load(${JSON.stringify(config)}); fc.project.getState().markSaved();`);
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => window.__fc.ui.getState().status['catalog:default'] === 'ready')) break;
    await sleep(200);
  }
  const t0 = Date.now();
  await sleep(2200);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ArrowRight');
    await sleep(2200);
  }
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas', exact: true }).click();
  await sleep(600);
  await fc(`fc.rf.setCenter(1000, 620, { zoom: 0.55, duration: 800 });`);
  await sleep(4500);
  await fc(`fc.ui.getState().set({ selectedEdge: fc.project.getState().config.edges[0].id });`);
  await sleep(3200);
  console.log('recorded', ((Date.now() - t0) / 1000).toFixed(1), 's of interaction');
} finally {
  await context.close();
  if (demo) process.kill(-demo.pid);
}

const video = readdirSync(work).filter((f) => f.endsWith('.webm')).map((f) => path.join(work, f)).sort((a, b) => statSync(b).size - statSync(a).size)[0];
const palette = path.join(work, 'palette.png');
// Skip the first second (canvas boot), 7 fps, 860 px wide, 96-colour palette tuned for this clip.
const filters = 'fps=7,scale=860:-1:flags=lanczos';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.2', '-i', video, '-vf', `${filters},palettegen=max_colors=96:stats_mode=diff`, palette]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.2', '-i', video, '-i', palette, '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`, out]);
console.log(`${path.relative(root, out)}: ${(statSync(out).size / 1024 / 1024).toFixed(2)} MB`);
