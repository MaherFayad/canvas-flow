/**
 * Claude link client (feature 11, "How the link works"): the canvas end of the
 * MCP server's local WebSocket. React-free so it can be tested against the
 * real server in-process.
 *
 * - Scans ws://127.0.0.1:MCP_PORT_MIN..MCP_PORT_MAX every 5 s until a server
 *   whose `hello.origin` is this canvas's origin answers, then stays on it.
 * - Sends `hello`, the current `pause`, then `allow` (asked once per origin,
 *   remembered by the caller's allow store).
 * - Dispatches `config`, `patch`, `request`, `activity`, `error` to handlers;
 *   answers requests with `response`.
 * - Canvas edits go back as `config`, debounced 500 ms.
 * - Images: `asset-put` / `asset-get` (answered by `asset-result`).
 * - Reconnects (rescans) when the socket drops.
 *
 * The browser sets `Origin: chrome-extension://<id>` on the upgrade; the
 * server checks it. Tests pass a socket factory that sets it explicitly.
 */
import { MCP_PORT_MAX, MCP_PORT_MIN } from '@flowcanvas/protocol';
import {
  CANVAS_WRITE_DEBOUNCE_MS,
  CANVAS_METHODS,
  LINK_PROTOCOL_VERSION,
  parseServerMessage,
  type CanvasMethod,
  type CanvasToServer,
  type ServerToCanvas,
} from '@flowcanvas/mcp/link-protocol';

export const SCAN_INTERVAL_MS = 5000;
/** Time to wait for a server's `hello` on one port before trying the next. */
const HELLO_TIMEOUT_MS = 1500;

/** Minimal WebSocket surface (browser WebSocket and `ws` both fit). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type SocketFactory = (url: string) => SocketLike;

export type LinkPhase = 'off' | 'scanning' | 'prompt' | 'linked' | 'denied';

export interface LinkStatus {
  phase: LinkPhase;
  port: number | null;
  /** project.name from the server's hello. */
  name: string | null;
  /** Absolute project folder from the server's hello. */
  project: string | null;
}

export interface ActivityRow {
  tool: string;
  ok: boolean;
  summary: string;
  at: string;
}

export interface LinkHandlers {
  status?(s: LinkStatus): void;
  /** First connect for this origin: ask "Claude wants to connect to <name>. Allow?". */
  askAllow(name: string): Promise<boolean>;
  /** Full sync (after allow, or the file changed outside). */
  config?(config: unknown): void;
  /** One Claude change = one undo step. */
  patch?(label: string, config: unknown): void;
  /** Canvas-only tools and confirm prompts. Throw to answer ok:false. */
  request?(method: CanvasMethod, params: Record<string, unknown>): Promise<unknown>;
  activity?(a: ActivityRow): void;
  error?(message: string, errors?: string[]): void;
}

export interface AllowStore {
  get(origin: string): Promise<boolean | null>;
  set(origin: string, granted: boolean): Promise<void>;
}

export interface LinkOptions {
  origin: string;
  extensionVersion: string;
  handlers: LinkHandlers;
  allowStore: AllowStore;
  socket?: SocketFactory;
  ports?: [number, number];
  host?: string;
  scanMs?: number;
  debounceMs?: number;
}

const OPEN = 1;

type AssetResult = Extract<ServerToCanvas, { type: 'asset-result' }>;

export class ClaudeLinkClient {
  private readonly opts: LinkOptions;
  private ws: SocketLike | null = null;
  private status: LinkStatus = { phase: 'off', port: null, name: null, project: null };
  private paused = false;
  private stopped = true;
  private scanning = false;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private configTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingConfig: unknown = null;
  private assets = new Map<string, { resolve: (r: AssetResult) => void; reject: (e: Error) => void }>();
  private seq = 0;

  constructor(opts: LinkOptions) {
    this.opts = opts;
  }

  get phase(): LinkPhase {
    return this.status.phase;
  }
  /** Socket open and the user allowed Claude. */
  get linked(): boolean {
    return this.status.phase === 'linked' && !!this.ws && this.ws.readyState === OPEN;
  }
  get isPaused(): boolean {
    return this.paused;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.setStatus({ phase: 'scanning' });
    void this.scan();
  }

  stop(): void {
    this.stopped = true;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    this.flushConfig();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.failAssets('The Claude link stopped.');
    this.setStatus({ phase: 'off', port: null, name: null, project: null });
  }

  /** Pause Claude: the server blocks every write tool while paused. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.send({ type: 'pause', paused });
  }

  /** Answer (or change) the Allow choice; remembered per origin. */
  async allow(granted: boolean): Promise<void> {
    await this.opts.allowStore.set(this.opts.origin, granted);
    if (!this.ws || this.ws.readyState !== OPEN) return;
    this.send({ type: 'allow', granted });
    this.setStatus({ phase: granted ? 'linked' : 'denied' });
  }

  /** Canvas edit: sent as `config` after 500 ms of quiet. */
  sendConfig(config: unknown): void {
    if (!this.linked) return;
    this.pendingConfig = config;
    if (this.configTimer) clearTimeout(this.configTimer);
    this.configTimer = setTimeout(() => this.flushConfig(), this.opts.debounceMs ?? CANVAS_WRITE_DEBOUNCE_MS);
  }

  /** Send a pending canvas edit now (e.g. before the tab closes). */
  flushConfig(): void {
    if (this.configTimer) clearTimeout(this.configTimer);
    this.configTimer = null;
    if (this.pendingConfig === null) return;
    const c = this.pendingConfig;
    this.pendingConfig = null;
    if (this.linked) this.send({ type: 'config', config: c });
  }

  /** Store image bytes as .flowcanvas/assets/<hash>.<ext>; resolves with the project-relative file. */
  async putAsset(base64: string, timeoutMs = 20_000): Promise<string> {
    const r = await this.assetCall({ type: 'asset-put', id: this.nextId('put'), data: base64 }, timeoutMs);
    if (!r.ok || !r.file) throw new Error(r.error ?? 'The MCP server did not store the image.');
    return r.file;
  }

  /** Read an image under .flowcanvas/assets/. */
  async getAsset(file: string, timeoutMs = 20_000): Promise<{ mime: string; data: string }> {
    const r = await this.assetCall({ type: 'asset-get', id: this.nextId('get'), file }, timeoutMs);
    if (!r.ok || !r.data) throw new Error(r.error ?? `The MCP server could not read ${file}.`);
    return { mime: r.mime ?? 'application/octet-stream', data: r.data };
  }

  /* ------------------------------------------------------------------ */

  private nextId(p: string): string {
    return `${p}-${Date.now().toString(36)}-${++this.seq}`;
  }

  private assetCall(msg: Extract<CanvasToServer, { type: 'asset-put' | 'asset-get' }>, timeoutMs: number): Promise<AssetResult> {
    if (!this.linked) return Promise.reject(new Error('Claude is not linked.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.assets.delete(msg.id);
        reject(new Error('The MCP server did not answer in time.'));
      }, timeoutMs);
      this.assets.set(msg.id, {
        resolve: (r) => (clearTimeout(timer), resolve(r)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.send(msg);
    });
  }

  private failAssets(message: string): void {
    for (const p of this.assets.values()) p.reject(new Error(message));
    this.assets.clear();
  }

  private setStatus(p: Partial<LinkStatus>): void {
    this.status = { ...this.status, ...p };
    this.opts.handlers.status?.({ ...this.status });
  }

  private send(m: CanvasToServer): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(m));
  }

  private scheduleScan(ms = this.opts.scanMs ?? SCAN_INTERVAL_MS): void {
    if (this.stopped) return;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => void this.scan(), ms);
  }

  private makeSocket(url: string): SocketLike {
    if (this.opts.socket) return this.opts.socket(url);
    return new WebSocket(url) as unknown as SocketLike;
  }

  /** Try every port once; connect to the first server for this origin. */
  private async scan(): Promise<void> {
    if (this.stopped || this.scanning || this.ws) return;
    this.scanning = true;
    try {
      const [min, max] = this.opts.ports ?? [MCP_PORT_MIN, MCP_PORT_MAX];
      for (let port = min; port <= max && !this.stopped; port++) {
        const hit = await this.probe(port);
        if (hit) {
          this.adopt(hit.ws, port, hit.hello);
          return;
        }
      }
    } finally {
      this.scanning = false;
    }
    this.scheduleScan();
  }

  /** Open a socket and wait for a hello for our origin. */
  private probe(port: number): Promise<{ ws: SocketLike; hello: Extract<ServerToCanvas, { type: 'hello' }> } | null> {
    return new Promise((resolve) => {
      let ws: SocketLike;
      try {
        ws = this.makeSocket(`ws://${this.opts.host ?? '127.0.0.1'}:${port}`);
      } catch {
        resolve(null);
        return;
      }
      let done = false;
      const finish = (v: { ws: SocketLike; hello: Extract<ServerToCanvas, { type: 'hello' }> } | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ws.onmessage = ws.onclose = ws.onerror = ws.onopen = null;
        if (!v) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), HELLO_TIMEOUT_MS);
      ws.onerror = () => finish(null);
      ws.onclose = () => finish(null);
      ws.onmessage = (ev) => {
        const m = parseServerMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
        if (!m || m.type !== 'hello') return finish(null);
        // Another project's server: leave it alone and keep scanning.
        finish(sameOrigin(m.origin, this.opts.origin) ? { ws, hello: m } : null);
      };
    });
  }

  private adopt(ws: SocketLike, port: number, hello: Extract<ServerToCanvas, { type: 'hello' }>): void {
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(ws, typeof ev.data === 'string' ? ev.data : String(ev.data));
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => undefined;
    this.setStatus({ phase: 'prompt', port, name: hello.name, project: hello.project });
    this.send({ type: 'hello', v: LINK_PROTOCOL_VERSION, extensionVersion: this.opts.extensionVersion });
    this.send({ type: 'pause', paused: this.paused });
    void this.decideAllow(ws, hello.name);
  }

  private async decideAllow(ws: SocketLike, name: string): Promise<void> {
    let granted = await this.opts.allowStore.get(this.opts.origin).catch(() => null);
    if (granted === null) {
      granted = await this.opts.handlers.askAllow(name);
      await this.opts.allowStore.set(this.opts.origin, granted).catch(() => undefined);
    }
    if (this.ws !== ws) return;
    this.send({ type: 'allow', granted });
    this.setStatus({ phase: granted ? 'linked' : 'denied' });
  }

  private onClose(ws: SocketLike): void {
    if (this.ws !== ws) return;
    this.ws = null;
    if (this.configTimer) clearTimeout(this.configTimer);
    this.configTimer = null;
    this.pendingConfig = null;
    this.failAssets('The Claude link dropped.');
    if (this.stopped) return;
    this.setStatus({ phase: 'scanning', port: null });
    // Reconnect: rescan soon (the server may have restarted on another port).
    this.scheduleScan(500);
  }

  private onMessage(ws: SocketLike, raw: string): void {
    if (this.ws !== ws) return;
    const m = parseServerMessage(raw);
    if (!m) return;
    const h = this.opts.handlers;
    switch (m.type) {
      case 'hello':
        if (!sameOrigin(m.origin, this.opts.origin)) ws.close();
        else this.setStatus({ name: m.name, project: m.project });
        break;
      case 'config':
        h.config?.(m.config);
        break;
      case 'patch':
        h.patch?.(m.label, m.config);
        break;
      case 'activity':
        h.activity?.({ tool: m.tool, ok: m.ok, summary: m.summary, at: m.at });
        break;
      case 'error':
        h.error?.(m.message, m.errors);
        break;
      case 'request':
        void this.answer(m.id, m.method, m.params);
        break;
      case 'asset-result': {
        const p = this.assets.get(m.id);
        if (p) {
          this.assets.delete(m.id);
          p.resolve(m);
        }
        break;
      }
    }
  }

  private async answer(id: string, method: CanvasMethod, params: Record<string, unknown>): Promise<void> {
    if (!CANVAS_METHODS.includes(method) || !this.opts.handlers.request) {
      this.send({ type: 'response', id, ok: false, error: `The canvas cannot ${method} yet.` });
      return;
    }
    try {
      const result = await this.opts.handlers.request(method, params);
      this.send({ type: 'response', id, ok: true, result });
    } catch (e) {
      this.send({ type: 'response', id, ok: false, error: (e as Error).message ?? String(e) });
    }
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
}

/** Allow answers in chrome.storage.local, keyed by origin. */
export const chromeAllowStore: AllowStore = {
  async get(origin) {
    const a = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
    if (!a) return null;
    const k = `claude-allow:${origin}`;
    const r = await a.get(k);
    const v = r[k];
    return typeof v === 'boolean' ? v : null;
  },
  async set(origin, granted) {
    const a = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
    if (!a) return;
    await a.set({ [`claude-allow:${origin}`]: granted });
  },
};
