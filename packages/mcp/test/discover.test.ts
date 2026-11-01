import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { errorText, FakeCanvas, harness, readConfigFile, until, type Harness } from './helpers.js';

// Own port range so this file never collides with other test files.
const PORTS: [number, number] = [48890, 48899];
const DEMO = fileURLToPath(new URL('../../../apps/demo', import.meta.url));

let h: Harness | null = null;
const canvases: FakeCanvas[] = [];
afterEach(async () => {
  for (const c of canvases.splice(0)) await c.close();
  await h?.close();
  h = null;
});

const DEMO_SCREENS = [
  { id: 'welcome', title: 'Welcome', path: '/', section: 'Onboarding', states: ['default', 'loading', 'error'] },
  { id: 'product', title: 'Product', path: '/product/canele-dinner-plate', route: '/product/:id', section: 'Browse', states: ['default', 'loading', 'error'] },
  { id: 'class', title: 'Class', path: '/classes/glaze-lab', route: '/classes/:id', section: 'classes' },
];

describe('add_screens', () => {
  it('adds many screens in one write, creates sections, marks source claude, no positions', async () => {
    h = await harness();
    const writes: string[] = [];
    h.server.store.on('change', (ch: { label: string }) => writes.push(ch.label));
    const r = await h.call('add_screens', { screens: DEMO_SCREENS });
    expect(writes).toEqual(['discovered 2 screens']);
    // "welcome" already exists in the fixture at "/" → skipped in add mode.
    expect(r.skipped).toEqual([expect.objectContaining({ id: 'welcome', reason: expect.stringMatching(/already on the canvas as "welcome" \(same id\)/) })]);
    expect(r.added.map((s: { id: string }) => s.id)).toEqual(['product', 'class']);
    expect(r.sectionsCreated.map((s: { id: string; title: string }) => [s.id, s.title])).toEqual([
      ['browse', 'Browse'],
      ['classes', 'Classes'],
    ]);
    const file = await readConfigFile(h.dir);
    const product = file.screens.find((s: { id: string }) => s.id === 'product');
    expect(product).toEqual({ id: 'product', title: 'Product', section: 'browse', path: '/product/canele-dinner-plate', route: '/product/:id', source: 'claude', states: ['default', 'loading', 'error'] });
    expect(product.position).toBeUndefined();
    expect(file.screens.find((s: { id: string }) => s.id === 'class')).toMatchObject({ section: 'classes', states: ['default'], route: '/classes/:id' });
    // An existing section is matched by title (case-insensitive), not duplicated.
    const again = await h.call('add_screens', { screens: [{ title: 'Pick plan', path: '/plan', section: 'onboarding' }] });
    expect(again.sectionsCreated).toEqual([]);
    expect(again.added[0]).toMatchObject({ id: 'pick-plan', section: 'onboarding' });
  });

  it('validates the whole batch first: concrete paths, route match, duplicates; nothing is written on error', async () => {
    h = await harness();
    const before = await fs.readFile(path.join(h.dir, 'flowcanvas.config.json'), 'utf8');
    const r = await h.callRaw('add_screens', {
      screens: [
        { title: 'Ok', path: '/ok' },
        { title: 'Pattern', path: '/product/:id', route: '/product/:id' },
        { title: 'Mismatch', path: '/item/7', route: '/product/:id' },
        { id: 'dup', title: 'Dup 1', path: '/a' },
        { id: 'dup', title: 'Dup 2', path: '/b' },
        { title: 'Same path', path: '/ok' },
      ],
    });
    expect(r.isError).toBe(true);
    const t = errorText(r);
    expect(t).toMatch(/nothing was written/);
    expect(t).toMatch(/path "\/product\/:id" is a pattern/);
    expect(t).toMatch(/does not match route "\/product\/:id"/);
    expect(t).toMatch(/id "dup" is used twice/);
    expect(t).toMatch(/path "\/ok" is used twice/);
    expect(await fs.readFile(path.join(h.dir, 'flowcanvas.config.json'), 'utf8')).toBe(before);
    // Zod checks too (kebab ids).
    const bad = await h.callRaw('add_screens', { screens: [{ id: 'Not Kebab', title: 'x', path: '/x' }] });
    expect(bad.isError).toBe(true);
  });

  it('merge mode updates existing screens by route or path and appends states', async () => {
    h = await harness();
    await h.call('add_screens', { screens: [{ title: 'Product', path: '/product/a', route: '/product/:id', states: ['default', 'loading'] }] });
    const skip = await h.call('add_screens', { screens: [{ title: 'Product page', path: '/product/b', route: '/product/:id' }] });
    expect(skip.added).toEqual([]);
    expect(skip.skipped[0].reason).toMatch(/same route/);
    expect(skip.note).toMatch(/Nothing changed/);
    const m = await h.call('add_screens', {
      mode: 'merge',
      screens: [
        { title: 'Product page', path: '/product/b', route: '/product/:id', states: ['error', 'default'], section: 'Browse' },
        { title: 'Catalog', path: '/catalog', states: ['default', 'empty', 'filters-open'] },
      ],
    });
    expect(m.updated).toEqual([
      { id: 'product', changes: ['title', 'path', 'section', 'states'] },
      { id: 'catalog', changes: ['states'] },
    ]);
    const file = await readConfigFile(h.dir);
    expect(file.screens.find((s: { id: string }) => s.id === 'product')).toMatchObject({ title: 'Product page', path: '/product/b', states: ['default', 'loading', 'error'], section: 'browse' });
    expect(file.screens.find((s: { id: string }) => s.id === 'catalog').states).toEqual(['default', 'loading', 'empty', 'partial', 'error', 'filters-open']);
  });

  it('is blocked while Claude is paused', async () => {
    h = await harness({ link: true, ports: PORTS });
    const canvas = await FakeCanvas.connect(h.server.link!.port!, 'chrome-extension://test');
    canvases.push(canvas);
    await canvas.handshake();
    canvas.send({ type: 'pause', paused: true });
    await until(() => h!.server.link!.paused);
    const r = await h.callRaw('add_screens', { screens: [{ title: 'X', path: '/x' }] });
    expect(r.isError).toBe(true);
    expect(errorText(r)).toMatch(/paused/i);
  });
});

describe('scan_routes tool', () => {
  it('scans a folder relative to the project or absolute', async () => {
    h = await harness();
    const r = await h.call('scan_routes', { dir: DEMO });
    expect(r.routes).toHaveLength(12);
    expect(r.summary).toMatch(/^12 routes \(4 dynamic\)/);
    const rel = await h.call('scan_routes', { dir: path.relative(h.dir, DEMO) });
    expect(rel.routes).toHaveLength(12);
    const missing = await h.callRaw('scan_routes', { dir: '/definitely/not/here' });
    expect(missing.isError).toBe(true);
  });
});

describe('discover prompt and resources', () => {
  it('registers the discover_screens prompt and the recipe + requests resources', async () => {
    h = await harness({ fixture: false });
    const { prompts } = await h.client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['discover_screens']);
    expect(prompts[0]!.arguments?.map((a) => a.name)).toEqual(['dir', 'focus']);
    const p = await h.client.getPrompt({ name: 'discover_screens', arguments: { dir: 'apps/web' } });
    const text = (p.messages[0]!.content as { text: string }).text;
    expect(text).toMatch(/Call `scan_routes` \{ dir: "apps\/web" \}/);
    expect(text).toMatch(/add_screens/);
    expect(text).toMatch(/add_note/);
    const { resources } = await h.client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('flowcanvas://recipes/discover');
    expect(uris).toContain('flowcanvas://requests');
    const recipe = await h.client.readResource({ uri: 'flowcanvas://recipes/discover' });
    expect((recipe.contents[0] as { text: string }).text).toMatch(/# Discover screens with Flow Canvas/);
    const tools = (await h.client.listTools()).tools.map((t) => t.name);
    for (const t of ['scan_routes', 'add_screens', 'list_requests', 'complete_request']) expect(tools).toContain(t);
  });

  it('get_project points to the prompt when there are no screens', async () => {
    h = await harness({ fixture: false });
    const p = await h.call('get_project');
    expect(p.hint).toMatch(/No screens yet: run the discover_screens prompt/);
    await h.call('add_screens', { screens: [{ title: 'Home', path: '/' }] });
    expect((await h.call('get_project')).hint).toBeUndefined();
  });
});

describe('discover-request round trip (fake canvas)', () => {
  it('canvas request → pending request + resource update → list_requests → complete_request → request-done', async () => {
    h = await harness({ link: true, ports: PORTS, fixture: false });
    const updates: string[] = [];
    h.client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      updates.push(n.params.uri);
    });
    const canvas = await FakeCanvas.connect(h.server.link!.port!, 'chrome-extension://test');
    canvases.push(canvas);
    await canvas.handshake();

    canvas.send({ type: 'discover-request', id: 'c1' });
    const ack = await canvas.waitFor('request-ack', (m) => m.id === 'c1');
    expect(ack).toMatchObject({ ok: true, created: true });
    const requestId = ack.requestId!;
    await until(() => updates.includes('flowcanvas://requests'));

    // Clicking twice asks once.
    canvas.send({ type: 'discover-request', id: 'c2' });
    expect(await canvas.waitFor('request-ack', (m) => m.id === 'c2')).toMatchObject({ ok: true, created: false, requestId });

    const listed = await h.call('list_requests');
    expect(listed.requests).toEqual([expect.objectContaining({ id: requestId, kind: 'discover', status: 'pending', prompt: 'discover_screens' })]);
    const res = await h.client.readResource({ uri: 'flowcanvas://requests' });
    expect(JSON.parse((res.contents[0] as { text: string }).text).requests[0].id).toBe(requestId);
    const proj = await h.call('get_project');
    expect(proj.pendingRequests.map((r: { id: string }) => r.id)).toEqual([requestId]);
    // The prompt names the request to complete.
    const p = await h.client.getPrompt({ name: 'discover_screens', arguments: {} });
    expect((p.messages[0]!.content as { text: string }).text).toContain(`complete_request\` { id: "${requestId}"`);

    const done = await h.call('complete_request', { id: requestId, summary: 'Added 12 screens in 4 sections.' });
    expect(done.request).toMatchObject({ status: 'done', summary: 'Added 12 screens in 4 sections.' });
    const msg = await canvas.waitFor('request-done');
    expect(msg).toEqual({ type: 'request-done', requestId, kind: 'discover', summary: 'Added 12 screens in 4 sections.' });
    expect((await h.call('list_requests')).requests).toEqual([]);
    expect((await h.call('list_requests', { status: 'all' })).requests).toHaveLength(1);
    const unknown = await h.callRaw('complete_request', { id: 'req-nope' });
    expect(unknown.isError).toBe(true);
  });

  it('a request before Allow is refused', async () => {
    h = await harness({ link: true, ports: PORTS, fixture: false });
    const canvas = await FakeCanvas.connect(h.server.link!.port!, 'chrome-extension://test');
    canvases.push(canvas);
    await canvas.waitFor('hello');
    canvas.send({ type: 'hello', v: 1, extensionVersion: 't' });
    canvas.send({ type: 'discover-request', id: 'early' });
    expect(await canvas.waitFor('request-ack', (m) => m.id === 'early')).toMatchObject({ ok: false });
    expect(h.server.requests.list()).toEqual([]);
  });

  it('add_screens reaches the canvas as ONE patch labelled "Claude: discovered N screens"', async () => {
    h = await harness({ link: true, ports: PORTS, fixture: false });
    const canvas = await FakeCanvas.connect(h.server.link!.port!, 'chrome-extension://test');
    canvases.push(canvas);
    await canvas.handshake();
    const before = canvas.messages.length;
    await h.call('add_screens', { screens: DEMO_SCREENS });
    await canvas.waitFor('patch');
    const patches = canvas.messages.slice(before).filter((m) => m.type === 'patch');
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ label: 'Claude: discovered 3 screens' });
  });
});
