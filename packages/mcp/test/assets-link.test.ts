import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasToServerSchema, ServerToCanvasSchema } from '../src/link-protocol.js';
import { FakeCanvas, harness, until, type Harness } from './helpers.js';

// Own port range so this file never collides with other test files.
const PORTS: [number, number] = [48850, 48859];
const ORIGIN = 'chrome-extension://test';

// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let h: Harness | null = null;
const canvases: FakeCanvas[] = [];
afterEach(async () => {
  for (const c of canvases.splice(0)) await c.close();
  await h?.close();
  h = null;
});

async function linked(grant = true) {
  h = await harness({ link: true, ports: PORTS, canvasDebounceMs: 50 });
  const canvas = await FakeCanvas.connect(h.server.link!.port!, ORIGIN);
  canvases.push(canvas);
  await canvas.handshake(grant);
  await until(() => h!.server.link!.granted !== null);
  return { h, canvas };
}

describe('asset messages (link protocol, additive)', () => {
  it('schemas accept asset-put / asset-get / asset-result', () => {
    expect(CanvasToServerSchema.safeParse({ type: 'asset-put', id: 'a1', data: 'AAAA' }).success).toBe(true);
    expect(CanvasToServerSchema.safeParse({ type: 'asset-get', id: 'a2', file: '.flowcanvas/assets/x.png' }).success).toBe(true);
    expect(CanvasToServerSchema.safeParse({ type: 'asset-put', id: 'a1' }).success).toBe(false);
    expect(ServerToCanvasSchema.safeParse({ type: 'asset-result', id: 'a1', ok: true, file: 'f' }).success).toBe(true);
  });

  it('asset-put writes .flowcanvas/assets/<hash>.<ext> once and answers with the file', async () => {
    const { h, canvas } = await linked();
    canvas.send({ type: 'asset-put', id: 'p1', data: PNG.toString('base64') });
    const r = await canvas.waitFor('asset-result', (m) => m.id === 'p1');
    expect(r.ok).toBe(true);
    expect(r.file).toMatch(/^\.flowcanvas\/assets\/[0-9a-f]{12}\.png$/);
    const onDisk = await fs.readFile(path.join(h.dir, r.file!));
    expect(onDisk.equals(PNG)).toBe(true);
    // Same bytes: same name.
    canvas.send({ type: 'asset-put', id: 'p2', data: PNG.toString('base64') });
    const r2 = await canvas.waitFor('asset-result', (m) => m.id === 'p2');
    expect(r2.file).toBe(r.file);
  });

  it('asset-put rejects bytes that are not an image', async () => {
    const { canvas } = await linked();
    canvas.send({ type: 'asset-put', id: 'bad', data: Buffer.from('hello').toString('base64') });
    const r = await canvas.waitFor('asset-result', (m) => m.id === 'bad');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not a supported image/);
  });

  it('asset-get reads an asset Claude added, and refuses paths outside .flowcanvas/assets', async () => {
    const { h, canvas } = await linked();
    const src = path.join(h.dir, 'mock.png');
    await fs.writeFile(src, PNG);
    const added = await h.call('add_image', { path: 'mock.png', x: 0, y: 0 });
    canvas.send({ type: 'asset-get', id: 'g1', file: added.image.file });
    const r = await canvas.waitFor('asset-result', (m) => m.id === 'g1');
    expect(r).toMatchObject({ ok: true, file: added.image.file, mime: 'image/png' });
    expect(Buffer.from(r.data!, 'base64').equals(PNG)).toBe(true);

    for (const [id, file] of [
      ['g2', 'flowcanvas.config.json'],
      ['g3', '.flowcanvas/assets/../../etc/passwd'],
      ['g4', '.flowcanvas/cache/x.webp'],
    ] as const) {
      canvas.send({ type: 'asset-get', id, file });
      const bad = await canvas.waitFor('asset-result', (m) => m.id === id);
      expect(bad.ok).toBe(false);
      expect(bad.data).toBeUndefined();
    }
  });

  it('asset messages are refused before Allow', async () => {
    const { h, canvas } = await linked(false);
    canvas.send({ type: 'asset-put', id: 'p1', data: PNG.toString('base64') });
    const r = await canvas.waitFor('asset-result', (m) => m.id === 'p1');
    expect(r.ok).toBe(false);
    const entries = await fs.readdir(path.join(h.dir, '.flowcanvas', 'assets')).catch(() => []);
    expect(entries).toHaveLength(0);
  });
});
