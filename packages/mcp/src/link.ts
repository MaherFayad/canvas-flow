/**
 * CanvasLink: local WebSocket server the Flow Canvas tab connects to.
 * Binds 127.0.0.1 only, first free port in MCP_PORT_MIN..MCP_PORT_MAX,
 * accepts only chrome-extension:// origins, one canvas at a time.
 */
import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { MCP_PORT_MAX, MCP_PORT_MIN } from '@flowcanvas/protocol';
import {
  CanvasParamsSchemas,
  CanvasResultSchemas,
  extensionOrigin,
  LINK_PROTOCOL_VERSION,
  parseCanvasMessage,
  type CanvasMethod,
  type CanvasParams,
  type CanvasResult,
  type CanvasToServer,
  type ServerToCanvas,
} from './link-protocol.js';
import { ToolError, silentLogger, type Logger } from './log.js';

export interface CanvasLinkOptions {
  /** Only accept `chrome-extension://<extensionId>`. Without it any chrome-extension:// origin is accepted (with a warning). */
  extensionId?: string;
  /** Inclusive port range to try. Defaults to the protocol range. */
  ports?: [number, number];
  host?: string;
  log?: Logger;
  /** Called to build the hello message for a new canvas. */
  hello: () => { project: string; origin: string; name: string; serverVersion: string };
  requestTimeoutMs?: number;
}

interface Pending {
  method: CanvasMethod;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export type LinkStatus = { linked: boolean; granted: boolean | null; paused: boolean; extensionVersion: string | null; port: number | null };

/**
 * Events: 'connect', 'disconnect', 'allow' (granted), 'pause' (paused),
 * 'config' (raw config from canvas), 'asset-put' / 'asset-get' / 'discover-request' (after Allow),
 * 'message' (every parsed canvas message).
 */
export class CanvasLink extends EventEmitter {
  private readonly opts: CanvasLinkOptions;
  private readonly log: Logger;
  private http: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private _port: number | null = null;
  private _granted: boolean | null = null;
  private _paused = false;
  private _extensionVersion: string | null = null;

  constructor(opts: CanvasLinkOptions) {
    super();
    this.opts = opts;
    this.log = opts.log ?? silentLogger;
  }

  get port(): number | null {
    return this._port;
  }
  /** A canvas socket is open. */
  get linked(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }
  /** null = not answered yet. */
  get granted(): boolean | null {
    return this._granted;
  }
  /** Linked and the user allowed Claude on this project. */
  get ready(): boolean {
    return this.linked && this._granted === true;
  }
  /** Pause Claude switch. Stays on after the canvas disconnects until the canvas turns it off. */
  get paused(): boolean {
    return this._paused;
  }
  status(): LinkStatus {
    return { linked: this.linked, granted: this._granted, paused: this._paused, extensionVersion: this._extensionVersion, port: this._port };
  }

  async start(): Promise<number> {
    const [min, max] = this.opts.ports ?? [MCP_PORT_MIN, MCP_PORT_MAX];
    const host = this.opts.host ?? '127.0.0.1';
    if (!this.opts.extensionId) {
      this.log.warn('no --extension-id given: accepting any chrome-extension:// origin');
    }
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
    for (let port = min; port <= max; port++) {
      const server = http.createServer((_req, res) => {
        res.writeHead(426, { 'content-type': 'text/plain' });
        res.end('Flow Canvas MCP link: WebSocket only\n');
      });
      server.on('upgrade', (req, sock, head) => this.onUpgrade(req, sock, head));
      const ok = await new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false));
        server.listen(port, host, () => resolve(true));
      });
      if (ok) {
        this.http = server;
        this._port = port;
        this.log.info(`canvas link listening on ws://${host}:${port}`);
        return port;
      }
      server.close();
    }
    throw new Error(`no free port in ${min}..${max} for the canvas link`);
  }

  async close(): Promise<void> {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ToolError('The MCP server is shutting down.'));
    }
    this.pending.clear();
    this.socket?.terminate();
    this.socket = null;
    this.wss?.close();
    this.wss = null;
    await new Promise<void>((resolve) => (this.http ? this.http.close(() => resolve()) : resolve()));
    this.http = null;
  }

  send(msg: ServerToCanvas): boolean {
    if (!this.linked) return false;
    this.socket!.send(JSON.stringify(msg));
    return true;
  }

  /** Send when the user has allowed this project. */
  sendIfReady(msg: ServerToCanvas): boolean {
    return this.ready ? this.send(msg) : false;
  }

  /** Ask the canvas to do something. Rejects with a ToolError when not linked, denied, failed or timed out. */
  request<M extends CanvasMethod>(method: M, params: CanvasParams<M>, timeoutMs?: number): Promise<CanvasResult<M>> {
    this.assertReady();
    const id = randomUUID();
    const checked = CanvasParamsSchemas[method].parse(params) as Record<string, unknown>;
    const timeout = timeoutMs ?? this.opts.requestTimeoutMs ?? 20_000;
    return new Promise<CanvasResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolError(`The Flow Canvas tab did not answer "${method}" within ${Math.round(timeout / 1000)} s.`));
      }, timeout);
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ type: 'request', id, method, params: checked });
    });
  }

  /** Throws the right ToolError when canvas-only work is not possible. */
  assertReady(): void {
    if (!this.linked) throw new ToolError(this.notLinkedMessage());
    if (this._granted === null) {
      throw new ToolError('The Flow Canvas tab is connected but the user has not allowed Claude yet. Ask them to click Allow on the canvas.');
    }
    if (this._granted === false) {
      throw new ToolError('The user denied Claude access on the Flow Canvas tab. They can allow it again from the canvas.');
    }
  }

  notLinkedMessage(origin?: string): string {
    const o = origin ?? this.opts.hello().origin;
    return `Open the Flow Canvas tab for ${o} to use this tool. (No canvas is linked to this MCP server.)`;
  }

  /* ------------------------------------------------------------------ */

  private originAllowed(origin: string | undefined): boolean {
    if (!origin) return false;
    if (this.opts.extensionId) return origin === extensionOrigin(this.opts.extensionId);
    if (/^chrome-extension:\/\/[a-z0-9]+$/i.test(origin)) {
      this.log.warn(`accepting canvas from ${origin} (no --extension-id pinned)`);
      return true;
    }
    return false;
  }

  private onUpgrade(req: http.IncomingMessage, sock: Duplex, head: Buffer): void {
    const origin = req.headers.origin;
    if (!this.originAllowed(origin)) {
      this.log.warn(`rejected canvas connection from origin ${origin ?? '(none)'}`);
      reject(sock, 403, 'Forbidden');
      return;
    }
    if (this.linked) {
      this.log.warn('rejected a second canvas connection: one canvas at a time');
      reject(sock, 409, 'Conflict');
      return;
    }
    this.wss!.handleUpgrade(req, sock, head, (ws) => this.onConnection(ws));
  }

  private onConnection(ws: WebSocket): void {
    this.socket = ws;
    this._granted = null;
    this._extensionVersion = null;
    this.log.info('canvas connected');
    ws.on('message', (data) => this.onMessage(ws, data.toString()));
    ws.on('close', () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this._granted = null;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new ToolError(`The Flow Canvas tab disconnected before answering "${p.method}".`));
        this.pending.delete(id);
      }
      this.log.info('canvas disconnected');
      this.emit('disconnect');
    });
    ws.on('error', (e) => this.log.warn(`canvas socket: ${e.message}`));
    const h = this.opts.hello();
    this.send({ type: 'hello', v: LINK_PROTOCOL_VERSION, ...h });
    this.emit('connect');
  }

  private onMessage(ws: WebSocket, raw: string): void {
    if (ws !== this.socket) return;
    const msg = parseCanvasMessage(raw);
    if (!msg) {
      this.log.warn('ignored an invalid message from the canvas');
      return;
    }
    this.handle(msg);
    this.emit('message', msg);
  }

  private handle(msg: CanvasToServer): void {
    switch (msg.type) {
      case 'hello':
        this._extensionVersion = msg.extensionVersion;
        break;
      case 'allow':
        this._granted = msg.granted;
        this.log.info(msg.granted ? 'user allowed Claude on the canvas' : 'user denied Claude on the canvas');
        this.emit('allow', msg.granted);
        break;
      case 'pause':
        this._paused = msg.paused;
        this.log.info(msg.paused ? 'Claude paused from the canvas' : 'Claude resumed from the canvas');
        this.emit('pause', msg.paused);
        break;
      case 'config':
        if (this._granted !== true) {
          this.log.warn('ignored canvas config before Allow');
          return;
        }
        this.emit('config', msg.config);
        break;
      case 'response': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (!msg.ok) {
          p.reject(new ToolError(`The canvas could not ${p.method.replace('_', ' ')}: ${msg.error ?? 'unknown error'}`));
          return;
        }
        const r = CanvasResultSchemas[p.method].safeParse(msg.result ?? {});
        if (!r.success) {
          p.reject(new ToolError(`The canvas sent an unexpected result for ${p.method}: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`));
          return;
        }
        p.resolve(r.data);
        break;
      }
      case 'activity':
        break;
      case 'discover-request':
        if (this._granted !== true) {
          this.send({ type: 'request-ack', id: msg.id, ok: false, error: 'Claude is not allowed on this canvas.' });
          return;
        }
        this.emit(msg.type, msg);
        break;
      case 'asset-put':
      case 'asset-get':
        if (this._granted !== true) {
          this.send({ type: 'asset-result', id: msg.id, ok: false, error: 'Claude is not allowed on this canvas.' });
          return;
        }
        this.emit(msg.type, msg);
        break;
    }
  }
}

function reject(sock: Duplex, code: number, text: string): void {
  sock.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  sock.destroy();
}
