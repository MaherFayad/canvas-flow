import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';
import { createFlowCanvasServer, type FlowCanvasServer, type FlowCanvasServerOptions } from '../src/server.js';
import { parseServerMessage, type CanvasToServer, type ServerToCanvas } from '../src/link-protocol.js';

export const FIXTURE = fileURLToPath(new URL('./fixtures/flowcanvas.config.json', import.meta.url));

export async function tmpProject(withFixture = true): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-mcp-'));
  if (withFixture) await fs.copyFile(FIXTURE, path.join(dir, 'flowcanvas.config.json'));
  return dir;
}

export async function readConfigFile(dir: string): Promise<any> {
  return JSON.parse(await fs.readFile(path.join(dir, 'flowcanvas.config.json'), 'utf8'));
}

export interface Harness {
  dir: string;
  server: FlowCanvasServer;
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<any>;
  callRaw(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

export async function harness(opts: Partial<FlowCanvasServerOptions> & { fixture?: boolean } = {}): Promise<Harness> {
  const dir = opts.projectDir ?? (await tmpProject(opts.fixture !== false));
  const server = createFlowCanvasServer({ link: false, ...opts, projectDir: dir });
  await server.start();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.mcp.connect(st), client.connect(ct)]);
  const callRaw = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return {
    dir,
    server,
    client,
    callRaw,
    async call(name, args = {}) {
      const r = await callRaw(name, args);
      const t = r.content.find((c) => c.type === 'text');
      if (r.isError) throw new Error(t && t.type === 'text' ? t.text : 'tool error');
      return t && t.type === 'text' ? JSON.parse(t.text) : r;
    },
    async close() {
      await client.close().catch(() => undefined);
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export function errorText(r: CallToolResult): string {
  const t = r.content.find((c) => c.type === 'text');
  return t && t.type === 'text' ? t.text : '';
}

/** A fake canvas: a real ws client. */
export class FakeCanvas {
  readonly messages: ServerToCanvas[] = [];
  private waiters: { pred: (m: ServerToCanvas) => boolean; resolve: (m: ServerToCanvas) => void }[] = [];
  handlers: Partial<Record<string, (params: any) => unknown>> = {};

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const m = parseServerMessage(d.toString());
      if (!m) return;
      this.messages.push(m);
      if (m.type === 'request') {
        const h = this.handlers[m.method];
        if (!h) this.send({ type: 'response', id: m.id, ok: false, error: `no handler for ${m.method}` });
        else {
          try {
            this.send({ type: 'response', id: m.id, ok: true, result: h(m.params) });
          } catch (e) {
            this.send({ type: 'response', id: m.id, ok: false, error: (e as Error).message });
          }
        }
      }
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
  }

  static connect(port: number, origin: string | null): Promise<FakeCanvas> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
      const fc = new FakeCanvas(ws);
      ws.once('open', () => resolve(fc));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  send(m: CanvasToServer): void {
    this.ws.send(JSON.stringify(m));
  }

  waitFor<T extends ServerToCanvas['type']>(type: T, pred: (m: Extract<ServerToCanvas, { type: T }>) => boolean = () => true, timeoutMs = 5000): Promise<Extract<ServerToCanvas, { type: T }>> {
    const existing = this.messages.find((m) => m.type === type && pred(m as never));
    if (existing) return Promise.resolve(existing as never);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        pred: (m) => m.type === type && pred(m as never),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as never);
        },
      });
    });
  }

  async handshake(granted = true): Promise<void> {
    await this.waitFor('hello');
    this.send({ type: 'hello', v: 1, extensionVersion: '0.0.1-test' });
    this.send({ type: 'pause', paused: false });
    this.send({ type: 'allow', granted });
    if (granted) await this.waitFor('config');
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

export function until(fn: () => boolean | Promise<boolean>, timeoutMs = 5000, stepMs = 20): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('until: timed out'));
      setTimeout(tick, stepMs);
    };
    void tick();
  });
}
