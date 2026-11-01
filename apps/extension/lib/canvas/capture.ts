/**
 * Screenshots, canvas side (feature 8).
 *
 * - One still per `screen:state:device`, stored in IndexedDB (extension
 *   origin, `unlimitedStorage`) with a hash of what it shows (frame URL,
 *   device size, effective tokens). A still is fresh while the hash matches
 *   and no hot reload marked it stale.
 * - Queue: at most 3 captures at once. A frame that is already live and ready
 *   is captured in place; anything else gets a short-lived hidden iframe.
 * - Re-capture: missing/stale stills after load, after a device switch,
 *   1 s after token edits settle, and 1 s after an HMR signal.
 *
 * Public API for other modules (e.g. the MCP link's get_screenshot):
 * `getStill(screenId, state, deviceId)` and `captureNow(screenId, state, deviceId)`.
 */
import { create } from 'zustand';
import { DEVICE_PRESETS, type Device, type FlowCanvasConfig } from '@flowcanvas/config';
import { frameUrl, type MessageOf } from '@flowcanvas/protocol';
import { WINDOW_NAME_PREFIX } from '../frame';
import type { FrameHost } from './frameHost';

export const CAPTURE_SCALE = 0.5;
export const CAPTURE_QUALITY = 0.8;
export const MAX_PARALLEL = 3;
export const SETTLE_MS = 1000;
const READY_TIMEOUT_MS = 10000;
const CAPTURE_TIMEOUT_MS = 15000;
const DB_NAME = 'flowcanvas-stills';
const STORE = 'stills';

export interface StillRecord {
  /** `${origin}|${screen}:${state}:${device}` */
  id: string;
  webp: string;
  hash: string;
  at: number;
  stale?: boolean;
}

export interface Still {
  url: string;
  fresh: boolean;
}

export interface CaptureProgress {
  running: boolean;
  done: number;
  total: number;
  failed: number;
  paused: boolean;
}

export const useStills = create<{ stills: Record<string, Still>; progress: CaptureProgress }>()(() => ({
  stills: {},
  progress: { running: false, done: 0, total: 0, failed: 0, paused: false },
}));

export const stillKey = (screen: string, state: string, device: string) => `${screen}:${state}:${device}`;

export function useStill(screen: string, state: string, device: string): string | null {
  return useStills((s) => s.stills[stillKey(screen, state, device)]?.url ?? null);
}

/** FNV-1a, 32-bit, hex. Enough to tell "same URL + size + tokens" apart. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function stillHash(origin: string, path: string, state: string, device: Pick<Device, 'w' | 'h'>, tokens: Record<string, string>): string {
  const t = Object.keys(tokens)
    .sort()
    .map((k) => `${k}=${tokens[k]}`)
    .join(';');
  return hashString(`${origin}${path}|${state}|${device.w}x${device.h}|${t}`);
}

/** Keys of every frame for a device that has no fresh still. */
export function missingStills(
  config: FlowCanvasConfig,
  device: Device,
  have: Record<string, StillRecord | undefined>,
  hashOf: (path: string, state: string) => string,
): Array<{ screen: string; state: string; path: string; hash: string }> {
  const out: Array<{ screen: string; state: string; path: string; hash: string }> = [];
  for (const s of config.screens) {
    for (const st of s.states) {
      const hash = hashOf(s.path, st);
      const r = have[stillKey(s.id, st, device.id)];
      if (!r || r.stale || r.hash !== hash) out.push({ screen: s.id, state: st, path: s.path, hash });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */

let dbP: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbP ??= new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbP;
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return db().then(
    (d) =>
      new Promise<T | null>((resolve) => {
        if (!d) return resolve(null);
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r ? (r.result as T) : null);
        t.onerror = () => resolve(null);
      }),
  );
}
const idbAll = () => tx<StillRecord[]>('readonly', (s) => s.getAll()).then((r) => r ?? []);
const idbPut = (r: StillRecord) => tx('readwrite', (s) => void s.put(r));
const idbGet = (id: string) => tx<StillRecord | undefined>('readonly', (s) => s.get(id));
const idbDelete = (ids: string[]) => tx('readwrite', (s) => void ids.forEach((id) => s.delete(id)));

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export interface CaptureContext {
  host: FrameHost;
  origin: string;
  config(): FlowCanvasConfig;
  device(): Device;
  tokens(): Record<string, string>;
}

interface Job {
  screen: string;
  state: string;
  path: string;
  device: Device;
  hash: string;
  resolve: (url: string | null) => void;
}

let ctx: CaptureContext | null = null;
/** In-memory copy of this origin's records, keyed by stillKey. */
let records: Record<string, StillRecord> = {};
let queue: Job[] = [];
let active = 0;
/** Jobs running now, by `key|hash`, so a frame is never queued twice for the same content. */
const running = new Set<string>();
const jobId = (j: { screen: string; state: string; device: Device; hash: string }) => `${stillKey(j.screen, j.state, j.device.id)}|${j.hash}`;
let gen = 0;
let hiddenRoot: HTMLElement | null = null;

const recId = (key: string) => `${ctx?.origin ?? ''}|${key}`;

function publish() {
  const stills: Record<string, Still> = {};
  for (const [k, r] of Object.entries(records)) stills[k] = { url: r.webp, fresh: !r.stale };
  useStills.setState({ stills });
}
function setProgress(p: Partial<CaptureProgress>) {
  useStills.setState((s) => ({ progress: { ...s.progress, ...p } }));
}

function hashFor(path: string, state: string, device: Device): string {
  return ctx ? stillHash(ctx.origin, path, state, device, ctx.tokens()) : '';
}

function deviceFor(id: string): Device {
  return ctx?.config().devices.find((d) => d.id === id) ?? DEVICE_PRESETS.find((d) => d.id === id) ?? ctx?.device() ?? DEVICE_PRESETS[0]!;
}

function hidden(): HTMLElement {
  if (hiddenRoot?.isConnected) return hiddenRoot;
  hiddenRoot = document.createElement('div');
  hiddenRoot.setAttribute('aria-hidden', 'true');
  hiddenRoot.dataset.fcCapture = '';
  // In the viewport (so Chrome does not throttle the frames' rendering) but invisible and inert.
  Object.assign(hiddenRoot.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', overflow: 'visible', opacity: '0', pointerEvents: 'none', zIndex: '-1', contain: 'strict' });
  document.body.appendChild(hiddenRoot);
  return hiddenRoot;
}

async function captureVia(frameId: string): Promise<string | null> {
  const r = await ctx!.host.request<MessageOf<'capture-result'>>(frameId, { fc: 'capture', id: '', scale: CAPTURE_SCALE, quality: CAPTURE_QUALITY }, CAPTURE_TIMEOUT_MS);
  return r?.webp ?? null;
}

async function captureHidden(job: Job): Promise<string | null> {
  const host = ctx!.host;
  const frameId = `cap~${job.screen}~${job.state}~${Math.random().toString(36).slice(2, 8)}`;
  const iframe = document.createElement('iframe');
  iframe.name = WINDOW_NAME_PREFIX + frameId;
  iframe.width = String(job.device.w);
  iframe.height = String(job.device.h);
  iframe.tabIndex = -1;
  Object.assign(iframe.style, { position: 'absolute', left: '0', top: '0', border: '0', width: `${job.device.w}px`, height: `${job.device.h}px` });
  host.register(frameId, { screen: job.screen, state: job.state, path: job.path, discover: true }, iframe);
  const ready = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => (off(), resolve(false)), READY_TIMEOUT_MS);
    const off = host.subscribe((f, m) => {
      if (f.frameId === frameId && m.fc === 'ready') {
        clearTimeout(timer);
        off();
        resolve(true);
      }
    });
  });
  iframe.src = frameUrl(ctx!.origin, job.path, frameId, job.state);
  hidden().appendChild(iframe);
  try {
    if (!(await ready)) return null;
    return await captureVia(frameId);
  } finally {
    host.unregister(frameId);
    iframe.src = 'about:blank';
    iframe.remove();
  }
}

async function run(job: Job): Promise<string | null> {
  if (!ctx) return null;
  const cur = ctx.device();
  const live = cur.id === job.device.id ? ctx.host.framesFor(job.screen, job.state).find((f) => f.ready && f.nonce && f.currentPath === f.path) : undefined;
  let url: string | null = null;
  if (live) url = await captureVia(live.frameId);
  if (!url) url = await captureHidden(job);
  return url;
}

function pump() {
  const myGen = gen;
  while (active < MAX_PARALLEL && queue.length) {
    const job = queue.shift()!;
    active++;
    running.add(jobId(job));
    void run(job)
      .catch(() => null)
      .then(async (url) => {
        active--;
        running.delete(jobId(job));
        if (myGen !== gen) {
          job.resolve(url);
          return pump();
        }
        const key = stillKey(job.screen, job.state, job.device.id);
        if (url) {
          const rec: StillRecord = { id: recId(key), webp: url, hash: job.hash, at: Date.now() };
          records = { ...records, [key]: rec };
          publish();
          void idbPut(rec);
        }
        const p = useStills.getState().progress;
        setProgress({ done: p.done + 1, failed: p.failed + (url ? 0 : 1) });
        job.resolve(url);
        pump();
      });
  }
  if (!active && !queue.length) setProgress({ running: false });
}

function enqueue(items: Array<Omit<Job, 'resolve'>>, front = false): Array<Promise<string | null>> {
  const fresh = items.filter((it) => !running.has(jobId(it)) && !queue.some((q) => jobId(q) === jobId(it)));
  const promises: Array<Promise<string | null>> = [];
  const jobs = fresh.map((it) => {
    let resolve!: (u: string | null) => void;
    promises.push(new Promise((r) => (resolve = r)));
    return { ...it, resolve };
  });
  if (!jobs.length) return promises;
  const p = useStills.getState().progress;
  const base = p.running ? p : { done: 0, total: 0, failed: 0 };
  setProgress({ running: true, done: base.done, failed: base.failed, total: base.total + jobs.length });
  queue = front ? [...jobs, ...queue] : [...queue, ...jobs];
  pump();
  return promises;
}

/** Queue every frame of the current device without a fresh still. */
export function captureMissing(): number {
  if (!ctx || useStills.getState().progress.paused) return 0;
  const device = ctx.device();
  const items = missingStills(ctx.config(), device, records, (path, state) => hashFor(path, state, device));
  enqueue(items.map((i) => ({ ...i, device })));
  return items.length;
}

/** "Recapture all": drop the queue and capture every frame of the current device again. */
export function recaptureAll(): void {
  if (!ctx) return;
  gen++;
  for (const j of queue) j.resolve(null);
  queue = [];
  setProgress({ paused: false, running: false, done: 0, total: 0, failed: 0 });
  records = Object.fromEntries(Object.entries(records).map(([k, r]) => [k, { ...r, stale: true }]));
  publish();
  captureMissing();
}

/** Mark every still stale (hot reload); they keep showing until re-captured. */
export function markAllStale(): void {
  records = Object.fromEntries(Object.entries(records).map(([k, r]) => [k, { ...r, stale: true }]));
  publish();
  void Promise.all(Object.values(records).map((r) => idbPut(r)));
}

/** "Clear all screenshots" (PDPL data minimisation): delete this origin's stills and stop auto-capture until Recapture all. */
export async function clearAllStills(): Promise<number> {
  gen++;
  for (const j of queue) j.resolve(null);
  queue = [];
  const all = await idbAll();
  const mine = all.filter((r) => !ctx || r.id.startsWith(`${ctx.origin}|`)).map((r) => r.id);
  await idbDelete(mine);
  records = {};
  publish();
  setProgress({ running: false, done: 0, total: 0, failed: 0, paused: true });
  return mine.length;
}

/** Latest still for a frame (data URL), fresh or not; null when none was ever captured. */
export async function getStill(screenId: string, state: string, deviceId: string): Promise<string | null> {
  const key = stillKey(screenId, state, deviceId);
  if (records[key]) return records[key]!.webp;
  const r = await idbGet(recId(key));
  return r?.webp ?? null;
}

/** Capture one frame now (ahead of the queue) and return its data URL, or null on failure. */
export async function captureNow(screenId: string, state: string, deviceId: string): Promise<string | null> {
  if (!ctx) return null;
  const screen = ctx.config().screens.find((s) => s.id === screenId);
  if (!screen || !screen.states.includes(state)) return null;
  const device = deviceFor(deviceId);
  const key = stillKey(screenId, state, device.id);
  const before = records[key];
  const [p] = enqueue([{ screen: screenId, state, path: screen.path, device, hash: hashFor(screen.path, state, device) }], true);
  if (p) return p;
  // Already being captured: wait for that capture to land.
  return new Promise((resolve) => {
    const timer = setTimeout(() => (off(), resolve(records[key]?.webp ?? null)), CAPTURE_TIMEOUT_MS + READY_TIMEOUT_MS);
    const off = useStills.subscribe(() => {
      if (records[key] && records[key] !== before) {
        clearTimeout(timer);
        off();
        resolve(records[key]!.webp);
      }
    });
  });
}

/**
 * Start the engine for one canvas page. Returns a cleanup.
 * `watch` lets the caller (App) feed the triggers: token changes, device switch, config changes.
 */
export function initCapture(c: CaptureContext): { stop(): void; changed(reason: 'tokens' | 'device' | 'config'): void } {
  ctx = c;
  gen++;
  queue = [];
  active = 0;
  records = {};
  let settle: ReturnType<typeof setTimeout> | undefined;
  const later = (ms = SETTLE_MS) => {
    clearTimeout(settle);
    settle = setTimeout(captureMissing, ms);
  };
  void idbAll().then((all) => {
    if (ctx !== c) return;
    const prefix = `${c.origin}|`;
    for (const r of all) if (r.id.startsWith(prefix)) records[r.id.slice(prefix.length)] = r;
    publish();
    later(1500);
  });
  const off = c.host.subscribe((f, m) => {
    if (m.fc === 'hmr') {
      markAllStale();
      later();
    } else if (m.fc === 'ready' && !f.discover && !f.frameId.startsWith('stage~') && f.currentPath === f.path) {
      // A live frame just settled: if its still is missing or stale, take it from this frame now.
      const device = c.device();
      const screen = c.config().screens.find((s) => s.id === f.screen);
      if (!screen || useStills.getState().progress.paused) return;
      const hash = hashFor(screen.path, f.state, device);
      const r = records[stillKey(f.screen, f.state, device.id)];
      if (!r || r.stale || r.hash !== hash) enqueue([{ screen: f.screen, state: f.state, path: screen.path, device, hash }], true);
    }
  });
  const w = window as unknown as { __fc?: Record<string, unknown> };
  (w.__fc ??= {}).capture = { useStills, recaptureAll, captureMissing, clearAllStills, getStill, captureNow };
  return {
    stop() {
      off();
      clearTimeout(settle);
      gen++;
      queue = [];
      if (ctx === c) ctx = null;
      hiddenRoot?.remove();
    },
    changed(reason) {
      later(reason === 'tokens' ? SETTLE_MS : 300);
    },
  };
}
