/**
 * Link client against the REAL MCP server (packages/mcp, in-process): handshake,
 * Allow prompt, full sync, Claude patches, canvas edits written to the file,
 * canvas requests, Pause Claude, image assets, origin mismatch, reconnect.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeLinkClient, onRequestDone, type ActivityRow, type AllowStore, type LinkPhase, type SocketFactory } from './mcpLink';

// Loaded at runtime only (Node code; kept out of the extension's type program).
const HELPERS = new URL('../../../../packages/mcp/test/helpers.ts', import.meta.url).pathname;
const WS = 'ws';

const PORTS: [number, number] = [48870, 48879];
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const APP = 'http://localhost:3000'; // the fixture project's origin

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

async function setup(opts: { origin?: string; allow?: boolean | null; harness?: Any } = {}) {
  const helpers: Any = await import(/* @vite-ignore */ HELPERS);
  const { default: WebSocket }: Any = await import(/* @vite-ignore */ WS);
  const h = opts.harness ?? (await helpers.harness({ link: true, ports: PORTS, canvasDebounceMs: 30 }));
  if (!opts.harness) cleanup.push(() => h.close());
  const socket: SocketFactory = (url) => new WebSocket(url, { origin: EXT_ORIGIN });
  const remembered = new Map<string, boolean>();
  if (opts.allow !== undefined && opts.allow !== null) remembered.set(opts.origin ?? APP, opts.allow);
  const allowStore: AllowStore = {
    get: async (o) => remembered.get(o) ?? null,
    set: async (o, v) => void remembered.set(o, v),
  };
  const log = {
    phases: [] as LinkPhase[],
    asked: [] as string[],
    configs: [] as Any[],
    patches: [] as Array<{ label: string; config: Any }>,
    activity: [] as ActivityRow[],
    errors: [] as string[],
  };
  const client = new ClaudeLinkClient({
    origin: opts.origin ?? APP,
    extensionVersion: '0.1.0-test',
    socket,
    ports: PORTS,
    scanMs: 100,
    debounceMs: 30,
    allowStore,
    handlers: {
      status: (s) => log.phases.push(s.phase),
      askAllow: async (name) => (log.asked.push(name), true),
      config: (c) => log.configs.push(c),
      patch: (label, config) => log.patches.push({ label, config }),
      activity: (a) => log.activity.push(a),
      error: (m) => log.errors.push(m),
      request: async (method, params) => {
        if (method === 'get_selection') return { ids: ['catalog'], items: [{ id: 'catalog', type: 'screen' }] };
        if (method === 'focus') return { ok: params.itemId === 'catalog' };
        if (method === 'confirm') return { allowed: true };
        throw new Error(`no ${method} in this test`);
      },
    },
  });
  cleanup.push(() => client.stop());
  return { h, helpers, client, log, remembered };
}

const until = async (fn: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('Claude link client (real MCP server)', () => {
  it('scans, says hello, asks Allow once per origin, then syncs and receives one patch per Claude change', async () => {
    const { h, client, log, remembered } = await setup();
    client.start();
    await until(() => client.linked);
    expect(log.asked).toEqual(['Helka ceramics']);
    expect(remembered.get(APP)).toBe(true);
    expect(h.server.link.status()).toMatchObject({ linked: true, granted: true, paused: false, extensionVersion: '0.1.0-test' });
    await until(() => log.configs.length === 1);
    expect(log.configs[0].project.name).toBe('Helka ceramics');

    await h.call('add_note', { text: 'Why the retry edge exists', kind: 'decision' });
    await until(() => log.patches.length === 1);
    expect(log.patches[0]!.label).toMatch(/^Claude: add note n-/);
    expect(log.patches[0]!.config.notes.at(-1).text).toBe('Why the retry edge exists');
    await until(() => log.activity.some((a) => a.tool === 'add_note' && a.ok));
  });

  it('remembered Allow skips the prompt; canvas edits are written to the file (debounced, not echoed)', async () => {
    const { h, helpers, client, log } = await setup({ allow: true });
    client.start();
    await until(() => client.linked && log.configs.length === 1);
    expect(log.asked).toEqual([]);
    const c = structuredClone(log.configs[0]);
    c.notes.push({ id: 'n-canvas', kind: 'idea', text: 'from the canvas', attachTo: null, rect: { x: 1, y: 2, w: 220, h: 120 }, section: null, author: 'me', createdAt: new Date().toISOString() });
    client.sendConfig({ ...c, notes: [] }); // superseded within the debounce
    client.sendConfig(c);
    await new Promise((r) => setTimeout(r, 300));
    const file = await helpers.readConfigFile(h.dir);
    expect(file.notes.map((n: Any) => n.id)).toContain('n-canvas');
    expect(log.patches).toHaveLength(0); // canvas edits are not echoed back
  });

  it('Discover with Claude: discover-request queues one pending request; request-done comes back', async () => {
    const { h, client } = await setup({ allow: true });
    client.start();
    await until(() => client.linked);
    const done: Any[] = [];
    const off = onRequestDone((r) => done.push(r));
    cleanup.push(off);
    const r = await client.requestDiscover();
    expect(r.created).toBe(true);
    expect((await client.requestDiscover()).requestId).toBe(r.requestId); // clicking twice asks once
    const listed = await h.call('list_requests');
    expect(listed.requests.map((x: Any) => x.id)).toEqual([r.requestId]);
    await h.call('complete_request', { id: r.requestId, summary: 'Added 12 screens.' });
    await until(() => done.length === 1);
    expect(done[0]).toEqual({ requestId: r.requestId, kind: 'discover', summary: 'Added 12 screens.' });
  });

  it('answers canvas requests (get_selection, focus) for Claude tools', async () => {
    const { h, client } = await setup({ allow: true });
    client.start();
    await until(() => client.linked);
    await expect(h.call('get_selection')).resolves.toMatchObject({ ids: ['catalog'] });
    await expect(h.call('focus', { itemId: 'catalog' })).resolves.toMatchObject({ focused: 'catalog' });
  });

  it('Pause Claude blocks write tools until turned off', async () => {
    const { h, client, log } = await setup({ allow: true });
    client.start();
    await until(() => client.linked);
    client.setPaused(true);
    await until(() => h.server.link.paused === true);
    const r = await h.callRaw('add_note', { text: 'blocked' });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/paused/i);
    expect(log.patches).toHaveLength(0);
    client.setPaused(false);
    await until(() => h.server.link.paused === false);
    await h.call('add_note', { text: 'allowed again' });
    await until(() => log.patches.length === 1);
  });

  it('denied: no sync, canvas-only tools fail, and allow(true) later links', async () => {
    const { h, client, log } = await setup({ allow: false });
    client.start();
    await until(() => client.phase === 'denied');
    await new Promise((r) => setTimeout(r, 100));
    expect(log.configs).toHaveLength(0);
    const r = await h.callRaw('get_selection');
    expect(r.isError).toBe(true);
    await client.allow(true);
    await until(() => client.linked && log.configs.length === 1);
  });

  it('stores and reads images through asset-put / asset-get', async () => {
    const { h, client } = await setup({ allow: true });
    client.start();
    await until(() => client.linked);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const file = await client.putAsset(png);
    expect(file).toMatch(/^\.flowcanvas\/assets\/[0-9a-f]{12}\.png$/);
    expect((await fs.readFile(path.join(h.dir, file))).toString('base64')).toBe(png);
    const back = await client.getAsset(file);
    expect(back).toEqual({ mime: 'image/png', data: png });
    await expect(client.getAsset('flowcanvas.config.json')).rejects.toThrow();
  });

  it('ignores a server for another project origin', async () => {
    const { client, log } = await setup({ origin: 'http://localhost:5173' });
    client.start();
    await new Promise((r) => setTimeout(r, 600));
    expect(client.linked).toBe(false);
    expect(log.asked).toEqual([]);
    expect(log.phases.every((p) => p === 'scanning')).toBe(true);
  });

  it('reconnects when the server restarts', async () => {
    const helpers: Any = await import(/* @vite-ignore */ HELPERS);
    const h1 = await helpers.harness({ link: true, ports: PORTS, canvasDebounceMs: 30 });
    const { client, log } = await setup({ allow: true, harness: h1 });
    client.start();
    await until(() => client.linked);
    await h1.server.close();
    await until(() => client.phase === 'scanning');
    const h2 = await helpers.harness({ link: true, ports: PORTS, canvasDebounceMs: 30, projectDir: h1.dir });
    cleanup.push(() => h2.close());
    await until(() => client.linked, 8000);
    await until(() => log.configs.length === 2);
  });
});
