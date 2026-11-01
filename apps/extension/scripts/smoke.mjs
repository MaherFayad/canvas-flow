#!/usr/bin/env node
/**
 * Smoke test: load the built extension (.output/chrome-mv3) in Chromium via
 * Playwright, serve a small demo-like localhost app that sends
 * X-Frame-Options: DENY and CSP frame-ancestors 'none', open the canvas and
 * check: discovery crawl, config import, frames render, hello→welcome→ready,
 * mocked fetch, tokens, Player stepping, Canvas record mode, undo, persistence.
 * Also measures frame times during a Player step animation and a Canvas pan.
 *
 *   pnpm --filter ./apps/extension build && pnpm --filter ./apps/extension smoke
 *
 * Uses the globally installed `playwright` (no browser download). HEADED=1 to watch.
 * Screenshots go to scripts/out/ (gitignored).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(here, '../.output/chrome-mv3');
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
  console.error('Build first: pnpm --filter ./apps/extension build');
  process.exit(2);
}

/* ---------------- demo-like app ---------------- */
const PAGES = {
  '/': { title: 'Stoneware for slow mornings and long dinners.', kicker: 'Helka ceramics · Berlin', cta: ['Get started', 'get-started', '/interests'], alt: ['Skip', 'skip', '/catalog'], hero: true, links: ['/interests', '/catalog', '/logout'] },
  '/interests': { title: 'What brings you here?', chips: ['Cups & mugs', 'Bowls', 'Plates', 'Egg cups', 'Candleholders', 'Serving trays', 'Pottery classes', 'Gift cards'], cta: ['Continue · 2', 'continue', '/catalog'], links: ['/catalog'] },
  '/catalog': { title: 'Current collection', kicker: 'Helka ceramics', grid: true, links: ['/product', '/wishlist', '/bag'] },
  '/product': { title: 'Tall mug — periwinkle', kicker: '€45.00', cta: ['Add to bag', 'add', '/bag'], links: ['/bag'] },
  '/wishlist': { title: 'Wishlist', grid: true, links: [] },
  '/bag': { title: 'Bag', cta: ['Checkout', 'checkout', '/checkout'], links: ['/checkout'] },
  '/checkout': { title: 'Checkout', cta: ['Pay €138.00', 'pay', '/order'], links: [] },
  '/order': { title: 'Order placed', kicker: 'Thank you', links: [] },
};
const css = `:root{--color-surface:#F7F4EE;--color-ink:#1D1A16;--color-accent:#1D1A16;--color-danger:#B4412C;
--font-display:"Iowan Old Style", Georgia, serif;--font-sans:Inter, system-ui, sans-serif;
--size-display:32px;--size-title:22px;--size-body:15px;--space-gutter:20px;--radius-card:14px;--radius-control:999px}
*{box-sizing:border-box}body{margin:0;background:var(--color-surface);color:var(--color-ink);font:var(--size-body)/1.45 var(--font-sans);padding:var(--space-gutter)}
h1{font:400 var(--size-display)/1.15 var(--font-display);margin:12px 0}.k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.6}
.hero{height:340px;border-radius:var(--radius-card);background:linear-gradient(135deg,#c9b8a3,#8a6f55 60%,#3b2f25);margin:-4px -4px 16px}
.btn{display:block;width:100%;padding:14px;border:0;border-radius:var(--radius-control);background:var(--color-accent);color:#fff;font:600 14px var(--font-sans);margin-top:16px}
.ghost{background:none;color:var(--color-ink);font-weight:400}.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{padding:8px 12px;border-radius:999px;border:1px solid #d8d2c8;font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{border-radius:var(--radius-card);background:#fff;padding:8px}.ph{height:120px;border-radius:10px;background:linear-gradient(160deg,#dfe3ee,#9aa6c4)}
code{font-size:12px;opacity:.7}nav a{margin-right:8px;font-size:12px;color:inherit}`;
const render = (p) => {
  const d = PAGES[p] ?? { title: p, links: [] };
  const items = (j) => j.items.map((t) => `<div class="card"><div class="ph"></div><div>${t}</div></div>`).join('') || '<p>No results</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${d.title}</title><style>${css}</style></head><body>
${d.hero ? '<div class="hero"></div>' : ''}${d.kicker ? `<div class="k">${d.kicker}</div>` : ''}<h1>${d.title}</h1>
<p id="vw" class="k"></p>
${d.chips ? `<div class="chips">${d.chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>` : ''}
<p>Products: <code id="out">loading…</code></p>${d.grid ? '<div id="grid" class="grid"></div>' : ''}
${d.cta ? `<button class="btn" data-fc="${d.cta[1]}" data-go="${d.cta[2]}">${d.cta[0]}</button>` : ''}
${d.alt ? `<button class="btn ghost" data-fc="${d.alt[1]}" data-go="${d.alt[2]}">${d.alt[0]}</button>` : ''}
<nav>${d.links.map((l) => `<a href="${l}">${l}</a>`).join('')}</nav>
<script>
document.getElementById('vw').textContent = 'viewport ' + innerWidth + 'px';
fetch('/api/products').then(r => r.json()).then(j => {
  document.getElementById('out').textContent = JSON.stringify(j);
  const g = document.getElementById('grid'); if (g) g.innerHTML = (${items.toString()})(j);
});
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
  history.pushState({}, '', b.dataset.go);
  document.body.innerHTML = '<h1>' + b.dataset.go + '</h1>';
}));
</script></body></html>`;
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/products') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ items: ['Tall mug', 'Cappuccino cup', 'Big bowl', 'Side plate'] }));
  }
  if (url.pathname === '/logout') {
    res.writeHead(500);
    return res.end('crawl must skip me');
  }
  res.writeHead(200, { 'content-type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });
  res.end(render(url.pathname));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const origin = `http://localhost:${port}`;
console.log('app server:', origin);

const config = {
  version: 1,
  project: { name: 'Helka ceramics', origin },
  sections: [
    { id: 'onboarding', title: 'Onboarding', order: 0 },
    { id: 'browse', title: 'Browse & save', order: 1 },
    { id: 'checkout', title: 'Checkout', order: 2 },
  ],
  screens: [
    { id: 'welcome', title: 'Welcome', section: 'onboarding', path: '/' },
    { id: 'pick-interests', title: 'Pick interests', section: 'onboarding', path: '/interests', states: ['default', 'missing'] },
    { id: 'catalog', title: 'Catalog', section: 'onboarding', path: '/catalog', states: ['default', 'loading', 'empty'] },
    { id: 'product', title: 'Product detail', section: 'browse', path: '/product' },
    { id: 'wishlist', title: 'Wishlist', section: 'browse', path: '/wishlist' },
    { id: 'bag', title: 'Bag', section: 'checkout', path: '/bag' },
    { id: 'checkout', title: 'Checkout', section: 'checkout', path: '/checkout', states: ['default', 'loading'] },
    { id: 'order', title: 'Order confirmed', section: 'checkout', path: '/order', states: ['success'] },
  ],
  edges: [
    { id: 'start', from: { screen: 'welcome' }, to: { screen: 'pick-interests' }, trigger: { label: 'Get started', target: '[data-fc="get-started"]' } },
    { id: 'e2', from: { screen: 'pick-interests' }, to: { screen: 'catalog' }, trigger: { label: 'Continue', gesture: 'submit' }, transition: { type: 'fade', duration: 250 } },
    { id: 'e3', from: { screen: 'product' }, to: { screen: 'wishlist' }, trigger: { label: 'Save to wishlist' }, transition: { type: 'sheet-up' } },
    { id: 'e4', from: { screen: 'bag' }, to: { screen: 'checkout' }, trigger: { label: 'Checkout' } },
    { id: 'e5', from: { screen: 'checkout' }, to: { screen: 'order', state: 'success' }, trigger: { label: 'Payment accepted', gesture: 'auto-after-ms' }, transition: { type: 'fade' } },
    { id: 'e6', from: { screen: 'checkout', state: 'loading' }, to: { screen: 'bag' }, trigger: { label: 'Card declined' }, kind: 'error', transition: { type: 'pop' } },
  ],
  mocks: {
    'catalog:empty': [{ match: { method: 'GET', url: '/api/products*' }, status: 200, body: { items: [], mocked: true } }],
    'catalog:loading': [{ match: { method: 'GET', url: '/api/products*' }, delay: 'forever' }],
    'checkout:loading': [{ match: { method: 'GET', url: '/api/products*' }, delay: 'forever' }],
  },
};

/* ---------------- browser ---------------- */
// channel 'chromium' = full Chromium in new headless mode (headless-shell cannot load extensions).
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1600, height: 900 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 200) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* retry */
    }
    if (Date.now() > end) return null;
    await sleep(step);
  }
};
/** rAF frame-time stats while `action` runs in the page. */
const measure = (page, action, ms = 700) =>
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
      const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
      return { frames: ft.length, avgMs: +avg.toFixed(2), p95Ms: +ft[Math.floor(ft.length * 0.95)].toFixed(2), maxMs: +ft[ft.length - 1].toFixed(2), fps: +(1000 / avg).toFixed(1) };
    },
    [action, ms],
  );

let perf = {};
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extId = new URL(sw.url()).host;
  console.log('extension id:', extId);

  const appTab = await context.newPage();
  const resp = await appTab.goto(origin + '/');
  check('top-level page keeps X-Frame-Options', resp.headers()['x-frame-options'] === 'DENY');
  check('top-level page is not mocked', (await until(() => appTab.textContent('#out').then((t) => t.includes('Tall mug') && t))) !== null);
  await appTab.close();

  const canvas = await context.newPage();
  canvas.on('console', (m) => m.type() === 'error' && console.log('  [canvas console]', m.text()));
  canvas.on('pageerror', (e) => console.log('  [canvas pageerror]', e.message));
  await canvas.goto(`chrome-extension://${extId}/canvas.html?origin=${encodeURIComponent(origin)}`);

  // 1. Discovery crawl on an empty project.
  const disc = await until(
    () => canvas.evaluate(() => {
      const d = window.__fc.ui.getState().discovery;
      return d && !d.running ? { note: d.note, paths: window.__fc.project.getState().config.screens.map((s) => s.path) } : null;
    }),
    60000,
  );
  check('discovery crawl: 2 levels deep, skips /logout', !!disc && disc.paths.includes('/interests') && disc.paths.includes('/bag') && !disc.paths.includes('/checkout') && !disc.paths.includes('/logout'), JSON.stringify(disc));
  await sleep(1500);
  await canvas.screenshot({ path: path.join(outDir, '1-discovered-player.png') });

  // 2. Import the demo-like config through the UI (project menu → Import config…).
  await canvas.locator('header').getByRole('button', { name: /localhost/ }).click();
  await canvas.getByRole('menuitem', { name: 'Import config…' }).click();
  await canvas.getByLabel('Config JSON').fill(JSON.stringify(config));
  await canvas.locator('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await sleep(300);

  // 3. Player mode (default): active step + neighbours are live.
  const live = await until(() => canvas.evaluate(() => {
    const l = window.__fc.ui.getState().live;
    return l.has('welcome:default') && l.has('pick-interests:default') ? [...l] : null;
  }), 8000);
  check('Player: active step and neighbour are live', !!live, JSON.stringify(live));
  const frameFor = (key) => canvas.frames().find((f) => f.url().startsWith(origin) && f.url().includes(`fc-frame=${key.replace(':', '%7E')}%7E`));
  const welcome = await until(() => frameFor('welcome:default'));
  const h1 = welcome && (await until(() => welcome.textContent('h1')));
  check('iframe renders despite X-Frame-Options: DENY', !!h1 && h1.startsWith('Stoneware'), `h1=${h1}`);
  const vw = welcome && (await welcome.textContent('#vw'));
  check('iframe viewport = device CSS width', vw === 'viewport 440px', vw);
  const ready = await until(() => canvas.evaluate(() => window.__fc.ui.getState().status['welcome:default'] === 'ready'), 10000);
  check('hello → welcome → ready handshake', !!ready);
  await sleep(2500);
  await canvas.screenshot({ path: path.join(outDir, '2-player.png') });

  // Step → → (animated pan). Measure frame times during the step animation.
  const board = '[aria-label="Flow board"]';
  const scroll0 = await canvas.evaluate((b) => document.querySelector(b).scrollLeft, board);
  perf.playerStep = await measure(canvas, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));`, 700);
  await canvas.keyboard.press('ArrowRight');
  await sleep(700);
  const step = await canvas.evaluate((b) => ({ step: window.__fc.ui.getState().step, x: document.querySelector(b).scrollLeft }), board);
  check('Player: ←/→ steps through the row', step.step?.key === 'catalog:default', JSON.stringify({ ...step, scroll0 }));
  // Next row: click Bag in the sidebar → the board pans down to Checkout (animated).
  const y0 = await canvas.evaluate((b) => document.querySelector(b).scrollTop, board);
  perf.playerJump = await measure(canvas, `document.querySelector('nav[aria-label="Flows"] [data-fc-screen-row="bag"] button').click();`, 700);
  const y1 = await canvas.evaluate((b) => document.querySelector(b).scrollTop, board);
  check('Player: sidebar jump pans the board to the section', y1 > y0 + 200, `scrollTop ${y0} → ${y1}`);
  await sleep(2500);
  await canvas.screenshot({ path: path.join(outDir, '3b-player-checkout.png') });
  await canvas.locator('nav[aria-label="Flows"] [data-fc-screen-row="catalog"] button').first().click();
  await sleep(600);
  const catReady = await until(() => canvas.evaluate(() => window.__fc.ui.getState().status['catalog:default'] === 'ready'), 8000);
  const catalog = frameFor('catalog:default');
  check('Player: stepped-to frame goes live and ready', !!catalog && !!catReady);
  await sleep(2500);
  await canvas.screenshot({ path: path.join(outDir, '3-player-step3.png') });

  // 4. Tokens panel: read :root, edit, value streams live into frames.
  await canvas.getByRole('button', { name: /^Tokens/ }).click();
  const tokens = await until(() => canvas.evaluate(() => window.__fc.ui.getState().baseTokens?.length ? window.__fc.ui.getState().baseTokens : null), 6000);
  check('tokens-read returns :root custom properties', !!tokens && tokens.some((t) => t.name === '--color-surface' && t.type === 'color'), `${tokens?.length} tokens`);
  await canvas.getByLabel('--size-display slider').fill('44');
  const applied = await until(() => catalog.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--size-display').trim() === '44px'), 3000);
  check('token slider streams live to frames', !!applied);
  await sleep(300);
  await canvas.screenshot({ path: path.join(outDir, '4-tokens.png') });
  await canvas.getByRole('button', { name: 'Discard all' }).click();
  const reverted = await until(() => catalog.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--size-display').trim() === '32px'), 3000);
  check('Discard all reverts frames to the app value', !!reverted);
  await canvas.getByRole('button', { name: 'Close tokens' }).click();

  // 5. Canvas mode.
  await canvas.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click();
  await sleep(800);
  await canvas.evaluate(() => window.__fc.rf.setCenter(1500, 1900, { zoom: 0.5 }));
  await sleep(1200);
  const mocked = await until(async () => {
    const f = frameFor('catalog:empty');
    const t = f && (await f.textContent('#out'));
    return t && t.includes('mocked') ? t : null;
  }, 10000);
  check('mocked fetch returns the mock body (catalog:empty)', !!mocked, mocked ?? '');
  const loadingF = frameFor('catalog:loading');
  const stillLoading = loadingF && (await loadingF.textContent('#out'));
  check("delay: 'forever' never settles (catalog:loading)", stillLoading === 'loading…', stillLoading);
  const real = await frameFor('catalog:default')?.textContent('#out');
  check('unmatched state passes through (catalog:default)', !!real && real.includes('Tall mug'), real);
  const placeholder = await canvas.getByRole('button', { name: /No missing state for Pick interests/ }).count();
  check('missing state renders as dashed placeholder', placeholder === 1);

  // Select the "start" edge → inspector.
  await canvas.evaluate(() => window.__fc.rf.setCenter(700, 600, { zoom: 0.6 }));
  await sleep(1500);
  await canvas.locator('.fc-pill', { hasText: 'Get started' }).click();
  const found = await until(() => canvas.getByText('Found in the app on this state').isVisible(), 6000);
  check('edge inspector: selector check finds target', !!found);
  await canvas.getByRole('group', { name: 'Transition type' }).getByRole('button', { name: 'fade' }).click();
  await canvas.getByRole('button', { name: 'Overshoot' }).click();
  const edited = await canvas.evaluate(() => window.__fc.project.getState().config.edges.find((e) => e.id === 'start').transition);
  check('inspector edits transition + easing', edited.type === 'fade' && edited.easing.includes('1.56'), JSON.stringify(edited));
  const unsavedText = await canvas.locator('header [role="status"]').textContent();
  check('top bar shows unsaved edge count', /1 unsaved edge/.test(unsavedText ?? ''), unsavedText ?? '');
  await sleep(600);
  await canvas.screenshot({ path: path.join(outDir, '5-canvas-inspector.png') });
  await canvas.getByRole('button', { name: 'Close edge inspector' }).click();

  // Pan perf (programmatic, animated 450 ms).
  perf.canvasPan = await measure(canvas, `const v = window.__fc.rf.getViewport(); window.__fc.rf.setViewport({ x: v.x - 900, y: v.y, zoom: v.zoom }, { duration: 450 });`, 700);

  // 6. Record mode in Canvas: click "Skip" on welcome:default → pushState /catalog → new edge welcome → catalog.
  await canvas.evaluate(() => window.__fc.rf.setCenter(250, 600, { zoom: 0.65 }));
  await sleep(1500);
  await canvas.keyboard.press('r');
  await sleep(300);
  const recFrame = await until(() => frameFor('welcome:default'));
  await until(() => canvas.evaluate(() => window.__fc.ui.getState().status['welcome:default'] === 'ready'), 8000);
  const ifr = await canvas.evaluate(() => {
    const f = [...document.querySelectorAll('iframe')].find((x) => x.src.includes('fc-frame=welcome'));
    const r = f.getBoundingClientRect();
    return { x: r.x, y: r.y, scale: r.width / f.offsetWidth };
  });
  const btn = await recFrame.evaluate(() => {
    const el = document.querySelector('[data-fc="skip"]');
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await canvas.mouse.click(ifr.x + btn.x * ifr.scale, ifr.y + btn.y * ifr.scale);
  const edge = await until(() => canvas.evaluate(() => window.__fc.project.getState().config.edges.find((e) => e.trigger.label === 'Skip') ?? null), 5000);
  check(
    'record mode creates an edge from click + nav',
    !!edge && edge.from.screen === 'welcome' && edge.to.screen === 'catalog' && edge.trigger.target === '[data-fc="skip"]',
    JSON.stringify(edge && { from: edge.from, to: edge.to, trigger: edge.trigger }),
  );
  await canvas.keyboard.press('r');
  const n = await canvas.evaluate(() => window.__fc.project.getState().config.edges.length);
  await canvas.evaluate(() => window.__fc.project.temporal.getState().undo());
  const afterUndo = await canvas.evaluate(() => window.__fc.project.getState().config.edges.length);
  await canvas.evaluate(() => window.__fc.project.temporal.getState().redo());
  const afterRedo = await canvas.evaluate(() => window.__fc.project.getState().config.edges.length);
  check('undo/redo of a recorded edge is one step', afterUndo === n - 1 && afterRedo === n, `n=${n} undo→${afterUndo} redo→${afterRedo}`);
  await canvas.evaluate(() => window.__fc.rf.fitView({ padding: 0.06 }));
  await sleep(1500);
  await canvas.screenshot({ path: path.join(outDir, '6-canvas-overview.png') });

  // 7. Persistence.
  await sleep(500);
  await canvas.reload();
  const restored = await until(() => canvas.evaluate(() => {
    const c = window.__fc?.project.getState().config;
    return c && c.project.name === 'Helka ceramics' ? { screens: c.screens.length, edges: c.edges.length } : null;
  }), 8000);
  check('working copy restored after reload', !!restored && restored.edges === n, JSON.stringify(restored));
} catch (e) {
  check('smoke run', false, String(e?.stack ?? e));
} finally {
  await context.close();
  server.close();
}

console.log('\nframe times:', JSON.stringify(perf));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed. Screenshots: ${outDir}`);
process.exit(failed.length ? 1 : 0);
