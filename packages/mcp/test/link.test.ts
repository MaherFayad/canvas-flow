import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { errorText, FakeCanvas, harness, readConfigFile, until, type Harness } from './helpers.js';

// Own port range so this file never collides with a real server or other test files.
const PORTS: [number, number] = [48830, 48849];
const ORIGIN = 'chrome-extension://test';

let h: Harness | null = null;
const canvases: FakeCanvas[] = [];
afterEach(async () => {
  for (const c of canvases.splice(0)) await c.close();
  await h?.close();
  h = null;
});

async function linked(opts: { extensionId?: string; grant?: boolean } = {}) {
  h = await harness({ link: true, ports: PORTS, extensionId: opts.extensionId, canvasDebounceMs: 50 });
  const port = h.server.link!.port!;
  const canvas = await FakeCanvas.connect(port, opts.extensionId ? `chrome-extension://${opts.extensionId}` : ORIGIN);
  canvases.push(canvas);
  await canvas.handshake(opts.grant ?? true);
  await until(() => h!.server.link!.granted !== null);
  return { h, canvas, port };
}

describe('origin check', () => {
  it('binds 127.0.0.1 in the port range', async () => {
    h = await harness({ link: true, ports: PORTS });
    const port = h.server.link!.port!;
    expect(port).toBeGreaterThanOrEqual(PORTS[0]);
    expect(port).toBeLessThanOrEqual(PORTS[1]);
  });

  it('rejects http://evil.com and a missing Origin at the upgrade', async () => {
    h = await harness({ link: true, ports: PORTS });
    const port = h.server.link!.port!;
    await expect(FakeCanvas.connect(port, 'http://evil.com')).rejects.toThrow(/403/);
    await expect(FakeCanvas.connect(port, null)).rejects.toThrow(/403/);
    expect(h.server.link!.linked).toBe(false);
  });

  it('with --extension-id only that extension is accepted', async () => {
    h = await harness({ link: true, ports: PORTS, extensionId: 'abcdefghijklmnop' });
    const port = h.server.link!.port!;
    await expect(FakeCanvas.connect(port, ORIGIN)).rejects.toThrow(/403/);
    const ok = await FakeCanvas.connect(port, 'chrome-extension://abcdefghijklmnop');
    canvases.push(ok);
    const hello = await ok.waitFor('hello');
    expect(hello).toMatchObject({ v: 1, origin: 'http://localhost:3000', name: 'Helka ceramics', project: h.dir });
  });

  it('accepts one canvas at a time', async () => {
    const { port } = await linked();
    await expect(FakeCanvas.connect(port, ORIGIN)).rejects.toThrow(/409/);
  });
});

describe('linked canvas', () => {
  it('full sync after allow, then a patch per Claude change', async () => {
    const { h, canvas } = await linked();
    const cfg = await canvas.waitFor('config');
    expect(cfg.config.project.name).toBe('Helka ceramics');
    await h.call('add_screen', { title: 'Checkout', path: '/checkout' });
    const patch = await canvas.waitFor('patch');
    expect(patch.label).toBe('Claude: add screen checkout');
    expect(patch.config.screens.some((s) => s.id === 'checkout')).toBe(true);
    const act = await canvas.waitFor('activity', (a) => a.tool === 'add_screen');
    expect(act.ok).toBe(true);
  });

  it('request/response roundtrip for canvas-only tools', async () => {
    const { h, canvas } = await linked();
    canvas.handlers.get_tokens = () => ({ base: [{ name: '--color-bg', value: '#F4F1EA', type: 'color' }], overrides: {} });
    canvas.handlers.check_target = (p) => ({ found: p.selector === '[data-fc="clear-filters"]', rect: { x: 1, y: 2, w: 3, h: 4 }, count: 1 });
    canvas.handlers.get_selection = () => ({ ids: ['catalog', 'e1'] });
    canvas.handlers.focus = () => ({ ok: true });
    canvas.handlers.play_flow = () => ({ pass: false, steps: [{ edgeId: 'e1', ok: true }, { edgeId: 'e2', ok: false, error: 'target not found' }] });
    canvas.handlers.get_screenshot = () => ({ webp: 'data:image/webp;base64,' + Buffer.from('RIFFxxxxWEBP').toString('base64'), device: 'desktop' });

    const t = await h.call('get_tokens');
    expect(t.base[0].name).toBe('--color-bg');
    expect(t.overrides).toEqual({ '--color-bg': '#F4F1EA', '--radius-md': '12px' });
    const ct = await h.call('check_target', { screenId: 'catalog', state: 'empty', selector: '[data-fc="clear-filters"]' });
    expect(ct).toMatchObject({ found: true, rect: { x: 1, y: 2, w: 3, h: 4 }, frame: 'catalog:empty' });
    const sel = await h.call('get_selection');
    expect(sel.items.map((i: any) => i.type)).toEqual(['screen', 'edge']);
    expect(await h.call('focus', { itemId: 'catalog:empty' })).toMatchObject({ kind: 'frame' });
    const play = await h.call('play_flow', { sectionId: 'onboarding' });
    expect(play).toMatchObject({ pass: false, failed: [{ edgeId: 'e2', error: 'target not found' }] });
    const shot = await h.callRaw('get_screenshot', { screenId: 'catalog', state: 'default' });
    expect(shot.content[0]!.type).toBe('image');
    // canvas screenshots are cached for later
    const cached = await fs.readFile(path.join(h.dir, '.flowcanvas/cache/catalog-default-desktop.webp'), 'latin1');
    expect(cached).toBe('RIFFxxxxWEBP');

    const req = canvas.messages.find((m) => m.type === 'request' && m.method === 'check_target');
    expect(req).toMatchObject({ params: { screenId: 'catalog', state: 'empty', selector: '[data-fc="clear-filters"]' } });
  });

  it('a canvas error is a clear tool error', async () => {
    const { h } = await linked();
    const r = await h.callRaw('get_selection');
    expect(r.isError).toBe(true);
    expect(errorText(r)).toContain('no handler for get_selection');
  });

  it('canvas-only tools wait for Allow; denied blocks them', async () => {
    const { h } = await linked({ grant: false });
    const r = await h.callRaw('get_selection');
    expect(errorText(r)).toContain('denied');
    // file-backed tools still work
    expect((await h.callRaw('list_screens')).isError).toBeFalsy();
  });

  it('Pause Claude blocks every write tool, reads still work', async () => {
    const { h, canvas } = await linked();
    canvas.send({ type: 'pause', paused: true });
    await until(() => h.server.link!.paused);
    const before = await fs.readFile(path.join(h.dir, 'flowcanvas.config.json'), 'utf8');
    for (const [name, args] of [
      ['add_screen', { title: 'X', path: '/x' }],
      ['add_edge', { from: { screen: 'welcome' }, to: { screen: 'cart' } }],
      ['add_note', { text: 'hi' }],
      ['reply_comment', { threadId: 'c-3', text: 'hi' }],
      ['delete_items', { ids: ['e1'] }],
      ['set_tokens', { vars: { '--a': '1' } }],
    ] as const) {
      const r = await h.callRaw(name, args);
      expect(r.isError, name).toBe(true);
      expect(errorText(r)).toContain('paused');
    }
    expect(await fs.readFile(path.join(h.dir, 'flowcanvas.config.json'), 'utf8')).toBe(before);
    expect((await h.callRaw('get_project')).isError).toBeFalsy();
    canvas.send({ type: 'pause', paused: false });
    await until(() => !h.server.link!.paused);
    expect((await h.callRaw('add_note', { text: 'hi' })).isError).toBeFalsy();
  });

  it('delete_items asks the canvas; denied leaves the file untouched', async () => {
    const { h, canvas } = await linked();
    canvas.handlers.confirm = () => ({ allowed: false });
    const before = await fs.readFile(path.join(h.dir, 'flowcanvas.config.json'), 'utf8');
    const r = await h.callRaw('delete_items', { ids: ['e1'] });
    expect(errorText(r)).toContain('denied');
    expect(await fs.readFile(path.join(h.dir, 'flowcanvas.config.json'), 'utf8')).toBe(before);
    canvas.handlers.confirm = (p) => ({ allowed: p.action === 'delete' && p.ids.includes('e1') });
    expect((await h.call('delete_items', { ids: ['e1'] })).deleted).toBe(1);
  });

  it('set_tokens with more than 10 vars asks first; small changes do not', async () => {
    const { h, canvas } = await linked();
    let asked = 0;
    canvas.handlers.confirm = () => {
      asked++;
      return { allowed: true };
    };
    canvas.handlers.set_tokens = (p) => ({ applied: Object.keys(p.vars), unknown: ['--new'] });
    const r = await h.call('set_tokens', { vars: { '--color-bg': '#fff', '--radius-md': null, '--new': '1px' } });
    expect(asked).toBe(0);
    expect(r.overrides).toEqual({ '--color-bg': '#fff', '--new': '1px' });
    expect(r.notInApp).toEqual(['--new']);
    expect((await readConfigFile(h.dir)).tokens).toEqual({ '--color-bg': '#fff', '--new': '1px' });
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`--t-${i}`, `${i}px`]));
    await h.call('set_tokens', { vars: many });
    expect(asked).toBe(1);
    canvas.handlers.confirm = () => ({ allowed: false });
    expect(errorText(await h.callRaw('set_tokens', { vars: many }))).toContain('denied');
  });

  it('canvas config edits are validated and written (debounced)', async () => {
    const { h, canvas } = await linked();
    const cfg = structuredClone((await canvas.waitFor('config')).config);
    cfg.screens[0]!.title = 'Hello';
    canvas.send({ type: 'config', config: cfg });
    cfg.screens[0]!.title = 'Hello again';
    canvas.send({ type: 'config', config: cfg });
    await until(async () => (await readConfigFile(h.dir)).screens[0].title === 'Hello again');
    // canvas edits are not echoed back as patches
    expect(canvas.messages.filter((m) => m.type === 'patch')).toHaveLength(0);

    const before = await fs.readFile(path.join(h.dir, 'flowcanvas.config.json'), 'utf8');
    const bad = structuredClone(cfg);
    bad.edges.push({ ...bad.edges[0]!, id: 'bad', to: { screen: 'ghost', state: 'default' } });
    canvas.send({ type: 'config', config: bad });
    const err = await canvas.waitFor('error');
    expect(err.errors?.join()).toContain('ghost');
    expect(await fs.readFile(path.join(h.dir, 'flowcanvas.config.json'), 'utf8')).toBe(before);
  });
});

describe('outside edits', () => {
  it('re-reads the file, syncs the canvas and notifies about For Claude comments', async () => {
    const { h, canvas } = await linked();
    const updates: string[] = [];
    h.client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      updates.push(n.params.uri);
    });
    await h.client.subscribeResource({ uri: 'flowcanvas://comments?status=open&to=claude' });

    const file = await readConfigFile(h.dir);
    file.comments.push({
      id: 'c-9',
      status: 'open',
      to: 'claude',
      anchor: { frame: 'cart:empty', x: 0.5, y: 0.5, element: null },
      thread: [{ author: 'maher', text: '@claude add an empty-state illustration', at: '2026-11-01T11:00:00Z' }],
    });
    // like Claude Code editing the JSON directly
    await fs.writeFile(path.join(h.dir, 'flowcanvas.config.json'), JSON.stringify(file, null, 2));

    await until(() => updates.includes('flowcanvas://comments'), 8000);
    expect(updates).toContain('flowcanvas://comments?status=open&to=claude');
    const list = await h.call('list_comments', { status: 'open', to: 'claude' });
    expect(list.comments.map((c: any) => c.id)).toEqual(['c-3', 'c-9']);
    const sync = await canvas.waitFor('config', (m) => m.config.comments.some((c) => c.id === 'c-9'), 8000);
    expect(sync).toBeTruthy();
  });

  it('a Claude reply also triggers the comments notification', async () => {
    h = await harness();
    const updates: string[] = [];
    h.client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      updates.push(n.params.uri);
    });
    await h.call('add_note', { text: 'unrelated' });
    await new Promise((r) => setTimeout(r, 50));
    expect(updates).toEqual([]);
    await h.call('reply_comment', { threadId: 'c-4', text: 'noted' });
    await until(() => updates.includes('flowcanvas://comments'));
  });

  it('an invalid outside edit blocks tools with a clear error until fixed', async () => {
    h = await harness();
    const p = path.join(h.dir, 'flowcanvas.config.json');
    const good = await fs.readFile(p, 'utf8');
    await fs.writeFile(p, '{ "version": 1, ');
    await until(async () => (await h!.callRaw('get_project')).isError === true, 8000);
    expect(errorText(await h.callRaw('add_note', { text: 'x' }))).toContain('invalid');
    expect(await fs.readFile(p, 'utf8')).toBe('{ "version": 1, ');
    await fs.writeFile(p, good);
    await until(async () => !(await h!.callRaw('get_project')).isError, 8000);
  });

  it('does not treat its own writes as outside edits', async () => {
    h = await harness();
    let external = 0;
    h.server.store.on('change', (c) => {
      if (c.source === 'external') external++;
    });
    await h.call('add_note', { text: 'a' });
    await h.call('add_note', { text: 'b' });
    await new Promise((r) => setTimeout(r, 400));
    expect(external).toBe(0);
  });
});
