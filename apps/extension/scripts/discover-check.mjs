#!/usr/bin/env node
/**
 * "Discover with Claude", end to end: the real MCP server over stdio + the
 * built extension in Chromium + the demo app.
 *
 *  1. Starts the demo on :5173 (DEMO_PORT to change; reused when already up) and builds @flowcanvas/mcp.
 *  2. Temp project: apps/demo/flowcanvas.config.json with no screens, sections,
 *     edges, notes, comments or images (origin http://localhost:5173).
 *  3. Launches Chromium with the built extension and `flowcanvas-mcp` via the MCP
 *     SDK client; opens the canvas, waits for the automatic crawl, clicks Allow.
 *  4. Clicks "Discover with Claude" on the empty state: the toast shows and the
 *     request appears in list_requests.
 *  5. Acting as Claude: reads the discover_screens prompt, calls scan_routes on
 *     apps/demo, then add_screens with the 12 routes (sample paths from
 *     sampleHints, sections by flow). The canvas shows them within 2 s, grouped;
 *     dynamic routes load (frame reaches "ready"); complete_request shows a toast;
 *     ONE undo removes them all (canvas and file).
 *  6. Stops the server: the action now copies the setup command instead.
 *  Screenshots in scripts/out/discover/.
 *
 *   pnpm --filter ./apps/extension build && node apps/extension/scripts/discover-check.mjs
 *
 * Uses the installed Playwright Chromium (channel: 'chromium'); never downloads browsers.
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
const root = path.resolve(here, '../../..');
const extPath = path.resolve(here, '../.output/chrome-mv3');
const outDir = path.join(here, 'out', 'discover');
fs.mkdirSync(outDir, { recursive: true });
// DEMO_PORT picks another port when :5173 is busy with something else.
const port = process.env.DEMO_PORT ?? '5173';
const origin = `http://localhost:${port}`;
const demoDir = path.join(root, 'apps/demo');
const mcpRequire = createRequire(path.join(root, 'packages/mcp/package.json'));
const { Client } = mcpRequire('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = mcpRequire('@modelcontextprotocol/sdk/client/stdio.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000, step = 50) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(step);
  }
  return null;
}
let failed = 0;
const check = (name, ok, info = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`);
};

/* ------------------------------ demo + MCP build ------------------------------ */
let demo = null;
const up = async () => (await fetch(origin).then((r) => r.ok).catch(() => false));
const isDemo = async () => /Helka ceramics/.test(await fetch(origin).then((r) => r.text()).catch(() => ''));
if (!(await up())) {
  console.log(`starting the demo on :${port} …`);
  demo = spawn('pnpm', ['--filter', './apps/demo', 'dev', '--port', port, '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  if (!(await until(up, 30000, 300))) throw new Error(`demo did not start on :${port}`);
} else if (!(await isDemo())) {
  throw new Error(`:${port} serves something other than the demo; set DEMO_PORT to a free port`);
}
console.log('building @flowcanvas/mcp …');
execSync('pnpm --filter @flowcanvas/mcp build', { cwd: root, stdio: 'ignore' });
if (!fs.existsSync(path.join(extPath, 'manifest.json'))) throw new Error('build the extension first: pnpm --filter ./apps/extension build');

/* ------------------------------ empty project ------------------------------ */
const demoConfig = JSON.parse(fs.readFileSync(path.join(demoDir, 'flowcanvas.config.json'), 'utf8'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-discover-check-'));
const empty = { ...demoConfig, project: { ...demoConfig.project, origin }, sections: [], screens: [], edges: [], mocks: {}, images: [], notes: [], comments: [] };
fs.writeFileSync(path.join(project, 'flowcanvas.config.json'), JSON.stringify(empty, null, 2) + '\n');
const readFile = () => JSON.parse(fs.readFileSync(path.join(project, 'flowcanvas.config.json'), 'utf8'));

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1600, height: 900 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
let mcp = null;
const stderr = [];
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker', { timeout: 10000 });
  const extId = new URL(sw.url()).host;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `chrome-extension://${extId}` }).catch(() => {});

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'packages/mcp/dist/cli.js'), '--project', project, '--extension-id', extId, '--origin', origin],
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (d) => stderr.push(String(d)));
  mcp = new Client({ name: 'discover-check', version: '1.0.0' });
  const updates = [];
  await mcp.connect(transport);
  const { ResourceUpdatedNotificationSchema } = mcpRequire('@modelcontextprotocol/sdk/types.js');
  mcp.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => updates.push(n.params.uri));
  const call = async (name, args = {}) => {
    const r = await mcp.callTool({ name, arguments: args });
    const t = r.content.find((c) => c.type === 'text')?.text ?? '';
    if (r.isError) throw new Error(`${name}: ${t}`);
    return JSON.parse(t);
  };
  const p0 = await call('get_project');
  check('get_project on an empty project points to the discover_screens prompt', /No screens yet: run the discover_screens prompt/.test(p0.hint ?? ''), p0.hint);

  /* Canvas: wait for the automatic crawl, then Allow (the file wins: 0 screens). */
  const canvas = await context.newPage();
  const errors = [];
  canvas.on('pageerror', (e) => errors.push(e.message));
  await canvas.goto(`chrome-extension://${extId}/canvas.html?origin=${encodeURIComponent(origin)}`);
  const st = (fn, arg) => canvas.evaluate(fn, arg);
  await until(() => st(() => !!window.__fc?.claude?.getState().ask), 15000);
  await until(() => st(() => window.__fc.ui.getState().discovery?.running === false), 20000);
  await canvas.getByRole('alertdialog').getByRole('button', { name: 'Allow' }).click();
  const synced = await until(() => st(() => window.__fc.claude.getState().phase === 'linked' && window.__fc.project.getState().config.screens.length === 0), 10000);
  check('linked, and the canvas shows the empty project from the file', !!synced);

  /* Click "Discover with Claude" on the empty state. */
  const btn = canvas.getByRole('button', { name: 'Discover with Claude' });
  await until(() => btn.isVisible(), 5000);
  check('the empty state offers "Discover with Claude"', await btn.isVisible());
  await btn.click();
  const toast = canvas.getByRole('status', { name: 'Discover with Claude' });
  const toastText = await until(async () => {
    const t = await toast.textContent();
    return /Asked Claude to discover screens/.test(t ?? '') ? t : null;
  }, 4000);
  check('toast: "Asked Claude to discover screens. In Claude Code, say: discover my screens"', /In Claude Code, say: discover my screens/.test(toastText ?? ''), (toastText ?? '').slice(0, 120));
  check('the toast has a Copy button and says when Claude acts', (await toast.getByRole('button', { name: 'Copy' }).count()) === 1 && /next message/.test(toastText ?? ''));
  await canvas.screenshot({ path: path.join(outDir, '1-asked.png') });

  const reqs = await call('list_requests');
  const req = reqs.requests[0];
  check('list_requests shows the pending discover request', reqs.requests.length === 1 && req.kind === 'discover' && req.status === 'pending', JSON.stringify(req ?? {}).slice(0, 120));
  check('the server sent resources/updated for flowcanvas://requests', !!(await until(() => updates.includes('flowcanvas://requests'), 2000)));
  const pj = await call('get_project');
  check('get_project lists the pending request', pj.pendingRequests?.[0]?.id === req?.id);

  /* Acting as Claude: the recipe, scan_routes, add_screens. */
  const prompt = await mcp.getPrompt({ name: 'discover_screens', arguments: { dir: demoDir } });
  const recipe = prompt.messages[0].content.text;
  check('discover_screens prompt: scan_routes → states → samples → add_screens → edges → note', ['scan_routes', 'add_screens', 'add_edge', 'add_note', `complete_request\` { id: "${req.id}"`].every((s) => recipe.includes(s)));
  const scan = await call('scan_routes', { dir: demoDir });
  check('scan_routes finds the 12 demo routes', scan.routes.length === 12, scan.summary);
  const flow = (r) =>
    r === '/' || r === '/interests' ? 'Onboarding' : ['/catalog', '/product/:id', '/wishlist'].includes(r) ? 'Browse' : ['/bag', '/checkout', '/order-confirmed'].includes(r) ? 'Checkout' : 'Classes';
  // Titles and states as Claude would read them from the screens (the demo config has them).
  const known = (route) => demoConfig.screens.find((s) => (route.includes(':') ? new RegExp('^' + route.replace(/:[^/]+/g, '[^/]+') + '$').test(s.path) : s.path === route));
  const screens = scan.routes.map((r) => {
    const k = known(r.route);
    return {
      id: k.id,
      title: k.title,
      path: r.samplePath ?? r.route,
      ...(r.dynamicParams.length ? { route: r.route } : {}),
      section: flow(r.route),
      states: k.states,
    };
  });
  const dyn = screens.filter((s) => s.route);
  check('dynamic routes get real sample paths from the repo', dyn.length === 4 && dyn.every((s) => !s.path.includes(':')), dyn.map((s) => s.path).join(' '));
  const t0 = Date.now();
  const added = await call('add_screens', {
    screens,
    sections: [
      { title: 'Onboarding', color: 'blue' },
      { title: 'Browse', color: 'green' },
      { title: 'Checkout', color: 'amber' },
      { title: 'Classes', color: 'purple' },
    ],
  });
  check('add_screens adds 12 screens and 4 sections in one call', added.added.length === 12 && added.sectionsCreated.length === 4);
  const shown = await until(() => st(() => window.__fc.project.getState().config.screens.length === 12), 2000, 20);
  const ms = Date.now() - t0;
  check('the canvas shows the 12 screens within 2 s', !!shown, `${ms} ms`);
  const grouped = await st(() => {
    const c = window.__fc.project.getState().config;
    return { sections: c.sections.map((s) => s.title), bySection: Object.fromEntries(c.sections.map((s) => [s.title, c.screens.filter((x) => x.section === s.id).length])), positions: c.screens.filter((s) => s.position).length };
  });
  check('grouped by flow: Onboarding 2, Browse 3, Checkout 3, Classes 4', JSON.stringify(grouped.bySection) === JSON.stringify({ Onboarding: 2, Browse: 3, Checkout: 3, Classes: 4 }), JSON.stringify(grouped.bySection));
  check('new screens have no stored position (the canvas lays them out)', grouped.positions === 0);
  const file = readFile();
  check('the file has the 12 screens with route patterns and source "claude"', file.screens.length === 12 && file.screens.every((s) => s.source === 'claude') && file.screens.filter((s) => s.route).length === 4);
  const sideNames = await canvas.getByRole('navigation', { name: 'Flows' }).textContent().catch(() => '');
  check('the player sidebar lists the sections', ['Onboarding', 'Browse', 'Checkout', 'Classes'].every((t) => (sideNames ?? '').includes(t)), (sideNames ?? '').slice(0, 80));
  await canvas.screenshot({ path: path.join(outDir, '2-discovered-player.png') });

  /* Canvas mode: sections drawn; dynamic routes load with their sample values. */
  await canvas.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click();
  await sleep(1200);
  const sectionBtns = await Promise.all(['Onboarding', 'Browse', 'Checkout', 'Classes'].map((t) => canvas.getByRole('button', { name: `Collapse ${t}` }).count()));
  check('the canvas draws the 4 sections', sectionBtns.every((n) => n === 1), sectionBtns.join(','));
  for (const id of ['product', 'class', 'book-seat']) {
    const key = `${id}:${screens.find((s) => s.id === id).states[0]}`;
    await st((k) => window.__fc.rf.fitView({ nodes: [{ id: k }], maxZoom: 0.8, padding: 0.1 }), key);
    const ready = await until(() => st((k) => window.__fc.ui.getState().status[k] === 'ready', key), 30000);
    const status = ready ? 'ready' : `${await st((k) => window.__fc.ui.getState().status[k], key)}; demo up: ${await up()}`;
    check(`${screens.find((s) => s.id === id).path} loads in its frame (ready)`, !!ready, `${key}: ${status}`);
  }
  await st(() => window.__fc.rf.fitView({ padding: 0.05 }));
  await sleep(1500);
  await canvas.screenshot({ path: path.join(outDir, '3-discovered-canvas.png') });

  /* Claude finishes the request: the canvas shows the summary. */
  await call('complete_request', { id: req.id, summary: 'Added 12 screens in 4 sections.' });
  const doneToast = await until(async () => /Finished discovering screens: Added 12 screens/.test((await toast.textContent().catch(() => '')) ?? ''), 3000);
  check('complete_request shows "Finished discovering screens" on the canvas', !!doneToast);
  check('list_requests is empty again', (await call('list_requests')).requests.length === 0);

  /* One undo removes them all. */
  const label = () => canvas.getByRole('button', { name: /^Undo/ }).getAttribute('aria-label');
  for (let i = 0; i < 6 && !/Claude: discovered 12 screens/.test((await label()) ?? ''); i++) await canvas.locator('body').press('Control+z');
  const undoLabel = await label();
  check('Undo is labelled "Claude: discovered 12 screens"', /^Undo Claude: discovered 12 screens/.test(undoLabel ?? ''), undoLabel ?? '');
  await canvas.locator('body').press('Control+z');
  const undone = await until(() => st(() => {
    const c = window.__fc.project.getState().config;
    return c.screens.length === 0 && c.sections.length === 0;
  }), 1500);
  check('one undo removes all 12 screens and the 4 sections', !!undone);
  check('the undo reaches the file', !!(await until(() => readFile().screens.length === 0, 3000)));
  await canvas.screenshot({ path: path.join(outDir, '4-undone.png') });

  /* Not linked: the action copies the setup command and a ready prompt. */
  await mcp.close();
  mcp = null;
  await until(() => st(() => window.__fc.claude.getState().phase !== 'linked'), 8000);
  await canvas.getByRole('button', { name: /Helka ceramics|Flow Canvas project/ }).first().click();
  await canvas.getByRole('menuitem', { name: 'Discover with Claude…' }).click();
  const setup = await until(async () => {
    const t = (await toast.textContent().catch(() => '')) ?? '';
    return /Claude is not linked/.test(t) ? t : null;
  }, 3000);
  check('not linked: shows and copies the claude mcp add command plus a prompt', /claude mcp add flowcanvas -- npx -y @flowcanvas\/mcp --project \./.test(setup ?? '') && /discover_screens/.test(setup ?? ''), (setup ?? '').slice(0, 100));
  const clip = await canvas.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (clip !== null) check('the setup text is on the clipboard', /claude mcp add flowcanvas/.test(clip));
  await canvas.screenshot({ path: path.join(outDir, '5-not-linked.png') });
  check('no page errors in the canvas', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  failed++;
  console.log('FAIL (exception)', e.stack ?? e);
} finally {
  await mcp?.close().catch(() => {});
  await context.close();
  if (demo) {
    try {
      process.kill(-demo.pid);
    } catch {}
  }
  if (failed && stderr.length) console.log('--- mcp stderr ---\n' + stderr.join('').slice(-2000));
  fs.rmSync(project, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
