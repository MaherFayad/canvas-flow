import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '@flowcanvas/config';
import { errorText, harness, readConfigFile, type Harness } from './helpers.js';

// 2×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEIGGEMAB4ZA/0Oj4HGAAAAAElFTkSuQmCC',
  'base64',
);

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const fileText = () => fs.readFile(path.join(h.dir, 'flowcanvas.config.json'), 'utf8');

describe('tool registry', () => {
  it('registers every tool from the plan', async () => {
    const { tools } = await h.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'get_project', 'list_screens', 'add_screen', 'update_screen', 'add_state', 'list_edges', 'add_edge', 'update_edge',
        'delete_items', 'create_section', 'update_section', 'add_image', 'list_images', 'add_note', 'update_note', 'list_notes',
        'list_comments', 'reply_comment', 'resolve_comment', 'get_tokens', 'set_tokens', 'get_screenshot', 'check_target',
        'play_flow', 'focus', 'get_selection', 'scan_routes', 'add_screens', 'list_requests', 'complete_request',
      ].sort(),
    );
    for (const t of tools) expect(t.description!.length).toBeGreaterThan(40);
  });
});

describe('read tools', () => {
  it('get_project summarizes the fixture (with groups migrated to sections)', async () => {
    const p = await h.call('get_project');
    expect(p.name).toBe('Helka ceramics');
    expect(p.origin).toBe('http://localhost:3000');
    expect(p.configExists).toBe(true);
    expect(p.sections.map((s: any) => s.id).sort()).toEqual(['checkout', 'onboarding']);
    expect(p.screens.find((s: any) => s.id === 'catalog').section).toBe('onboarding');
    expect(p.counts).toMatchObject({ screens: 4, edges: 2, images: 1, notes: 2, comments: 3, openComments: 2, openForClaude: 1 });
    expect(p.canvas.linked).toBe(false);
  });

  it('list_screens filters by section', async () => {
    const all = await h.call('list_screens');
    expect(all.screens).toHaveLength(4);
    const co = await h.call('list_screens', { section: 'checkout' });
    expect(co.screens.map((s: any) => s.id)).toEqual(['cart']);
    const r = await h.callRaw('list_screens', { section: 'nope' });
    expect(r.isError).toBe(true);
  });

  it('list_edges filters by screen', async () => {
    expect((await h.call('list_edges')).edges).toHaveLength(2);
    expect((await h.call('list_edges', { screenId: 'welcome' })).edges.map((e: any) => e.id)).toEqual(['e1']);
  });

  it('list_images, list_notes, list_comments', async () => {
    const imgs = await h.call('list_images', { section: 'onboarding' });
    expect(imgs.images[0]).toMatchObject({ id: 'img-7f2a', resource: 'flowcanvas://images/img-7f2a' });
    const notes = await h.call('list_notes', { kind: 'decision' });
    expect(notes.notes).toHaveLength(1);
    expect(notes.notes[0].attachedTo).toMatchObject({ type: 'edge', id: 'e1', exists: true });
    expect(notes.notes[0].attachedTo.title).toContain('Get started');
    expect((await h.call('list_notes', { section: 'checkout' })).notes.map((n: any) => n.id)).toEqual(['n-13']);
    const forClaude = await h.call('list_comments', { status: 'open', to: 'claude' });
    expect(forClaude.comments.map((c: any) => c.id)).toEqual(['c-3']);
    expect(forClaude.comments[0].anchor.element.selector).toBe('[data-fc="clear-filters"]');
    expect(forClaude.comments[0].screen).toMatchObject({ id: 'catalog', state: 'empty', path: '/catalog' });
    expect((await h.call('list_comments', { status: 'resolved' })).comments.map((c: any) => c.id)).toEqual(['c-5']);
  });
});

describe('write tools', () => {
  it('add_screen writes the file, validates and returns the screen', async () => {
    const r = await h.call('add_screen', { title: 'Product Detail', path: '/product/1', section: 'onboarding', states: ['default', 'error'] });
    expect(r.id).toBe('product-detail');
    expect(r.screen).toMatchObject({ id: 'product-detail', section: 'onboarding', states: ['default', 'error'] });
    const file = await readConfigFile(h.dir);
    expect(file.screens.find((s: any) => s.id === 'product-detail')).toBeTruthy();
    // migrated on first write
    expect(file.groups).toBeUndefined();
    expect(parseConfig(file).ok).toBe(true);
    const dup = await h.callRaw('add_screen', { title: 'Product detail', path: '/x' });
    expect(dup.isError).toBe(true);
    expect(errorText(dup)).toContain('already exists');
  });

  it('update_screen changes fields and refuses to drop states used by edges', async () => {
    const r = await h.call('update_screen', { id: 'cart', title: 'Basket', states: ['default', 'empty', 'error'], section: null });
    expect(r.screen).toMatchObject({ title: 'Basket', section: null, states: ['default', 'empty', 'error'] });
    expect((await readConfigFile(h.dir)).screens.find((s: any) => s.id === 'cart').title).toBe('Basket');
    const bad = await h.callRaw('update_screen', { id: 'pick-interests', states: ['missing'] });
    expect(bad.isError).toBe(true);
    expect(errorText(bad)).toContain('edges use them');
  });

  it('add_state appends a state and its mocks', async () => {
    const r = await h.call('add_state', {
      screenId: 'cart',
      name: 'error',
      mocks: [{ match: { method: 'GET', url: '/api/cart*' }, status: 500, body: { error: 'x' } }],
    });
    expect(r).toMatchObject({ id: 'cart:error', frame: 'cart:error', created: true });
    const file = await readConfigFile(h.dir);
    expect(file.screens.find((s: any) => s.id === 'cart').states).toContain('error');
    expect(file.mocks['cart:error'][0].status).toBe(500);
    expect((await h.callRaw('add_state', { screenId: 'cart', name: 'error' })).isError).toBe(true);
  });

  it('add_edge and update_edge', async () => {
    const r = await h.call('add_edge', {
      from: { screen: 'catalog', state: 'empty' },
      to: { screen: 'catalog' },
      trigger: { label: 'Clear filters', target: '[data-fc="clear-filters"]' },
      transition: { type: 'fade', easing: 'sheet' },
      kind: 'alternate',
    });
    expect(r.id).toMatch(/^e-/);
    expect(r.edge).toMatchObject({
      to: { screen: 'catalog', state: 'default' },
      trigger: { label: 'Clear filters', gesture: 'tap' },
      transition: { type: 'fade', duration: 240, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      kind: 'alternate',
    });
    const u = await h.call('update_edge', { id: r.id, trigger: { hint: 'Tap to reset' }, transition: { duration: 300 } });
    expect(u.edge.trigger).toMatchObject({ label: 'Clear filters', hint: 'Tap to reset' });
    expect(u.edge.transition.duration).toBe(300);
    const file = await readConfigFile(h.dir);
    expect(file.edges.find((e: any) => e.id === r.id).transition.duration).toBe(300);
  });

  it('rejects an edge to an unknown screen and leaves the file untouched', async () => {
    const before = await fileText();
    const stat = await fs.stat(path.join(h.dir, 'flowcanvas.config.json'));
    const r = await h.callRaw('add_edge', { from: { screen: 'welcome' }, to: { screen: 'ghost' } });
    expect(r.isError).toBe(true);
    expect(errorText(r)).toContain('unknown screen "ghost"');
    expect(await fileText()).toBe(before);
    expect((await fs.stat(path.join(h.dir, 'flowcanvas.config.json'))).mtimeMs).toBe(stat.mtimeMs);
    const r2 = await h.callRaw('add_edge', { from: { screen: 'welcome', state: 'nope' }, to: { screen: 'cart' } });
    expect(errorText(r2)).toContain('no state "nope"');
    expect(await fileText()).toBe(before);
  });

  it('schema-level rejection (parseConfig) also leaves the file untouched', async () => {
    const before = await fileText();
    // Unknown section passes the tool checks only through update_note → schema refs are checked in parseConfig for screens
    const r = await h.callRaw('add_screen', { title: 'Bad', path: '/bad', id: 'Not Kebab' });
    expect(r.isError).toBe(true);
    expect(errorText(r)).toContain('kebab-case');
    expect(await fileText()).toBe(before);
  });

  it('create_section and update_section move items and nest', async () => {
    const r = await h.call('create_section', { name: 'Browse & save', itemIds: ['catalog', 'img-7f2a'], layout: 'grid', color: 'green' });
    expect(r.id).toBe('browse-save');
    expect(r.moved).toEqual(['catalog', 'img-7f2a']);
    let file = await readConfigFile(h.dir);
    expect(file.screens.find((s: any) => s.id === 'catalog').section).toBe('browse-save');
    expect(file.images[0].section).toBe('browse-save');
    const u = await h.call('update_section', { id: 'browse-save', name: 'Browse', parent: 'onboarding', removeItemIds: ['img-7f2a'] });
    expect(u.section).toMatchObject({ title: 'Browse', parent: 'onboarding' });
    file = await readConfigFile(h.dir);
    expect(file.images[0].section).toBe('onboarding');
    const loop = await h.callRaw('update_section', { id: 'onboarding', parent: 'browse-save' });
    expect(loop.isError).toBe(true);
    const edgeIn = await h.callRaw('create_section', { name: 'X', itemIds: ['e1'] });
    expect(errorText(edgeIn)).toContain('only screens');
  });

  it('add_note and update_note', async () => {
    const r = await h.call('add_note', { text: 'Retry goes back to Cart.', kind: 'decision', attachTo: { type: 'frame', id: 'catalog:error' } });
    expect(r.note).toMatchObject({ author: 'claude', kind: 'decision', section: 'onboarding', rect: { x: 960, y: -20, w: 220, h: 120 } });
    const u = await h.call('update_note', { id: r.id, text: 'Retry reloads Catalog.', attachTo: null });
    expect(u.note).toMatchObject({ text: 'Retry reloads Catalog.', attachTo: null });
    const file = await readConfigFile(h.dir);
    expect(file.notes.find((n: any) => n.id === r.id).text).toBe('Retry reloads Catalog.');
    expect((await h.callRaw('add_note', { text: 'x', attachTo: { type: 'edge', id: 'nope' } })).isError).toBe(true);
  });

  it('reply_comment appends a claude message; resolve_comment resolves', async () => {
    const r = await h.call('reply_comment', { threadId: 'c-3', text: 'Done: added edge e9.', changes: ['e9'] });
    const last = r.thread.thread.at(-1);
    expect(last).toMatchObject({ author: 'claude', text: 'Done: added edge e9.', changes: ['e9'] });
    expect(new Date(last.at).toString()).not.toBe('Invalid Date');
    const res = await h.call('resolve_comment', { threadId: 'c-3' });
    expect(res.thread.status).toBe('resolved');
    const file = await readConfigFile(h.dir);
    const c3 = file.comments.find((c: any) => c.id === 'c-3');
    expect(c3.status).toBe('resolved');
    expect(c3.thread).toHaveLength(2);
    const reopen = await h.call('resolve_comment', { threadId: 'c-3', reopen: true, text: 'Reopening.' });
    expect(reopen.thread.status).toBe('open');
  });

  it('delete_items cascades without a canvas', async () => {
    const r = await h.call('delete_items', { ids: ['pick-interests', 'n-13', 'checkout', 'ghost'] });
    expect(r.deleted).toBe(3);
    expect(r.notFound).toEqual(['ghost']);
    expect(r.cascaded.edges.sort()).toEqual(['e1', 'e2']);
    const file = await readConfigFile(h.dir);
    expect(file.screens.map((s: any) => s.id)).not.toContain('pick-interests');
    expect(file.edges).toHaveLength(0);
    expect(file.sections.map((s: any) => s.id)).toEqual(['onboarding']);
    expect(file.screens.find((s: any) => s.id === 'cart').section).toBeNull();
    // note n-12 was attached to edge e1, which is gone
    expect(file.notes.find((n: any) => n.id === 'n-12').attachTo).toBeNull();
    expect(parseConfig(file).ok).toBe(true);
  });

  it('add_image copies a local file into hashed assets and dedupes', async () => {
    const src = path.join(h.dir, 'figma.png');
    await fs.writeFile(src, PNG);
    const r = await h.call('add_image', { path: 'figma.png', x: 10, y: 20, caption: 'Figma: Cart', overlayOn: 'cart', section: 'checkout' });
    expect(r.image.file).toMatch(/^\.flowcanvas\/assets\/[0-9a-f]{12}\.png$/);
    expect(r.image).toMatchObject({ rect: { x: 10, y: 20, w: 2, h: 1 }, overlay: { frame: 'cart:default', opacity: 0.5 }, section: 'checkout' });
    expect(await fs.readFile(path.join(h.dir, r.image.file))).toEqual(PNG);
    const r2 = await h.call('add_image', { path: src, x: 0, y: 0, w: 100 });
    expect(r2.image.file).toBe(r.image.file);
    expect(r2.stored.newFile).toBe(false);
    expect(r2.image.rect).toMatchObject({ w: 100, h: 50 });
    const file = await readConfigFile(h.dir);
    expect(file.images.filter((i: any) => i.file === r.image.file)).toHaveLength(2);
    expect((await fs.readdir(path.join(h.dir, '.flowcanvas/assets')))).toHaveLength(1);
    // not an image
    await fs.writeFile(path.join(h.dir, 'x.txt'), 'hello');
    expect(errorText(await h.callRaw('add_image', { path: 'x.txt', x: 0, y: 0 }))).toContain('Not a supported image');
  });

  it('add_image downloads a URL', async () => {
    const srv = http.createServer((_q, s) => {
      s.writeHead(200, { 'content-type': 'image/png' });
      s.end(PNG);
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
      const url = `http://127.0.0.1:${port}/shot.png`;
      const r = await h.call('add_image', { url, x: 0, y: 0 });
      expect(r.image).toMatchObject({ url });
      expect(r.image.file).toMatch(/\.png$/);
    } finally {
      srv.close();
    }
  });

  it('creates a valid config on first write when none exists', async () => {
    const h2 = await harness({ fixture: false, origin: 'http://localhost:4000' });
    try {
      const p = await h2.call('get_project');
      expect(p.configExists).toBe(false);
      expect(p.origin).toBe('http://localhost:4000');
      await h2.call('add_screen', { title: 'Home', path: '/' });
      const file = await readConfigFile(h2.dir);
      expect(file.project.origin).toBe('http://localhost:4000');
      expect(file.screens[0].id).toBe('home');
      expect(parseConfig(file).ok).toBe(true);
    } finally {
      await h2.close();
    }
  });
});

describe('canvas-only tools without a canvas', () => {
  it.each([
    ['get_tokens', {}],
    ['set_tokens', { vars: { '--color-bg': '#fff' } }],
    ['check_target', { screenId: 'catalog', state: 'default', selector: 'button' }],
    ['play_flow', { edgeIds: ['e1'] }],
    ['focus', { itemId: 'catalog' }],
    ['get_selection', {}],
    ['get_screenshot', { screenId: 'catalog', state: 'empty' }],
  ])('%s errors with "Open the Flow Canvas tab"', async (name, args) => {
    const r = await h.callRaw(name, args);
    expect(r.isError).toBe(true);
    expect(errorText(r)).toContain('Open the Flow Canvas tab for http://localhost:3000');
  });

  it('get_screenshot falls back to a cached still', async () => {
    const cache = path.join(h.dir, '.flowcanvas/cache');
    await fs.mkdir(cache, { recursive: true });
    const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 fake', 'latin1');
    await fs.writeFile(path.join(cache, 'catalog-empty-iphone-16-pro-max.webp'), webp);
    const r = await h.callRaw('get_screenshot', { screenId: 'catalog', state: 'empty' });
    expect(r.isError).toBeFalsy();
    const img = r.content.find((c) => c.type === 'image');
    expect(img && img.type === 'image' && Buffer.from(img.data, 'base64').equals(webp)).toBe(true);
    const meta = JSON.parse((r.content.find((c) => c.type === 'text') as { text: string }).text);
    expect(meta).toMatchObject({ source: 'cache', device: 'iphone-16-pro-max' });
  });
});

describe('resources', () => {
  it('lists and reads project, comments (filtered), notes and images', async () => {
    const { resources } = await h.client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toEqual(expect.arrayContaining([
      'flowcanvas://project',
      'flowcanvas://comments',
      'flowcanvas://comments?status=open&to=claude',
      'flowcanvas://notes',
      'flowcanvas://screens/catalog/empty/screenshot',
      'flowcanvas://images/img-7f2a',
    ]));
    const proj = await h.client.readResource({ uri: 'flowcanvas://project' });
    expect(JSON.parse((proj.contents[0] as { text: string }).text).project.name).toBe('Helka ceramics');
    const read = async (uri: string) => JSON.parse(((await h.client.readResource({ uri })).contents[0] as { text: string }).text);
    expect((await read('flowcanvas://comments')).comments).toHaveLength(3);
    expect((await read('flowcanvas://comments?status=open&to=claude')).comments.map((c: any) => c.id)).toEqual(['c-3']);
    expect((await read('flowcanvas://comments?to=claude')).comments.map((c: any) => c.id)).toEqual(['c-3', 'c-5']);
    expect((await read('flowcanvas://comments?status=open')).comments).toHaveLength(2);
    expect((await read('flowcanvas://notes')).notes).toHaveLength(2);
  });

  it('reads an image resource as a blob', async () => {
    await fs.writeFile(path.join(h.dir, 'a.png'), PNG);
    const { id } = await h.call('add_image', { path: 'a.png', x: 0, y: 0 });
    const r = await h.client.readResource({ uri: `flowcanvas://images/${id}` });
    const c = r.contents[0] as { blob: string; mimeType: string };
    expect(c.mimeType).toBe('image/png');
    expect(Buffer.from(c.blob, 'base64')).toEqual(PNG);
  });
});
