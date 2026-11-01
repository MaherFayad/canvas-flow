#!/usr/bin/env node
/**
 * M6 gate, end to end: the real MCP server over stdio + the built extension in
 * Chromium + the demo app.
 *
 *  1. Starts the demo on :5173 (unless it is already up) and builds @flowcanvas/mcp.
 *  2. Launches Chromium with the built extension; starts `flowcanvas-mcp` with the
 *     MCP SDK Client over stdio against a temp copy of apps/demo/flowcanvas.config.json
 *     (--extension-id <loaded id> --origin http://localhost:5173).
 *  3. Opens the canvas, clicks Allow, then:
 *     - drops a "For Claude" comment on a Catalog element through the UI;
 *     - list_comments (selector + element HTML arrive), reply_comment, add_edge,
 *       add_note, add_image: each shows on the canvas within 2 s and in the file;
 *     - collapses a section (iframes unmount) and expands it;
 *     - undoes the last Claude change in one step (canvas + file);
 *     - Pause Claude blocks a write.
 *  4. Screenshots to scripts/out/mcp/.
 *
 *   pnpm --filter ./apps/extension build && node apps/extension/scripts/mcp-check.mjs
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
const outDir = path.join(here, 'out', 'mcp');
fs.mkdirSync(outDir, { recursive: true });
const origin = 'http://localhost:5173';
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

/** Drop a small generated PNG on the canvas (like a file from Finder). */
async function page_drop(page) {
  await page.evaluate(async () => {
    const cv = new OffscreenCanvas(320, 200);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.fillText('Dropped ' + Date.now(), 20, 110);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
    const target = document.querySelector('.react-flow');
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top + 200 }));
  });
}

/* ------------------------------ demo + MCP build ------------------------------ */
let demo = null;
const up = async () => (await fetch(origin).then((r) => r.ok).catch(() => false));
if (!(await up())) {
  console.log('starting the demo on :5173 …');
  demo = spawn('pnpm', ['--filter', './apps/demo', 'dev', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  if (!(await until(up, 30000, 300))) throw new Error('demo did not start on :5173');
}
console.log('building @flowcanvas/mcp …');
execSync('pnpm --filter @flowcanvas/mcp build', { cwd: root, stdio: 'ignore' });
if (!fs.existsSync(path.join(extPath, 'manifest.json'))) throw new Error('build the extension first: pnpm --filter ./apps/extension build');

/* ------------------------------ project copy ------------------------------ */
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mcp-check-'));
fs.copyFileSync(path.join(root, 'apps/demo/flowcanvas.config.json'), path.join(project, 'flowcanvas.config.json'));
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

  /* MCP server over stdio (what Claude Code runs). */
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'packages/mcp/dist/cli.js'), '--project', project, '--extension-id', extId, '--origin', origin],
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (d) => stderr.push(String(d)));
  mcp = new Client({ name: 'mcp-check', version: '1.0.0' });
  await mcp.connect(transport);
  const callRaw = (name, args = {}) => mcp.callTool({ name, arguments: args });
  const call = async (name, args = {}) => {
    const r = await callRaw(name, args);
    const t = r.content.find((c) => c.type === 'text')?.text ?? '';
    if (r.isError) throw new Error(`${name}: ${t}`);
    return JSON.parse(t);
  };
  const tools = await mcp.listTools();
  check('MCP server lists its tools over stdio', tools.tools.length >= 25, `${tools.tools.length} tools`);

  /* Canvas */
  const canvas = await context.newPage();
  const errors = [];
  canvas.on('pageerror', (e) => errors.push(e.message));
  canvas.on('crash', () => console.log('canvas renderer crashed'));
  context.on('close', () => console.log('browser context closed'));
  await canvas.goto(`chrome-extension://${extId}/canvas.html?origin=${encodeURIComponent(origin)}`);
  const st = (fn) => canvas.evaluate(fn);

  const asked = await until(() => st(() => !!window.__fc?.claude?.getState().ask), 15000);
  check('canvas finds the server and asks "Claude wants to connect to Helka ceramics. Allow?"', !!asked);
  const promptText = await canvas.getByRole('alertdialog').first().textContent();
  check('prompt names the project', /Claude wants to connect to Helka ceramics\. Allow\?/.test(promptText ?? ''), promptText ?? '');
  await canvas.screenshot({ path: path.join(outDir, '0-allow.png') });
  await canvas.getByRole('alertdialog').getByRole('button', { name: 'Allow' }).click();
  const synced = await until(() => st(() => window.__fc.claude.getState().phase === 'linked' && window.__fc.project.getState().config.screens.length >= 12), 10000);
  check('linked and fully synced from the file', !!synced);
  check('top bar shows "Claude linked" and hides Save', (await canvas.getByRole('button', { name: /Claude linked/ }).count()) === 1 && (await canvas.getByRole('button', { name: /^Save/ }).count()) === 0);
  const project0 = await call('get_project');
  check('get_project reports the canvas link', project0.canvas?.linked === true && project0.canvas?.granted === true, JSON.stringify(project0.canvas));

  /* Canvas mode, zoom to Catalog default. */
  await canvas.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click();
  await sleep(1200);
  await st(() => window.__fc.rf.fitView({ nodes: [{ id: 'catalog:default' }], maxZoom: 0.8, padding: 0.1 }));
  const catReady = await until(() => st(() => window.__fc.ui.getState().status['catalog:default'] === 'ready'), 30000);
  check('Catalog default frame is live', !!catReady);
  await sleep(800);
  const catFrame = await until(() =>
    canvas.frames().find((f) => {
      try {
        const u = new URL(f.url());
        return u.pathname === '/catalog' && u.searchParams.get('fc-state') === 'default';
      } catch {
        return false;
      }
    }),
  );
  // Playwright's boundingBox ignores the canvas zoom (a CSS scale on an ancestor of
  // the iframe), so map the chip's in-frame rect through the iframe box ourselves.
  const inner = await catFrame.evaluate(() => {
    const r = document.querySelector('[data-fc="filter-cups"]')?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  });
  const ifr = await canvas.locator('iframe[title="Catalog, default state"]').boundingBox();
  const z = ifr ? ifr.width / 440 : 1;
  const box = inner && ifr ? { x: ifr.x + inner.x * z, y: ifr.y + inner.y * z, width: inner.w * z, height: inner.h * z } : null;
  check('found the "cups" filter chip in the live Catalog frame', !!box);

  /* Comment through the UI: C, click the chip, write, For Claude, Post. */
  await canvas.locator('body').press('Escape');
  await canvas.keyboard.press('c');
  check('C turns on comment mode', await st(() => window.__fc.board.getState().tool === 'comment'));
  await canvas.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const read = await until(() => st(() => {
    const c = window.__fc.board.getState().composer;
    return c && !c.reading ? c : null;
  }), 8000);
  check('pin drop reads the element under it', read?.element?.selector === '[data-fc="filter-cups"]', JSON.stringify(read?.element?.selector));
  await canvas.getByRole('dialog', { name: 'New comment' }).getByLabel('Comment').fill('Make this chip a 44 px target and add an edge back to Catalog default.');
  await canvas.getByRole('dialog', { name: 'New comment' }).getByLabel('For Claude').check();
  await canvas.getByRole('dialog', { name: 'New comment' }).getByRole('button', { name: 'Post' }).click();
  const inFile = await until(() => readFile().comments.find((c) => c.to === 'claude' && c.anchor.frame === 'catalog:default'), 4000);
  check('the For Claude comment reaches flowcanvas.config.json', !!inFile);
  const pinVisible = await until(() => canvas.locator('.fc-pin button.dot').first().isVisible(), 2000);
  check('a numbered pin shows on the frame', !!pinVisible);
  await canvas.screenshot({ path: path.join(outDir, '1-comment.png') });

  /* list_comments */
  const listed = await call('list_comments', { status: 'open', to: 'claude' });
  const cm = listed.comments.find((c) => c.id === inFile?.id);
  check('list_comments returns the selector', cm?.anchor?.element?.selector === '[data-fc="filter-cups"]', cm?.anchor?.element?.selector);
  check('list_comments returns the element HTML (≤ 2 KB)', /data-fc="filter-cups"/.test(cm?.anchor?.element?.html ?? '') && cm.anchor.element.html.length <= 2048, (cm?.anchor?.element?.html ?? '').slice(0, 90));
  check('list_comments returns key styles', !!cm?.anchor?.element?.styles?.padding, JSON.stringify(cm?.anchor?.element?.styles));

  const seen = async (label, pred, file) => {
    const t0 = Date.now();
    const ok = await until(() => st(pred), 2000, 25);
    const ms = Date.now() - t0;
    check(`${label} shows on the canvas within 2 s`, !!ok, `${ms} ms`);
    const f = await until(() => file(readFile()), 2000);
    check(`${label} is in the file`, !!f);
  };

  /* add_edge */
  const edge = await call('add_edge', {
    from: { screen: 'catalog', state: 'empty' },
    to: { screen: 'catalog', state: 'default' },
    trigger: { label: 'Clear filters', target: '[data-fc="clear-filters"]' },
    kind: 'alternate',
  });
  const eid = edge.id;
  await seen('add_edge', new Function(`return window.__fc.rf.getEdges().some((e) => e.id === ${JSON.stringify(eid)})`), (f) => f.edges.some((e) => e.id === eid));

  /* reply_comment (links the edge) */
  await call('reply_comment', { threadId: cm.id, text: 'Done: the chip is 44 px tall now. Added the Clear filters edge.', changes: [eid] });
  await seen(
    'reply_comment',
    new Function(`return window.__fc.project.getState().config.comments.find((c) => c.id === ${JSON.stringify(cm.id)})?.thread.some((m) => m.author === 'claude')`),
    (f) => f.comments.find((c) => c.id === cm.id)?.thread.length === 2,
  );
  const badge = await until(() => canvas.locator('aside[aria-label="Comments"] .fc-claude-badge').count(), 2000);
  check('Claude reply shows with a Claude badge in the Comments panel', !!badge);
  check('Claude reply links its change', (await canvas.locator('aside[aria-label="Comments"]').getByRole('button', { name: `edge ${eid}` }).count()) >= 1);

  /* add_note (attached to the frame) */
  const note = await call('add_note', { text: '**Decision:** chips are *44 px* tall so they pass target size.', kind: 'decision', attachTo: { type: 'frame', id: 'catalog:default' } });
  const nid = note.id;
  await seen('add_note', new Function(`const n = document.querySelector('.react-flow__node-note[data-id=${JSON.stringify(nid)}]'); return !!n && getComputedStyle(n).visibility === 'visible' && !!n.querySelector('strong')`), (f) => f.notes.some((n) => n.id === nid));
  const changedFlag = await until(() => canvas.locator('.fc-flash', { hasText: 'Changed by Claude' }).first().isVisible(), 1500);
  check('"Changed by Claude" shows on the changed item', !!changedFlag);
  await canvas.screenshot({ path: path.join(outDir, '2-claude-changes.png') });

  /* add_image (from a local file) */
  const png = path.join(project, 'reference.png');
  fs.writeFileSync(png, await canvas.screenshot({ clip: { x: 0, y: 36, width: 520, height: 390 } }));
  const cat = await st(() => window.__fc.rf.getNode('catalog:default').position);
  const img = await call('add_image', { path: 'reference.png', x: Math.round(cat.x + 700), y: Math.round(cat.y), caption: 'Reference shot' });
  const iid = img.id;
  await seen(
    'add_image',
    new Function(`const n = document.querySelector('.react-flow__node-image[data-id=${JSON.stringify(iid)}]'); const i = n?.querySelector('img'); return !!i && getComputedStyle(n).visibility === 'visible' && i.complete && i.naturalWidth > 0`),
    (f) => f.images.some((i) => i.id === iid && /^\.flowcanvas\/assets\/[0-9a-f]{12}\.png$/.test(i.file)),
  );
  check('the image file is in .flowcanvas/assets/', fs.existsSync(path.join(project, img.image.file)));
  await st(() => window.__fc.rf.fitView({ nodes: [{ id: 'catalog:default' }, { id: window.__fc.project.getState().config.images.at(-1).id }], maxZoom: 0.6, padding: 0.15 }));
  await sleep(1200);
  await canvas.screenshot({ path: path.join(outDir, '3-image.png') });

  /* An image dropped on the canvas is written to .flowcanvas/assets/ through the link. */
  await page_drop(canvas);
  const droppedImg = await until(() => {
    const f = readFile();
    const i = f.images.find((x) => x.caption === undefined && x.id !== iid && x.file);
    return i && fs.existsSync(path.join(project, i.file)) ? i : null;
  }, 5000);
  check('a dropped image reaches the repo as .flowcanvas/assets/<hash>.<ext>', !!droppedImg, droppedImg?.file ?? '');

  /* Collapse a section: its frames unmount (zoomed in, so they are live first). */
  await st(() => window.__fc.rf.fitView({ nodes: [{ id: 'pick-interests:default' }, { id: 'catalog:default' }], maxZoom: 0.6, padding: 0.05 }));
  await until(() => st(() => window.__fc.ui.getState().live.has('catalog:default') && window.__fc.ui.getState().live.has('pick-interests:default')), 5000);
  await sleep(1500);
  const liveOpen = await canvas.locator('iframe').count();
  const liveSetOpen = await st(() => window.__fc.ui.getState().live.size);
  await canvas.getByRole('button', { name: 'Collapse Onboarding' }).dispatchEvent('click');
  await sleep(800);
  const liveCollapsed = await canvas.locator('iframe').count();
  const liveSetCollapsed = await st(() => window.__fc.ui.getState().live.size);
  const hostFrames = await st(() => [...window.__fc.host.frames.values()].filter((f) => !f.discover && ['welcome', 'pick-interests', 'catalog'].includes(f.screen)).length);
  check(
    'collapsing Onboarding unmounts its frames (live count and iframes drop)',
    liveCollapsed < liveOpen && liveSetCollapsed < liveSetOpen && hostFrames === 0,
    `iframes ${liveOpen} → ${liveCollapsed}, live ${liveSetOpen} → ${liveSetCollapsed}`,
  );
  await canvas.screenshot({ path: path.join(outDir, '4-collapsed.png') });
  await canvas.getByRole('button', { name: 'Expand Onboarding' }).dispatchEvent('click');
  await sleep(600);

  /* Undo the last Claude change (add_image) in one step. */
  await until(() => st(() => (window.__fc.project.getState().config.sections.find((s) => s.id === 'onboarding')?.collapsed === false)));
  // Undo the canvas edits made since (expand, collapse, the dropped image), one step each,
  // until the next step is Claude's add_image.
  const label = () => canvas.getByRole('button', { name: /^Undo/ }).getAttribute('aria-label');
  for (let i = 0; i < 5 && !/Claude: add image/.test((await label()) ?? ''); i++) await canvas.locator('body').press('Control+z');
  const undoLabel = await label();
  check('Undo is labelled with the Claude change', /^Undo Claude: add image/.test(undoLabel ?? ''), undoLabel ?? '');
  const notesBefore = await st(() => window.__fc.project.getState().config.notes.length);
  await canvas.locator('body').press('Control+z');
  const undone = await until(() => st(new Function(`const c = window.__fc.project.getState().config; return !c.images.some((i) => i.id === ${JSON.stringify(iid)})`)), 1000);
  const notesAfter = await st(() => window.__fc.project.getState().config.notes.length);
  check('one undo removes exactly the Claude change (image gone, note kept)', !!undone && notesAfter === notesBefore);
  const fileUndone = await until(() => !readFile().images.some((i) => i.id === iid), 3000);
  check('the undo reaches the file', !!fileUndone);

  /* Canvas-only tools. */
  const tgt = await call('check_target', { screenId: 'catalog', state: 'default', selector: '[data-fc="filter-cups"]' });
  check('check_target finds a selector in the live frame', tgt.found === true && tgt.rect?.w > 0, JSON.stringify(tgt.rect));
  const miss = await call('check_target', { screenId: 'catalog', state: 'default', selector: '[data-fc="nope"]' });
  check('check_target reports a missing selector', miss.found === false);
  const flow = await call('play_flow', { sectionId: 'onboarding' });
  check('play_flow steps through the section edges', typeof flow.pass === 'boolean' && flow.steps >= 2, JSON.stringify(flow).slice(0, 160));
  const tokens = await call('get_tokens');
  check('get_tokens reads the app tokens', tokens.base.length > 5, `${tokens.base.length} tokens`);
  await call('focus', { itemId: nid });
  await sleep(700);
  const focused = await st(new Function(`const n = window.__fc.rf.getNode(${JSON.stringify(nid)}); const t = window.__fc.rf.getViewport(); const x = n.position.x * t.zoom + t.x; return x > 0 && x < 1300`));
  check('focus flies the camera to the item', !!focused);
  await st(() => window.__fc.rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === 'catalog:default' }))));
  const sel = await call('get_selection');
  check('get_selection returns what is selected', sel.ids.includes('catalog:default'), JSON.stringify(sel.ids));

  /* Guardrail: deletes ask Allow / Deny on the canvas. */
  const del = callRaw('delete_items', { ids: [nid] });
  const toast = await until(() => canvas.getByRole('alertdialog', { name: 'Claude asks to confirm' }).isVisible(), 4000);
  check('delete_items shows an Allow / Deny toast', !!toast);
  await canvas.screenshot({ path: path.join(outDir, '4b-confirm.png') });
  await canvas.getByRole('alertdialog', { name: 'Claude asks to confirm' }).getByRole('button', { name: 'Deny' }).click();
  const delR = await del;
  check('Deny keeps the item', delR.isError === true && readFile().notes.some((n) => n.id === nid), (delR.content[0]?.text ?? '').slice(0, 70));
  const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`--fc-check-${i}`, `${i}px`]));
  const tok = callRaw('set_tokens', { vars: many });
  await until(() => canvas.getByRole('alertdialog', { name: 'Claude asks to confirm' }).isVisible(), 4000);
  await canvas.getByRole('alertdialog', { name: 'Claude asks to confirm' }).getByRole('button', { name: 'Allow' }).click();
  const tokR = await tok;
  check('more than 10 token changes ask first; Allow applies them', !tokR.isError && Object.keys(readFile().tokens).length >= 11);

  /* Pause Claude blocks a write. */
  await canvas.getByRole('switch', { name: /Pause Claude/ }).first().click();
  await sleep(300);
  const notesInFile = readFile().notes.length;
  const blocked = await callRaw('add_note', { text: 'should be blocked' });
  const blockedText = blocked.content.find((c) => c.type === 'text')?.text ?? '';
  check('Pause Claude blocks write tools', blocked.isError === true && /paused/i.test(blockedText), blockedText.slice(0, 80));
  await sleep(400);
  check('nothing was written while paused', readFile().notes.length === notesInFile);
  const activity = await st(() => window.__fc.claude.getState().activity.map((a) => `${a.tool}:${a.ok ? 'ok' : 'fail'}`));
  check('Activity panel rows for each tool call', activity.includes('add_note:fail') && activity.includes('add_edge:ok') && activity.includes('reply_comment:ok'), activity.slice(0, 8).join(' '));
  await canvas.getByRole('button', { name: /Claude paused/ }).click();
  await sleep(400);
  await canvas.screenshot({ path: path.join(outDir, '5-activity-paused.png') });

  /* Final view: comment pin, Claude's note and edge, the comments panel. */
  if ((await canvas.getByRole('button', { name: /^Comments/ }).getAttribute('aria-pressed')) !== 'true') await canvas.getByRole('button', { name: /^Comments/ }).click();
  await canvas.keyboard.press('Escape');
  await st(new Function(`window.__fc.rf.fitView({ nodes: [{ id: 'pick-interests:default' }, { id: 'catalog:default' }, { id: ${JSON.stringify(nid)} }], maxZoom: 0.6, padding: 0.08 })`));
  await sleep(1800);
  await canvas.screenshot({ path: path.join(outDir, '6-final.png') });
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
