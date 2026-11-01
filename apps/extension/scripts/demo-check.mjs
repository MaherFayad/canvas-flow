#!/usr/bin/env node
/**
 * Integration check against the real demo app (apps/demo on :5173, with the SDK).
 * Loads the built extension, imports apps/demo/flowcanvas.config.json, then
 * screenshots Player mode, Canvas mode, the edge inspector and the tokens panel
 * and checks that SDK frames hand-shake and show their forced state.
 *
 * M4/M5 checks: sidebar grouped by screen; screenshots captured (n/N pill,
 * stills shown when zoomed out); Player stage plays Onboarding end to end
 * (push / fade, tapping the real target, Esc back) with no blank frame
 * mid-transition (stage pixels sampled); Checkout end to end (auto edge);
 * Play edge popover (+ loop); token export (W3C JSON + CSS); frame times.
 *
 *   pnpm --filter ./apps/demo dev   # in another shell (or DEMO_ORIGIN=http://localhost:5175 with vite --port 5175)
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
// DEMO_ORIGIN: run against this checkout's demo on another port (e.g. `vite --port 5175`) when 5173 is taken.
const origin = process.env.DEMO_ORIGIN ?? 'http://localhost:5173';
const config = JSON.parse(fs.readFileSync(path.resolve(here, '../../demo/flowcanvas.config.json'), 'utf8'));
config.project.origin = origin;
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

/** rAF frame-time stats (p50/p95, dropped = frames beyond one 16.7 ms vsync) while `src` runs in the page. */
const measure = (page, src, ms = 700) =>
  page.evaluate(
    async ([src, ms]) => {
      const times = [];
      let last = performance.now();
      let run = true;
      const loop = (t) => {
        times.push(t - last);
        last = t;
        if (run) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      await new Function(`return (async () => { ${src} })()`)();
      await new Promise((r) => setTimeout(r, ms));
      run = false;
      const ft = times.slice(1).sort((a, b) => a - b);
      const q = (p) => +ft[Math.min(ft.length - 1, Math.floor(ft.length * p))].toFixed(1);
      const dropped = ft.reduce((n, d) => n + Math.max(0, Math.round(d / 16.67) - 1), 0);
      return { frames: ft.length, p50: q(0.5), p95: q(0.95), max: q(1), dropped };
    },
    [src, ms],
  );

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1600, height: 900 },
  acceptDownloads: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const perf = {};
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
  const tImport = Date.now();

  const ready = await until(() => canvas.evaluate(() => window.__fc.ui.getState().status['welcome:default'] === 'ready'), 15000);
  check('demo welcome frame handshakes and is ready', !!ready);
  const sdk = await until(() => canvas.evaluate(() => {
    const s = window.__fc.ui.getState();
    return Object.values(s.sdk).filter(Boolean).length || null;
  }), 5000);
  check('SDK detected in demo frames', sdk !== null, String(sdk));

  // ---- Sidebar grouped by screen (reference frame_1) ----
  const side = await canvas.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Flows"]');
    const rows = [...nav.querySelectorAll('[data-fc-screen-row]')];
    return { rows: rows.length, names: rows.map((r) => r.querySelector('button').textContent.replace('⠿', '')) };
  });
  const screens = config.screens.length;
  check('sidebar: one row per screen (not one per state)', side.rows === screens, `${side.rows} rows for ${screens} screens, ${config.screens.reduce((n, s) => n + s.states.length, 0)} states: ${side.names.slice(0, 9).join(' | ')}`);
  await canvas.getByRole('button', { name: 'Show states of Checkout' }).click();
  const stateRows = await canvas.locator('ul[aria-label="States of Checkout"] button').count();
  check('sidebar: a screen row expands to its states', stateRows === config.screens.find((s) => s.id === 'checkout').states.length, String(stateRows));
  await canvas.locator('ul[aria-label="States of Checkout"] button', { hasText: 'loading' }).click();
  const st = await until(() => canvas.evaluate(() => {
    const s = window.__fc.ui.getState().step;
    const o = window.__fc.play?.getState().overrides ?? {};
    return s?.key === 'checkout:default' ? { step: s.key, override: o['checkout:default'] ?? null } : null;
  }), 3000);
  check('sidebar: clicking a state flies the board to that screen in that state', st?.override === 'loading', JSON.stringify(st));
  await sleep(1800);
  await canvas.screenshot({ path: path.join(outDir, '0-sidebar-grouped.png') });
  // Back to the first step.
  await canvas.locator('nav[aria-label="Flows"] [data-fc-screen-row="welcome"] button').first().click();
  await sleep(1500);

  // ---- M5 screenshots: queue (max 3), n/N pill, at least 20 stills ----
  let pillSeen = null;
  const capStart = Date.now();
  const capDone = await until(async () => {
    const p = await canvas.evaluate(() => {
      const { progress, stills } = window.__fc.capture.useStills.getState();
      const pill = document.querySelector('[data-fc-capture]')?.textContent ?? null;
      return { ...progress, stills: Object.keys(stills).length, pill };
    });
    if (p.pill && /Capturing screenshots \d+\/\d+/.test(p.pill)) pillSeen ??= p.pill;
    return !p.running && p.stills >= 20 ? p : null;
  }, 120000);
  const capMs = Date.now() - capStart;
  check('screenshots: status pill reads "Capturing screenshots n/N"', !!pillSeen, pillSeen ?? '');
  check('screenshots: at least 20 frames captured', (capDone?.stills ?? 0) >= 20, `${capDone?.stills} stills, ${capDone?.failed} failed, ${(capMs / 1000).toFixed(1)} s after the first ready (${((Date.now() - tImport) / 1000).toFixed(1)} s after import)`);
  const sample = await canvas.evaluate(() => Object.values(window.__fc.capture.useStills.getState().stills)[0]?.url.slice(0, 22));
  check('screenshots are WebP data URLs', sample === 'data:image/webp;base64', sample);
  const apiStill = await canvas.evaluate(() => window.__fc.capture.getStill('catalog', 'empty', 'iphone-16-pro-max').then((u) => (u ? u.length : 0)));
  check('getStill(screen, state, device) returns the stored still', apiStill > 1000, `${apiStill} chars`);
  // The capture library is injected on demand, never bundled in the content script.
  const bridgeSize = fs.statSync(path.join(extPath, 'content-scripts/bridge.js')).size;
  check('bridge.js does not bundle modern-screenshot', bridgeSize < 75000 && !fs.readFileSync(path.join(extPath, 'content-scripts/bridge.js'), 'utf8').includes('foreignObject'), `${bridgeSize} B`);

  await canvas.screenshot({ path: path.join(outDir, '1-player.png') });

  // HMR: touching a demo source file (mtime only, no content change) makes Vite push an update;
  // the bridge forwards `hmr`, stills go stale and re-capture.
  const demoCss = path.resolve(here, '../../demo/src/styles.css');
  const before = await canvas.evaluate(() => window.__fc.capture.useStills.getState().progress.total);
  const now = new Date();
  fs.utimesSync(demoCss, now, now);
  const hmr = await until(() => canvas.evaluate(() => {
    const { stills, progress } = window.__fc.capture.useStills.getState();
    const stale = Object.values(stills).filter((s) => !s.fresh).length;
    return stale > 0 || progress.running ? { stale, running: progress.running } : null;
  }), 8000);
  check('HMR marks stills stale and re-captures them', !!hmr, JSON.stringify(hmr) + ` (total before ${before})`);
  await until(() => canvas.evaluate(() => !window.__fc.capture.useStills.getState().progress.running), 60000);

  // Catalog states via SDK: jump to Browse & save catalog row, check forced state text.
  const frames = () => canvas.frames().filter((f) => f.url().startsWith(origin));
  const stateTexts = {};
  for (const f of frames()) {
    const u = new URL(f.url());
    const s = u.searchParams.get('fc-state');
    if (u.pathname === '/catalog') stateTexts[s] = (await f.textContent('body').catch(() => '')).slice(0, 80);
  }
  console.log('catalog frames live:', JSON.stringify(stateTexts));

  perf.playerStep = await measure(canvas, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));`, 700);
  await sleep(300);
  await canvas.keyboard.press('ArrowRight');
  await sleep(2500);
  await canvas.screenshot({ path: path.join(outDir, '2-player-step3.png') });

  // ---- M4 Player stage: Onboarding end to end ----
  await canvas.locator('nav[aria-label="Flows"] [data-fc-screen-row="welcome"] button').first().click();
  await sleep(800);
  await canvas.getByRole('button', { name: '▶ Play', exact: true }).first().click();
  const stageFrame = (screen) => canvas.frames().find((f) => f.url().includes(`fc-frame=stage%7E${screen}%7E`));
  const stageReady = await until(() => canvas.evaluate(() => {
    const h = window.__fc.host;
    return [...h.frames.values()].some((f) => f.frameId.startsWith('stage~welcome~') && f.ready);
  }), 10000);
  check('Player stage opens on the current step (Welcome) and is ready', !!stageReady);
  await sleep(500);
  await canvas.screenshot({ path: path.join(outDir, '3-stage-welcome.png') });
  const hints = await canvas.locator('[aria-label="Next screens"] .fc-hint').allTextContents();
  check('stage: hint arrow for the outgoing edge', hints.some((h) => h.includes('Tap "Get started"')), JSON.stringify(hints));

  const stageRect = await canvas.evaluate(() => {
    const el = document.querySelector('[data-fc-stage="player"] .fc-device > div:nth-child(2)');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  /** A real mouse tap on `sel` inside the stage frame on show (coordinates mapped through the stage scale). */
  const tapInStage = async (frame, sel) => {
    const ifr = await canvas.evaluate(() => {
      const f = [...document.querySelectorAll('[data-fc-stage="player"] iframe')].find((x) => x.style.zIndex === '3');
      const r = f.getBoundingClientRect();
      return { x: r.x, y: r.y, scale: r.width / f.offsetWidth };
    });
    const b = await frame.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, sel);
    await canvas.mouse.click(ifr.x + b.x * ifr.scale, ifr.y + b.y * ifr.scale);
  };
  /** Screenshot the stage screen as fast as possible while `trigger` plays a transition; returns per-sample stats. */
  // Analysed in the canvas page itself after sampling (a second tab would background the canvas and throttle it).
  const stats = (b64) =>
    canvas.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0, sum = 0, sum2 = 0, white = 0;
      for (let i = 0; i < d.length; i += 16) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++; sum += l; sum2 += l * l;
        if (d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248) white++;
      }
      const mean = sum / n;
      return { std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1), white: +(white / n).toFixed(3) };
    }, b64);
  let lastShots = [];
  const sampleTransition = async (trigger, ms) => {
    const shots = [];
    const t0 = Date.now();
    const p = trigger();
    while (Date.now() - t0 < ms) shots.push((await canvas.screenshot({ clip: stageRect })).toString('base64'));
    await p;
    const out = [];
    for (const s of shots) out.push(await stats(s));
    lastShots = shots;
    return out;
  };
  const blank = (s) => s.std < 6 || s.white > 0.9;
  const slow = (id, ms) => canvas.evaluate(([id, ms]) => window.__fc.project.getState().updateEdge(id, (e) => ({ ...e, transition: { ...e.transition, duration: ms } })), [id, ms]);

  // Real speed push (240 ms), measured for frame times with both iframes live.
  const tCount = () => canvas.evaluate(() => window.__fc.play.getState().transitions);
  let n0 = await tCount();
  perf.pushTransition = await measure(canvas, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));`, 900);
  const atPick = await until(async () => (await tCount()) > n0 && canvas.evaluate(() => window.__fc.ui.getState().step?.key === 'pick-interests:default'), 5000);
  check('stage: → plays the push to Pick interests', !!atPick);
  // Back (Esc) plays the reverse.
  n0 = await tCount();
  await canvas.keyboard.press('Escape');
  const backed = await until(async () => (await tCount()) > n0 && canvas.evaluate(() => window.__fc.ui.getState().step?.key === 'welcome:default'), 5000);
  check('stage: Esc goes back with the reverse transition', !!backed);

  // Slowed copies (1200 ms) so the sampler sees the middle of each transition; restored after.
  await slow('e-get-started', 1200);
  await slow('e-continue', 1200);
  await sleep(300);
  const pushSamples = await sampleTransition(() => canvas.keyboard.press('ArrowRight'), 1300);
  const pushShots = lastShots;
  await until(() => canvas.evaluate(() => window.__fc.ui.getState().step?.key === 'pick-interests:default'), 5000);
  await until(() => canvas.evaluate(() => [...window.__fc.host.frames.values()].some((f) => f.frameId.startsWith('stage~pick-interests~') && f.ready)), 8000);
  await sleep(600);
  // Tap the real "Continue" target inside the frame (submit · fade).
  const pf = await until(() => stageFrame('pick-interests'));
  await canvas.evaluate(() => {
    window.__navs = [];
    window.__fc.host.subscribe((f, m) => m.fc === 'nav' && f.frameId.startsWith('stage~') && window.__navs.push(`${f.frameId} ${m.from} → ${m.to}`));
  });
  const fadeSamples = await sampleTransition(() => tapInStage(pf, '[data-fc="interests-continue"]'), 1300);
  const atCatalog = await until(() => canvas.evaluate(() => window.__fc.ui.getState().step?.key === 'catalog:default'), 5000);
  check('stage: tapping the real target in the frame plays its edge (fade to Catalog)', !!atCatalog);
  const navs = await canvas.evaluate(() => window.__navs);
  check('stage: the tap did not navigate the app inside the old frame (intercepted)', navs.length === 0, JSON.stringify(navs));
  const all = [...pushSamples, ...fadeSamples];
  const blanks = all.filter(blank);
  check('stage: no blank/white frame mid-transition (pixels sampled)', all.length >= 8 && blanks.length === 0, `${all.length} samples (push ${pushSamples.length}, fade ${fadeSamples.length}); min std ${Math.min(...all.map((s) => s.std))}, max white ${Math.max(...all.map((s) => s.white))}`);
  pushShots.forEach((b64, i) => i % 2 === 0 && fs.writeFileSync(path.join(outDir, `4-stage-push-${String(i).padStart(2, '0')}.png`), Buffer.from(b64, 'base64')));
  await slow('e-get-started', 240);
  await slow('e-continue', 250);
  await canvas.screenshot({ path: path.join(outDir, '4-stage-catalog.png') });
  const endHint = await canvas.locator('[aria-label="Next screens"]').textContent();
  check('stage: Onboarding reached its last screen (Catalog)', /Product card|See the classes/.test(endHint ?? ''), endHint?.slice(0, 80));
  await canvas.getByRole('button', { name: '↺ Restart' }).click();
  const restarted = await until(() => canvas.evaluate(() => window.__fc.ui.getState().step?.key === 'welcome:default'), 5000);
  check('stage: Restart returns to the first screen', !!restarted);

  // Checkout end to end (M4 gate): Bag → Checkout (push) → Pay (none) → processing → auto → Order confirmed (fade).
  await canvas.getByRole('button', { name: 'Play Checkout' }).click().catch(async () => {
    await canvas.getByRole('button', { name: '■ Stop' }).click();
    await sleep(500);
    await canvas.getByRole('button', { name: 'Play Checkout' }).click();
  });
  await until(() => canvas.evaluate(() => [...window.__fc.host.frames.values()].some((f) => f.frameId.startsWith('stage~bag~') && f.ready)), 10000);
  await sleep(400);
  const coSamples = [];
  coSamples.push(...(await sampleTransition(() => canvas.keyboard.press('ArrowRight'), 500)));
  await until(() => canvas.evaluate(() => [...window.__fc.host.frames.values()].some((f) => f.frameId.startsWith('stage~checkout~default') && f.ready)), 8000);
  await sleep(400);
  const cf = await until(() => stageFrame('checkout'));
  await tapInStage(cf, '[data-fc="pay"]');
  const confirmed = await until(() => canvas.evaluate(() => window.__fc.ui.getState().step?.key === 'order-confirmed:success'), 12000);
  check('stage: Checkout plays end to end (push, tap Pay, auto-after-ms to Order confirmed)', !!confirmed, `blank samples: ${coSamples.filter(blank).length}/${coSamples.length}`);
  await sleep(500);
  await canvas.screenshot({ path: path.join(outDir, '5-stage-order-confirmed.png') });
  await canvas.getByRole('button', { name: '■ Stop' }).click();
  await sleep(800);

  // Tokens + export (feature 7)
  await canvas.getByRole('button', { name: /^Tokens/ }).click();
  await sleep(2500);
  await canvas.screenshot({ path: path.join(outDir, '6-tokens.png') });
  const tokenCount = await canvas.evaluate(() => (window.__fc.ui.getState().baseTokens ?? []).length).catch(() => -1);
  console.log('tokens read:', tokenCount);
  const [dl] = await Promise.all([canvas.waitForEvent('download'), canvas.getByRole('button', { name: 'JSON ↓' }).click()]);
  const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  const leaves = Object.values(json).flatMap((g) => Object.values(g));
  check('token export: W3C design tokens JSON', leaves.length === tokenCount && leaves.every((t) => '$value' in t && t.$extensions?.['dev.flowcanvas']?.cssVar?.startsWith('--')) && json.color && Object.values(json.color).every((t) => t.$type === 'color'), `${leaves.length} tokens in groups ${Object.keys(json).join(', ')}`);
  const [dl2] = await Promise.all([canvas.waitForEvent('download'), canvas.getByRole('button', { name: 'CSS ↓' }).click()]);
  const css = fs.readFileSync(await dl2.path(), 'utf8');
  check('token export: CSS :root block', /^:root \{\n(  --[\w-]+: [^;]+;\n)+\}\n$/.test(css), css.split('\n').slice(0, 3).join(' '));
  // Edit → Add to change set (one undo step) → stills re-capture after edits settle.
  const firstLen = await canvas.evaluate(() => window.__fc.ui.getState().baseTokens.find((t) => t.type === 'length')?.name);
  await canvas.getByLabel(`${firstLen} slider`).fill('40');
  await canvas.getByRole('button', { name: 'Add to change set' }).click();
  const committed = await canvas.evaluate((n) => window.__fc.project.getState().config.tokens[n], firstLen);
  const past = await canvas.evaluate(() => window.__fc.project.temporal.getState().pastStates.length);
  check('Add to change set writes config.tokens', !!committed, `${firstLen} = ${committed}`);
  const recapture = await until(() => canvas.evaluate(() => window.__fc.capture.useStills.getState().progress.running), 5000);
  check('stills re-capture ~1 s after token edits settle', !!recapture);
  await canvas.evaluate(() => window.__fc.project.temporal.getState().undo());
  const undone = await canvas.evaluate((n) => window.__fc.project.getState().config.tokens[n] ?? null, firstLen);
  check('token commit is one undo step', undone === null, `past=${past}`);
  await canvas.getByRole('button', { name: /^Tokens/ }).click();
  await sleep(500);

  // Canvas mode
  await canvas.getByRole('radio', { name: 'Canvas' }).or(canvas.getByRole('button', { name: 'Canvas', exact: true })).first().click();
  await sleep(3500);
  await canvas.screenshot({ path: path.join(outDir, '7-canvas.png') });
  const layout = await canvas.evaluate(() => {
    const ns = window.__fc.rf.getNodes().filter((n) => n.type !== 'section' && !String(n.id).startsWith('sec'));
    const xs = new Set(ns.map((n) => Math.round(n.position.x)));
    return { nodes: ns.length, distinctX: xs.size };
  });
  check('Canvas mode lays screens out in rows (not one column)', layout.distinctX >= 4, JSON.stringify(layout));

  // Zoomed out: every frame is a still image.
  await until(() => canvas.evaluate(() => !window.__fc.capture.useStills.getState().progress.running), 60000);
  await canvas.evaluate(() => window.__fc.rf.fitView({ padding: 0.04 }));
  await sleep(1500);
  const stillImgs = await canvas.evaluate(() => [...document.querySelectorAll('.react-flow__node .fc-still.img:not(.gone) img')].filter((i) => i.complete && i.naturalWidth > 0).length);
  check('zoomed out: frames show their screenshot (<img decoding=async>)', stillImgs >= 20, `${stillImgs} stills on screen`);
  await canvas.screenshot({ path: path.join(outDir, '8-canvas-zoomed-out-stills.png') });

  // Pan with inertia (mouse drag on the pane, fast release): measure frames, check it glides after release.
  await canvas.evaluate(() => window.__fc.rf.setViewport({ x: 0, y: 0, zoom: 0.35 }));
  await sleep(600);
  const pane = await canvas.evaluate(() => {
    const r = document.querySelector('.react-flow__pane').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const dragMeasure = measure(canvas, '', 1500);
  await canvas.mouse.move(pane.x, pane.y);
  await canvas.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await canvas.mouse.move(pane.x - i * 40, pane.y - i * 6);
    await sleep(12);
  }
  await canvas.mouse.up();
  const atRelease = await canvas.evaluate(() => window.__fc.rf.getViewport().x);
  const glideMeasure = measure(canvas, '', 900);
  await sleep(60);
  const gliding = await canvas.evaluate(() => window.__fc.inertia?.active());
  perf.canvasInertiaGlide = await glideMeasure;
  perf.canvasDragPlusGlide = await dragMeasure;
  const glide = await until(() => canvas.evaluate(() => window.__fc.inertia?.last()), 5000);
  const afterGlide = await canvas.evaluate(() => window.__fc.rf.getViewport().x);
  check('Canvas: drag-pan release glides on (inertia, τ 325 ms) and comes to rest', gliding === true && afterGlide < atRelease - 20 && glide?.stoppedBy === 'rest', `x at release ${atRelease.toFixed(0)} → ${afterGlide.toFixed(0)}; glide ${JSON.stringify(glide)}`);
  // A new pointer-down during a glide stops it where it is.
  await canvas.mouse.move(pane.x, pane.y);
  await canvas.mouse.down();
  for (let i = 1; i <= 6; i++) await canvas.mouse.move(pane.x - i * 50, pane.y);
  await canvas.mouse.up();
  await sleep(80);
  await canvas.mouse.down();
  const caught = await canvas.evaluate(() => !window.__fc.inertia?.active());
  await canvas.mouse.up();
  check('Canvas: a glide is interruptible (pointer-down catches it)', caught);

  // Edge inspector + Play edge popover
  await canvas.evaluate(() => {
    const e = window.__fc.project.getState().config.edges[0];
    window.__fc.ui.setState({ selectedEdge: e.id });
    window.__fc.rf.fitView({ nodes: [{ id: 'welcome:default' }, { id: 'pick-interests:default' }, { id: 'catalog:default' }], padding: 0.15 });
  });
  await sleep(2500);
  await canvas.screenshot({ path: path.join(outDir, '9-edge-inspector.png') });
  // Bezier editor: preset → curve, typed string → curve, dragging a handle (pointer capture) → overshoot.
  await canvas.getByRole('button', { name: 'Overshoot' }).click();
  const h1 = await canvas.locator('circle[data-handle="0"]').boundingBox();
  await canvas.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2);
  await canvas.mouse.down();
  await canvas.mouse.move(h1.x + 20, h1.y - 300, { steps: 8 }); // far outside the graph: capture keeps tracking
  await canvas.mouse.up();
  const dragged = await canvas.evaluate(() => window.__fc.project.getState().config.edges[0].transition.easing);
  check('bezier: handle drag (pointer capture) clamps y to 2 and commits once', /cubic-bezier\([\d.]+, 2, 0\.64, 1\)/.test(dragged), dragged);
  await canvas.getByLabel('Easing (CSS)').fill('cubic-bezier(0.2, 0.8, 0.2, 1)');
  await canvas.getByLabel('Easing (CSS)').press('Enter');
  const typed = await canvas.evaluate(() => window.__fc.project.getState().config.edges[0].transition.easing);
  const curveLabel = await canvas.locator('svg[aria-label^="Easing curve"]').getAttribute('aria-label');
  check('bezier: typing a cubic-bezier string updates the curve', typed === 'cubic-bezier(0.2, 0.8, 0.2, 1)' && curveLabel.includes('0.2, 0.8, 0.2, 1'), curveLabel);
  const dotMoves = await canvas.evaluate(async () => {
    const d = document.querySelector('[data-fc-preview-dot]');
    const a = getComputedStyle(d).transform;
    await new Promise((r) => setTimeout(r, 120));
    return d.getAnimations().length > 0 && getComputedStyle(d).transform !== a;
  });
  check('bezier: preview dot animates with the curve', dotMoves);

  let pe0 = await tCount();
  await canvas.getByRole('button', { name: '▶ Play edge' }).click();
  const popover = await until(() => canvas.locator('[data-fc-stage="edge"]').isVisible(), 3000);
  const played = await until(async () => (await tCount()) > pe0, 10000);
  check('Play edge: popover plays that one edge', !!popover && !!played);
  await canvas.screenshot({ path: path.join(outDir, '10-play-edge.png') });
  pe0 = await tCount();
  await canvas.getByRole('button', { name: '⟳ Loop' }).click();
  const looped = await until(async () => (await tCount()) >= pe0 + 2, 10000);
  check('Play edge: loops on demand', !!looped);
  // prefers-reduced-motion: the stage swaps with a 120 ms fade instead of the push.
  await canvas.getByRole('button', { name: '⟳ Loop' }).click();
  await sleep(1500);
  await canvas.emulateMedia({ reducedMotion: 'reduce' });
  await canvas.getByRole('button', { name: '▶ Replay' }).click();
  const reduced = await until(() => canvas.evaluate(() => {
    const a = [...document.querySelectorAll('[data-fc-stage="edge"] iframe')].flatMap((f) => f.getAnimations());
    if (!a.length) return null;
    const t = a[0].effect.getTiming();
    const k = a[0].effect.getKeyframes();
    return { n: a.length, duration: t.duration, props: Object.keys(k[0]).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x)) };
  }), 6000);
  check('reduced motion: Player swaps with a 120 ms fade', reduced?.duration === 120 && reduced.props.join() === 'opacity', JSON.stringify(reduced));
  await canvas.emulateMedia({ reducedMotion: null });
  await canvas.getByRole('button', { name: 'Close play edge' }).click();

  check('no page errors in canvas', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await context.close();
}
console.log('\nframe times (rAF deltas, ms):', JSON.stringify(perf));
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
