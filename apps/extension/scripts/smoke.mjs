#!/usr/bin/env node
/**
 * Smoke test: load the built extension (.output/chrome-mv3) in Chromium via
 * Playwright, serve a tiny localhost app that sends X-Frame-Options: DENY and
 * CSP frame-ancestors 'none', open the canvas, check discovery, import a
 * config, then check the iframe renders, the hello/welcome handshake reaches
 * `ready`, a mocked fetch returns the mock body, and record mode makes an edge.
 *
 *   pnpm --filter ./apps/extension build && pnpm --filter ./apps/extension smoke
 *
 * Uses the globally installed `playwright` (no browser download). Screenshots go
 * to scripts/out/ (gitignored).
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

/* ---------------- tiny app ---------------- */
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width">
<style>:root{--color-bg:#F4F1EA;--radius-md:12px}body{font:16px system-ui;margin:0;padding:24px;background:var(--color-bg)}
button{padding:12px 16px;border-radius:var(--radius-md)} @media (min-width:768px){body{padding:64px}}</style></head>
<body>${body}</body></html>`;
const home = page(
  'Home',
  `<h1>Helka</h1><p id="vw"></p><p>Products: <code id="out">loading…</code></p>
<p><a href="/about">About</a> · <a href="/catalog">Catalog</a> · <a href="/logout">Log out</a></p>
<button data-fc="go-about" id="go">Get started</button>
<script>
document.getElementById('vw').textContent = 'viewport ' + innerWidth + 'px';
fetch('/api/products').then(r => r.json()).then(j => { document.getElementById('out').textContent = JSON.stringify(j); });
document.getElementById('go').addEventListener('click', () => {
  history.pushState({}, '', '/about');
  document.body.innerHTML = '<h1>About (SPA)</h1>';
});
</script>`,
);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const deny = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" };
  if (url.pathname === '/api/products') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ items: ['real-vase', 'real-bowl'] }));
  }
  if (url.pathname === '/logout') {
    res.writeHead(500);
    return res.end('crawl must skip me');
  }
  res.writeHead(200, { 'content-type': 'text/html', ...deny });
  if (url.pathname === '/') return res.end(home);
  if (url.pathname === '/about') return res.end(page('About', '<h1>About</h1><a href="/">Home</a> <a href="/team">Team</a>'));
  if (url.pathname === '/catalog') return res.end(page('Catalog', '<h1>Catalog</h1><a href="/catalog/vase">Vase</a>'));
  return res.end(page(url.pathname, `<h1>${url.pathname}</h1>`));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const origin = `http://localhost:${port}`;
console.log('app server:', origin);

/* ---------------- browser ---------------- */
// channel 'chromium' = full Chromium in new headless mode (headless-shell cannot load extensions).
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
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
    await new Promise((r) => setTimeout(r, step));
  }
};

try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extId = new URL(sw.url()).host;
  console.log('extension id:', extId);

  // Sanity: the top-level app tab keeps its headers and is untouched.
  const appTab = await context.newPage();
  const resp = await appTab.goto(origin + '/');
  check('top-level page keeps X-Frame-Options', resp.headers()['x-frame-options'] === 'DENY');
  check('top-level page is not mocked', (await until(() => appTab.textContent('#out').then((t) => t.includes('real-vase') && t))) !== null);
  await appTab.close();

  const canvas = await context.newPage();
  canvas.on('console', (m) => m.type() === 'error' && console.log('  [canvas console]', m.text()));
  await canvas.goto(`chrome-extension://${extId}/canvas.html?origin=${encodeURIComponent(origin)}`);

  // 1. Discovery crawl on an empty project.
  const disc = await until(
    () => canvas.evaluate(() => {
      const d = window.__fc.ui.getState().discovery;
      return d && !d.running ? { note: d.note, paths: window.__fc.project.getState().config.screens.map((s) => s.path) } : null;
    }),
    40000,
  );
  check('discovery crawl finds linked screens, skips /logout', !!disc && disc.paths.includes('/about') && disc.paths.includes('/catalog/vase') && !disc.paths.includes('/logout'), JSON.stringify(disc));
  await canvas.screenshot({ path: path.join(outDir, '1-discovered.png') });

  // 2. Import a config through the UI.
  const config = {
    version: 1,
    project: { name: 'Smoke app', origin },
    devices: [{ id: 'iphone-16', label: 'iPhone 16', w: 393, h: 852, dpr: 3, chrome: 'ios' }],
    sections: [{ id: 'onboarding', title: 'Onboarding' }],
    screens: [
      { id: 'home', title: 'Home', section: 'onboarding', path: '/', states: ['default', 'empty', 'loading'], position: { x: 0, y: 0 } },
      { id: 'about', title: 'About', section: 'onboarding', path: '/about', states: ['default'], position: { x: 1900, y: 0 } },
    ],
    edges: [],
    mocks: {
      'home:empty': [{ match: { method: 'GET', url: '/api/products*' }, status: 200, body: { items: [], mocked: true } }],
      'home:loading': [{ match: { method: 'GET', url: '/api/products*' }, delay: 'forever' }],
    },
  };
  await canvas.getByRole('button', { name: 'Import', exact: true }).click();
  await canvas.getByLabel('Config JSON').fill(JSON.stringify(config));
  await canvas.locator('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  await canvas.evaluate(() => window.__fc.ui.getState().set({ deviceId: 'iphone-16' }));
  await canvas.getByRole('button', { name: 'Fit', exact: true }).click();
  await new Promise((r) => setTimeout(r, 400));
  await canvas.screenshot({ path: path.join(outDir, '2a-imported-fit.png') });
  // Fit is below 50% zoom, so frames are stills. Fly to Home / empty from the Flows tree (zoom ≥ 60%).
  await canvas.getByRole('navigation', { name: 'Flows' }).getByRole('button', { name: /empty/ }).click();
  await new Promise((r) => setTimeout(r, 800));

  const frameFor = (state) => canvas.frames().find((f) => f.url().includes(`fc-state=${state}`) && f.url().startsWith(origin));
  const live = await until(() => canvas.evaluate(() => [...window.__fc.ui.getState().live]), 8000);
  check('frames go live in viewport', !!live && live.length >= 3, JSON.stringify(live));

  const defaultFrame = await until(() => frameFor('default'));
  const h1 = defaultFrame && (await until(() => defaultFrame.textContent('h1')));
  check('iframe renders despite X-Frame-Options: DENY', h1 === 'Helka', `h1=${h1}`);
  const vw = defaultFrame && (await defaultFrame.textContent('#vw'));
  check('iframe viewport = device CSS width', vw === 'viewport 393px', vw);

  const ready = await until(
    () => canvas.evaluate(() => {
      const s = window.__fc.ui.getState().status;
      return s['home:default'] === 'ready' && s['home:empty'] === 'ready' ? s : null;
    }),
    10000,
  );
  check('hello → welcome → ready handshake', !!ready, JSON.stringify(ready));

  const emptyFrame = frameFor('empty');
  const mocked = emptyFrame && (await until(() => emptyFrame.textContent('#out').then((t) => (t.includes('mocked') ? t : null))));
  check('mocked fetch returns the mock body (home:empty)', !!mocked, mocked ?? '');
  const real = await defaultFrame.textContent('#out');
  check('unmatched state passes through to the real API (home:default)', real.includes('real-vase'), real);
  const loading = frameFor('loading');
  const stillLoading = loading && (await loading.textContent('#out'));
  check("delay: 'forever' never settles (home:loading)", stillLoading === 'loading…', stillLoading);

  const tokens = await until(() => canvas.evaluate(() => window.__fc.ui.getState().baseTokens?.length ? window.__fc.ui.getState().baseTokens : null), 5000);
  check('tokens-read returns :root custom properties', !!tokens && tokens.some((t) => t.name === '--color-bg' && t.type === 'color'), JSON.stringify(tokens));

  await canvas.screenshot({ path: path.join(outDir, '2-canvas.png') });

  // 3. Record mode: click "Get started" in home:default → pushState /about → edge home:default → about.
  await canvas.keyboard.press('r');
  await new Promise((r) => setTimeout(r, 300));
  const recFrame = await until(() => frameFor('default'));
  if (process.env.DEBUG) await recFrame.evaluate(() => { window.__clicks = 0; addEventListener('click', () => window.__clicks++, true); });
  // Real mouse click at page coordinates: iframe rect (scaled by the canvas zoom) + button rect inside the frame.
  const ifr = await canvas.evaluate(() => {
    const f = document.querySelector('iframe[src*="fc-state=default"]');
    const r = f.getBoundingClientRect();
    return { x: r.x, y: r.y, scale: r.width / f.offsetWidth };
  });
  const btn = await recFrame.evaluate(() => {
    const r = document.getElementById('go').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await canvas.mouse.click(ifr.x + btn.x * ifr.scale, ifr.y + btn.y * ifr.scale);
  if (process.env.DEBUG) console.log('DEBUG clicks', await recFrame.evaluate(() => [window.__clicks, location.href, document.body.innerHTML.slice(0, 200)]));
  if (process.env.DEBUG) {
    await new Promise((r) => setTimeout(r, 1000));
    console.log('DEBUG', await canvas.evaluate(() => ({
      rec: window.__fc.ui.getState().recording,
      hit: (() => { const f = document.querySelector('iframe[src*="fc-state=default"]'); const r = f.getBoundingClientRect(); const e = document.elementFromPoint(r.x + 40, r.y + 100); return [e?.tagName, e?.className, getComputedStyle(f).pointerEvents, JSON.stringify(r)]; })(),
      frames: [...window.__fc.host.frames.values()].map((f) => ({ id: f.frameId, cur: f.currentPath, click: f.lastClick, nonce: !!f.nonce })),
    })), await defaultFrame.evaluate(() => location.href));
  }
  const edge = await until(() => canvas.evaluate(() => window.__fc.project.getState().config.edges[0] ?? null), 5000);
  check(
    'record mode creates an edge from click + nav',
    !!edge && edge.from.screen === 'home' && edge.to.screen === 'about' && edge.trigger.label === 'Get started' && edge.trigger.target === '[data-fc="go-about"]',
    JSON.stringify(edge && { from: edge.from, to: edge.to, trigger: edge.trigger }),
  );
  await canvas.keyboard.press('r');
  await new Promise((r) => setTimeout(r, 500));
  await canvas.screenshot({ path: path.join(outDir, '3-recorded.png') });

  // 4. Undo removes the recorded edge in one step; redo brings it back.
  await canvas.evaluate(() => window.__fc.project.temporal.getState().undo());
  const afterUndo = await canvas.evaluate(() => window.__fc.project.getState().config.edges.length);
  await canvas.evaluate(() => window.__fc.project.temporal.getState().redo());
  const afterRedo = await canvas.evaluate(() => window.__fc.project.getState().config.edges.length);
  check('undo/redo of a recorded edge is one step', afterUndo === 0 && afterRedo === 1, `undo→${afterUndo} redo→${afterRedo}`);

  // 5. Persistence: reload the canvas, working copy restored from chrome.storage.local.
  await new Promise((r) => setTimeout(r, 600));
  await canvas.reload();
  const restored = await until(() => canvas.evaluate(() => {
    const c = window.__fc?.project.getState().config;
    return c && c.project.name === 'Smoke app' ? { screens: c.screens.length, edges: c.edges.length } : null;
  }), 8000);
  check('working copy restored after reload', !!restored && restored.edges === 1, JSON.stringify(restored));
  await new Promise((r) => setTimeout(r, 1500));
  await canvas.screenshot({ path: path.join(outDir, '4-restored.png') });
} catch (e) {
  check('smoke run', false, String(e?.stack ?? e));
} finally {
  await context.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${outDir}`);
process.exit(failed.length ? 1 : 0);
