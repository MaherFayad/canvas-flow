/**
 * Play stage engine (feature 6): two stacked iframes, A (on show) and B (spare).
 * `go()` loads the next screen into B *underneath* A (painted, not hidden, so
 * nothing blank can show when it is revealed), waits for `ready` (or load +
 * 300 ms without the SDK), animates both with the Web Animations API, then
 * swaps roles; the old A becomes the spare. Going back to the screen the
 * spare still holds skips the reload.
 */
import { frameUrl, type MessageOf } from '@flowcanvas/protocol';
import type { Device, Edge, Screen } from '@flowcanvas/config';
import { WINDOW_NAME_PREFIX } from '../frame';
import type { FrameHost } from './frameHost';
import { planForEdge, type TransitionPlan } from './transitions';
import { prefersReducedMotion } from './easing';

export interface StageNode {
  screen: Screen;
  state: string;
}

interface Slot {
  el: HTMLIFrameElement;
  frameId: string | null;
  node: StageNode | null;
  ready: Promise<void>;
  isReady: boolean;
}

export interface StageOptions {
  host: FrameHost;
  origin: string;
  device: Device;
  /** Selectors to intercept in a frame showing this node (outgoing edge targets). */
  interceptFor(node: StageNode): string[];
  /** A tap on an intercepted target inside the frame on show. */
  onTap?(target: string): void;
  /** The frame on show became ready. */
  onReady?(node: StageNode): void;
}

/** No `ready` from a frame without the SDK: reveal this long after `load`. */
export const NO_SDK_READY_MS = 300;
/** Never wait longer than this for a frame. */
export const READY_CAP_MS = 4000;

const sameNode = (a: StageNode | null, b: StageNode) => !!a && a.screen.id === b.screen.id && a.state === b.state;

export class Stage {
  private slots: [Slot, Slot];
  /** Index of the slot on show. */
  private cur = 0;
  private dim: HTMLDivElement;
  private anims: Animation[] = [];
  private off: () => void;
  private busy: Promise<void> = Promise.resolve();
  destroyed = false;

  constructor(
    private root: HTMLElement,
    private o: StageOptions,
  ) {
    const mk = (): Slot => {
      const el = document.createElement('iframe');
      el.setAttribute('allow', 'clipboard-write');
      Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', border: '0', background: 'transparent', display: 'block' });
      el.width = String(o.device.w);
      el.height = String(o.device.h);
      root.appendChild(el);
      return { el, frameId: null, node: null, ready: Promise.resolve(), isReady: false };
    };
    this.slots = [mk(), mk()];
    this.dim = document.createElement('div');
    Object.assign(this.dim.style, { position: 'absolute', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none' });
    root.appendChild(this.dim);
    this.layer('a');
    this.off = o.host.subscribe((f, m) => {
      const i = this.slots.findIndex((s) => s.frameId === f.frameId);
      if (i < 0) return;
      const slot = this.slots[i]!;
      if (m.fc === 'hello' && slot.node) {
        const sel = o.interceptFor(slot.node);
        o.host.send(f.frameId, { fc: 'record', on: false, intercept: sel });
      } else if (m.fc === 'click' && i === this.cur) {
        o.onTap?.((m as MessageOf<'click'>).target);
      }
    });
  }

  get current(): StageNode | null {
    return this.slots[this.cur]!.node;
  }
  get spare(): StageNode | null {
    return this.slots[1 - this.cur]!.node;
  }
  /** The frame id on show (for tests and the edge inspector). */
  get currentFrameId(): string | null {
    return this.slots[this.cur]!.frameId;
  }

  /** Stack order: `top` = which of A (current) / B (spare) paints on top; dim sits just under it. */
  private layer(top: 'a' | 'b') {
    const a = this.slots[this.cur]!.el;
    const b = this.slots[1 - this.cur]!.el;
    a.style.zIndex = top === 'a' ? '3' : '1';
    b.style.zIndex = top === 'b' ? '3' : '1';
    this.dim.style.zIndex = '2';
    a.style.pointerEvents = 'auto';
    b.style.pointerEvents = 'none';
    a.style.visibility = 'visible';
  }

  private load(slot: Slot, node: StageNode): Promise<void> {
    const { host, origin } = this.o;
    if (slot.frameId) host.unregister(slot.frameId);
    const frameId = `stage~${node.screen.id}~${node.state}~${Math.random().toString(36).slice(2, 8)}`;
    slot.frameId = frameId;
    slot.node = node;
    slot.isReady = false;
    host.register(frameId, { screen: node.screen.id, state: node.state, path: node.screen.path }, slot.el);
    slot.ready = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(cap);
        offReady();
        slot.el.removeEventListener('load', onLoad);
        if (slot.frameId === frameId) {
          slot.isReady = true;
          if (this.slots[this.cur] === slot) this.o.onReady?.(node);
        }
        resolve();
      };
      const cap = setTimeout(finish, READY_CAP_MS);
      const offReady = host.subscribe((f, m) => f.frameId === frameId && m.fc === 'ready' && finish());
      const onLoad = () => {
        if (slot.el.src === 'about:blank') return;
        setTimeout(() => {
          // Without the SDK there is no app-driven `ready`; reveal 300 ms after load.
          if (!host.frames.get(frameId)?.hasSdk) finish();
        }, NO_SDK_READY_MS);
      };
      slot.el.addEventListener('load', onLoad);
    });
    slot.el.name = WINDOW_NAME_PREFIX + frameId;
    slot.el.src = frameUrl(origin, node.screen.path, frameId, node.state);
    return slot.ready;
  }

  /** Show a node with no transition (first screen, restart). */
  show(node: StageNode): Promise<void> {
    return this.go(node, null);
  }

  /** Make sure the spare holds `node` (preloaded underneath), without showing it. */
  preload(node: StageNode): Promise<void> {
    const spare = this.slots[1 - this.cur]!;
    if (sameNode(spare.node, node)) return spare.ready;
    return this.load(spare, node);
  }

  /**
   * Transition to `node` with `edge`'s settings (reverse = Back). Calls queue:
   * a new call while one animates finishes the running animation first.
   */
  go(node: StageNode, edge: Pick<Edge, 'transition'> | null, reverse = false): Promise<void> {
    for (const a of this.anims) a.finish();
    const run = this.busy.then(() => this.run(node, edge, reverse));
    this.busy = run.catch(() => undefined);
    return run;
  }

  private async run(node: StageNode, edge: Pick<Edge, 'transition'> | null, reverse: boolean) {
    if (this.destroyed) return;
    const a = this.slots[this.cur]!;
    const b = this.slots[1 - this.cur]!;
    if (!a.node) {
      // First screen: load straight into A.
      this.layer('a');
      await this.load(a, node);
      return;
    }
    if (sameNode(a.node, node) && !edge) return;
    if (!sameNode(b.node, node) || !b.isReady) {
      if (!sameNode(b.node, node)) void this.load(b, node);
      await b.ready;
    }
    if (this.destroyed) return;
    const plan: TransitionPlan = edge
      ? planForEdge(edge, reverse, prefersReducedMotion())
      : { top: 'b', a: null, b: null, dim: null, duration: 0, easing: 'linear' };
    await this.animate(plan);
    this.cur = 1 - this.cur;
    this.layer('a');
    if (this.slots[this.cur]!.isReady) this.o.onReady?.(node);
  }

  private async animate(plan: TransitionPlan) {
    const a = this.slots[this.cur]!.el;
    const b = this.slots[1 - this.cur]!.el;
    this.layer(plan.top);
    if (!plan.duration) return;
    const opts: KeyframeAnimationOptions = { duration: plan.duration, easing: plan.easing, fill: 'both' };
    a.style.willChange = b.style.willChange = 'transform, opacity';
    this.anims = [];
    if (plan.a) this.anims.push(a.animate(plan.a, opts));
    if (plan.b) this.anims.push(b.animate(plan.b, opts));
    if (plan.dim) this.anims.push(this.dim.animate(plan.dim, opts));
    await Promise.all(this.anims.map((x) => x.finished.catch(() => undefined)));
    // Settle: the new top is at rest, so drop the fills (old A goes under as the spare).
    for (const x of this.anims) x.cancel();
    this.anims = [];
    a.style.willChange = b.style.willChange = '';
  }

  /** Re-send intercept selectors (edges changed). */
  refreshIntercepts() {
    for (const s of this.slots) if (s.frameId && s.node) this.o.host.send(s.frameId, { fc: 'record', on: false, intercept: this.o.interceptFor(s.node) });
  }

  /** Swap A and B instantly (loop replay: B still holds the start screen). */
  resetTo(node: StageNode): Promise<void> {
    return this.go(node, null);
  }

  destroy() {
    this.destroyed = true;
    for (const x of this.anims) x.cancel();
    this.off();
    for (const s of this.slots) {
      if (s.frameId) this.o.host.unregister(s.frameId);
      s.el.src = 'about:blank';
      s.el.remove();
    }
    this.dim.remove();
  }
}
