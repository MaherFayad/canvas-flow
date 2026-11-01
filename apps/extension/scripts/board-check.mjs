#!/usr/bin/env node
/**
 * Canvas board check (no MCP): sections, sticky notes and images through the
 * UI against the demo app, with screenshots in scripts/out/board/.
 *
 *  - N adds a sticky note; markdown renders; kind + attach to a frame; the note
 *    follows the frame when it moves.
 *  - S draws a section around frames; Cmd/Ctrl+G groups a selection; nesting
 *    stops at 3 levels; lock; auto-layout grid; Cmd/Ctrl+Shift+G ungroups;
 *    dragging a section header moves its contents; collapse unmounts frames.
 *  - Dropping a > 5 MB PNG stores a 2560 px WebP in IndexedDB; ratio-locked
 *    resize, crop, opacity, caption, overlay on frame.
 *
 *   pnpm --filter ./apps/demo dev   # or let the script start it
 *   pnpm --filter ./apps/extension build && node apps/extension/scripts/board-check.mjs
 */
import { spawn } from 'node:child_process';
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
const root = path.resolve(here, '../../..');
const extPath = path.resolve(here, '../.output/chrome-mv3');
const outDir = path.join(here, 'out', 'board');
fs.mkdirSync(outDir, { recursive: true });
const origin = 'http://localhost:5173';
const config = JSON.parse(fs.readFileSync(path.join(root, 'apps/demo/flowcanvas.config.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 60) {
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

let demo = null;
const up = async () => (await fetch(origin).then((r) => r.ok).catch(() => false));
if (!(await up())) {
  demo = spawn('pnpm', ['--filter', './apps/demo', 'dev', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  if (!(await until(up, 30000, 300))) throw new Error('demo did not start on :5173');
}

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
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extId}/canvas.html?origin=${encodeURIComponent(origin)}`);
  await sleep(1200);
  await page.evaluate((c) => window.__fc.project.getState().importConfig(c), config);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click();
  await sleep(1000);
  const st = (fn, arg) => page.evaluate(fn, arg);
  const cfg = () => st(() => window.__fc.project.getState().config);
  const fit = (ids, maxZoom = 0.5) => st(({ ids, maxZoom }) => window.__fc.rf.fitView({ nodes: ids.map((id) => ({ id })), maxZoom, padding: 0.12 }), { ids, maxZoom });
  const undos = () => st(() => window.__fc.project.temporal.getState().pastStates.length);

  /* ---------------- sticky note ---------------- */
  await fit(['welcome:default', 'pick-interests:default'], 0.6);
  await sleep(600);
  await page.locator('body').press('n');
  const noteId = await until(() => st(() => window.__fc.board.getState().editingNote));
  check('N adds a sticky note in edit mode', !!noteId);
  await page.getByLabel('Note text (markdown)').fill('**Skip** goes to *Catalog*, not Login.\n\n- check `fc.is("empty")`\n- [spec](https://example.com)\n\n<script>alert(1)</script>');
  await page.getByLabel('Note text (markdown)').press('Escape');
  const note = page.locator(`.react-flow__node-note[data-id="${noteId}"]`);
  check('markdown renders bold, italic, list, code, link', (await note.locator('strong').count()) === 1 && (await note.locator('em').count()) === 1 && (await note.locator('li').count()) === 2 && (await note.locator('code').count()) === 1 && (await note.locator('a[href="https://example.com"]').count()) === 1);
  check('raw HTML stays text', (await note.locator('script').count()) === 0 && /<script>/.test(await note.innerText()));
  await note.getByLabel('Note kind').selectOption('decision');
  await note.getByRole('button', { name: 'Attach note' }).click();
  await note.locator('select').nth(1).selectOption({ label: 'Frame: Welcome · default' });
  await sleep(200);
  const n0 = (await cfg()).notes.find((n) => n.id === noteId);
  check('kind + attach saved', n0?.kind === 'decision' && n0?.attachTo?.id === 'welcome:default');
  // Move the frame: the note follows in the same undo step.
  const beforeUndo = await undos();
  await st(() => window.__fc.project.getState().moveScreen('welcome', { x: -300, y: 0 }));
  const n1 = (await cfg()).notes.find((n) => n.id === noteId);
  check('attached note moves with its frame (one undo step)', n1.rect.x === n0.rect.x - 300 && (await undos()) === beforeUndo + 1, `${n0.rect.x} → ${n1.rect.x}`);
  await page.locator('body').press('Control+z');
  await sleep(300);
  await fit(['welcome:default', noteId], 0.6);
  await sleep(900);
  await page.screenshot({ path: path.join(outDir, '1-note.png') });

  /* ---------------- sections ---------------- */
  // Draw a section with S around Welcome + Pick interests (default row).
  await fit(['welcome:default', 'pick-interests:default'], 0.35);
  await sleep(700);
  await page.locator('body').press('s');
  const a = await page.locator('.react-flow__node[data-id="welcome:default"]').boundingBox();
  const b = await page.locator('.react-flow__node[data-id="pick-interests:default"]').boundingBox();
  await page.mouse.move(a.x - 20, a.y - 20);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 20, b.y + b.height + 20, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  let c = await cfg();
  const drawn = c.sections.find((s) => !['onboarding', 'browse', 'checkout', 'classes'].includes(s.id));
  check('S draws a section holding the frames inside it', !!drawn && c.screens.filter((s) => s.section === drawn.id).map((s) => s.id).sort().join() === 'pick-interests,welcome', drawn && JSON.stringify({ parent: drawn.parent, rect: drawn.rect }));
  check('drawn section nests inside Onboarding (level 2)', drawn?.parent === 'onboarding');

  // Cmd/Ctrl+G on a selection (one frame) → level 3; again → refused (would be level 4).
  await st(() => window.__fc.rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === 'welcome:default' }))));
  await page.locator('body').press('Control+g');
  await sleep(200);
  c = await cfg();
  const lvl3 = c.sections.find((s) => s.parent === drawn.id);
  check('Cmd/Ctrl+G groups the selection (level 3)', !!lvl3 && c.screens.find((s) => s.id === 'welcome').section === lvl3.id);
  await st(() => window.__fc.rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === 'welcome:default' }))));
  await page.locator('body').press('Control+g');
  await sleep(200);
  check('nesting stops at 3 levels', (await cfg()).sections.length === c.sections.length && /3 levels/.test(await st(() => window.__fc.ui.getState().announce)));
  // Ungroup level 3.
  await st((id) => window.__fc.rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === `section:${id}` }))), lvl3.id);
  await page.locator('body').press('Control+Shift+g');
  await sleep(200);
  c = await cfg();
  check('Cmd/Ctrl+Shift+G ungroups (contents move up)', !c.sections.some((s) => s.id === lvl3.id) && c.screens.find((s) => s.id === 'welcome').section === drawn.id);

  // Header: rename, colour with word label, lock, menu → grid.
  await fit([`section:${drawn.id}`], 0.5);
  await sleep(700);
  const head = page.locator(`.react-flow__node[data-id="section:${drawn.id}"] .fc-sec-head`);
  await page.screenshot({ path: path.join(outDir, '2a-section-head.png') });
  // Header controls may sit outside the viewport at this zoom: dispatch clicks.
  await head.getByRole('button', { name: /^Rename/ }).dispatchEvent('click');
  await page.getByLabel('Section name').fill('Welcome flow');
  await page.getByLabel('Section name').press('Enter');
  await head.getByLabel('Welcome flow colour').selectOption('blue');
  await sleep(200);
  c = await cfg();
  const sec = c.sections.find((s) => s.id === drawn.id);
  check('rename + colour (word label shown)', sec.title === 'Welcome flow' && sec.color === 'blue' && /Blue/.test(await head.innerText()));
  await head.getByRole('button', { name: 'Welcome flow menu' }).dispatchEvent('click');
  await page.getByRole('menuitem', { name: /grid/ }).dispatchEvent('click');
  await sleep(200);
  c = await cfg();
  const w = c.screens.find((s) => s.id === 'welcome').position;
  const p2 = c.screens.find((s) => s.id === 'pick-interests').position;
  check('auto-layout grid: 3 per row, 64 px gaps', p2.y === w.y && p2.x - w.x === 440 + 64, JSON.stringify({ w, p2 }));
  await head.getByRole('button', { name: 'Lock' }).dispatchEvent('click');
  check('lock: frames inside cannot be dragged', (await st(() => window.__fc.rf.getNode('welcome:default').draggable)) === false);
  await head.getByRole('button', { name: 'Locked' }).dispatchEvent('click');
  await fit([`section:${drawn.id}`], 0.4);
  await sleep(600);

  // Drag the section header: contents move with it.
  const before = (await cfg()).screens.find((s) => s.id === 'welcome').position;
  const hb = await head.boundingBox();
  await page.mouse.move(hb.x + hb.width * 0.55, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width * 0.55 + 60, hb.y + hb.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  await sleep(300);
  const after = (await cfg()).screens.find((s) => s.id === 'welcome').position;
  check('dragging a section moves its frames', after.x > before.x && after.y > before.y, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  const edgeOk = await st(() => window.__fc.rf.getEdges().some((e) => e.source === 'welcome:default'));
  check('edges stay attached', edgeOk);
  await page.screenshot({ path: path.join(outDir, '2-sections.png') });

  /* ---------------- images ---------------- */
  await fit(['catalog:default'], 0.5);
  await sleep(800);
  // A > 5 MB PNG: 3000×2000 noise (incompressible).
  const dropped = await page.evaluate(async () => {
    const cv = new OffscreenCanvas(3000, 2000);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(3000, 2000);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (Math.random() * 256) | 0;
    ctx.putImageData(img, 0, 0);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const file = new File([blob], 'figma-catalog.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector('.react-flow');
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 300, clientY: r.top + 200 }));
    return blob.size;
  });
  const img = await until(async () => (await cfg()).images.at(-1), 15000);
  check('dropped image is on the canvas and in the config', !!img, `${(dropped / 1e6).toFixed(1)} MB PNG`);
  check('over 5 MB: stored as WebP (2560 px long side)', /\.webp$/.test(img?.file ?? '') && img.rect.w === 960 && img.rect.h === 640, `${img?.file} ${img?.rect.w}×${img?.rect.h}`);
  const stored = await page.evaluate(async (file) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('flowcanvas-images');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const blob = await new Promise((res) => {
      const q = db.transaction('blobs').objectStore('blobs').get(file);
      q.onsuccess = () => res(q.result);
    });
    const bmp = await createImageBitmap(blob);
    return { type: blob.type, w: bmp.width, h: bmp.height, bytes: blob.size };
  }, img.file);
  check('IndexedDB holds the downscaled WebP blob', stored.type === 'image/webp' && stored.w === 2560 && stored.h === 1707, JSON.stringify(stored));
  // Panel: caption, ratio-locked width, crop, opacity, overlay.
  await st((id) => window.__fc.rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id }))), img.id);
  await st((id) => window.__fc.board.getState().set({ panel: 'image', imageId: id }), img.id);
  const panel = page.getByRole('complementary', { name: 'Image' });
  await panel.getByLabel('Caption').fill('Figma: Catalog v3');
  await panel.getByLabel('Caption').press('Enter');
  await panel.getByLabel('W', { exact: true }).fill('480');
  await panel.getByLabel('Left').fill('10');
  await panel.getByLabel('Opacity').fill('60');
  await sleep(200);
  let im = (await cfg()).images.find((i) => i.id === img.id);
  check('caption, ratio-locked resize, crop, opacity', im.caption === 'Figma: Catalog v3' && im.rect.w === 480 && im.rect.h === 320 && Math.abs(im.crop.x - 0.1) < 1e-9 && im.opacity === 0.6, JSON.stringify({ rect: im.rect, crop: im.crop, op: im.opacity }));
  await page.screenshot({ path: path.join(outDir, '3-image.png') });
  await panel.getByLabel('Overlay on frame').selectOption('catalog:default');
  await sleep(400);
  im = (await cfg()).images.find((i) => i.id === img.id);
  const ov = await st((id) => {
    const n = window.__fc.rf.getNode(id);
    const f = window.__fc.rf.getNode('catalog:default');
    return { dx: n.position.x - f.position.x, dy: n.position.y - f.position.y, w: n.width, h: n.height };
  }, img.id);
  check('overlay on frame: pinned over the frame screen at 50 %', im.overlay?.frame === 'catalog:default' && im.overlay.opacity === 0.5 && ov.dx === 0 && ov.dy === 80 && ov.w === 440 && ov.h === 956, JSON.stringify(ov));
  await fit(['catalog:default'], 0.55);
  await sleep(900);
  await page.screenshot({ path: path.join(outDir, '4-overlay.png') });

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  failed++;
  console.log('FAIL (exception)', e.stack ?? e);
} finally {
  await context.close();
  if (demo) {
    try {
      process.kill(-demo.pid);
    } catch {}
  }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
