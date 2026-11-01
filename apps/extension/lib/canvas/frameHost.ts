/**
 * FrameHost: the canvas end of the wire protocol. One per canvas page.
 * - per-frame session nonce (makeNonce), handed out in `welcome`
 * - accepts only messages from the project origin, with the frame's nonce,
 *   from the frame's own iframe window
 * - replies with iframe.contentWindow.postMessage(msg, origin)
 */
import {
  PROTOCOL_VERSION,
  acceptFromFrame,
  makeNonce,
  type Message,
  type MessageOf,
  type MockRule,
} from '@flowcanvas/protocol';
import { normPath } from '../url';

export interface FrameMeta {
  screen: string;
  state: string;
  path: string;
  /** Hidden discovery frame: not a canvas node. */
  discover?: boolean;
}

export interface FrameInfo extends FrameMeta {
  frameId: string;
  iframe: HTMLIFrameElement | null;
  nonce?: string;
  currentPath?: string;
  hasSdk: boolean;
  ready: boolean;
  lastClick?: { target: string; text: string; at: number };
}

export interface HostContext {
  mocksFor(screen: string, state: string): MockRule[];
  tokens(): Record<string, string>;
  recording(): boolean;
  device(): { w: number; h: number };
}

type CanvasMsg = { [K in Message['fc']]: Omit<MessageOf<K>, 'v' | 'frame' | 'nonce'> & { fc: K } }[Message['fc']];
export type HostListener = (info: FrameInfo, msg: Message) => void;

let reqSeq = 0;

export class FrameHost {
  readonly frames = new Map<string, FrameInfo>();
  private listeners = new Set<HostListener>();
  private pending = new Map<string, { resolve: (m: Message) => void; timer: ReturnType<typeof setTimeout> }>();
  private onMessage = (ev: MessageEvent) => this.receive(ev);

  constructor(
    private win: Window,
    readonly origin: string,
    private ctx: HostContext,
  ) {
    win.addEventListener('message', this.onMessage);
  }

  destroy() {
    this.win.removeEventListener('message', this.onMessage);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.listeners.clear();
  }

  subscribe(fn: HostListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  register(frameId: string, meta: FrameMeta, iframe: HTMLIFrameElement | null = null): FrameInfo {
    const info: FrameInfo = { ...meta, frameId, iframe, hasSdk: false, ready: false };
    this.frames.set(frameId, info);
    return info;
  }

  attach(frameId: string, iframe: HTMLIFrameElement | null) {
    const f = this.frames.get(frameId);
    if (f) f.iframe = iframe;
  }

  unregister(frameId: string) {
    this.frames.delete(frameId);
  }

  /** Frames currently showing screen:state (live ones). */
  framesFor(screen: string, state: string): FrameInfo[] {
    return [...this.frames.values()].filter((f) => !f.discover && f.screen === screen && f.state === state);
  }

  send(frameId: string, m: CanvasMsg): boolean {
    const f = this.frames.get(frameId);
    const target = f?.iframe?.contentWindow;
    if (!f || !f.nonce || !target) return false;
    target.postMessage({ ...m, v: PROTOCOL_VERSION, frame: frameId, nonce: f.nonce }, this.origin);
    return true;
  }

  broadcast(m: CanvasMsg) {
    for (const id of this.frames.keys()) this.send(id, m);
  }

  /** Request/response by id (query, links, element-at, capture). Resolves null on timeout or if the frame is not connected. */
  request<T extends Message>(frameId: string, m: CanvasMsg & { id?: string }, timeoutMs = 3000): Promise<T | null> {
    const rid = `r${++reqSeq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        resolve(null);
      }, timeoutMs);
      this.pending.set(rid, { resolve: (msg) => resolve(msg as T), timer });
      if (!this.send(frameId, { ...m, id: rid } as CanvasMsg)) {
        clearTimeout(timer);
        this.pending.delete(rid);
        resolve(null);
      }
    });
  }

  private receive(ev: MessageEvent) {
    const msg = acceptFromFrame(ev, this.origin, (id) => this.frames.get(id)?.nonce);
    if (!msg) return;
    const f = this.frames.get(msg.frame);
    if (!f) return;
    // The message must come from this frame's own iframe window.
    if (f.iframe && ev.source && ev.source !== f.iframe.contentWindow) return;

    if (msg.fc === 'hello') {
      f.nonce ??= makeNonce();
      const prev = f.currentPath;
      f.currentPath = msg.url;
      f.ready = false;
      // A second hello = full-page navigation inside the iframe (MPA). Treat as nav.
      const navMsg: Message | null =
        prev && prev !== msg.url ? { fc: 'nav', v: PROTOCOL_VERSION, frame: f.frameId, nonce: f.nonce, from: prev, to: msg.url } : null;
      // Same page as the node (first load, reload, HMR full reload): keep its state and mocks.
      const home = normPath(msg.url) === normPath(f.path);
      const state = home ? f.state : 'default';
      this.send(f.frameId, { fc: 'welcome', state, device: this.ctx.device() });
      this.send(f.frameId, { fc: 'mocks', rules: home ? this.ctx.mocksFor(f.screen, f.state) : [] });
      const tokens = this.ctx.tokens();
      if (Object.keys(tokens).length) this.send(f.frameId, { fc: 'tokens', vars: tokens });
      if (this.ctx.recording()) this.send(f.frameId, { fc: 'record', on: true });
      this.emit(f, msg);
      if (navMsg) this.emit(f, navMsg);
      return;
    }
    if ('id' in msg && typeof msg.id === 'string' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve(msg);
    }
    switch (msg.fc) {
      case 'ready':
        f.ready = true;
        break;
      case 'screens':
        f.hasSdk = true;
        break;
      case 'nav':
        f.currentPath = msg.to;
        break;
      case 'click':
        f.lastClick = { target: msg.target, text: msg.text, at: Date.now() };
        break;
      default:
        break;
    }
    this.emit(f, msg);
  }

  private emit(f: FrameInfo, msg: Message) {
    for (const l of this.listeners) l(f, msg);
  }
}
