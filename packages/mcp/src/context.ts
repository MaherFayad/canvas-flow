import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FlowCanvasConfig } from '@flowcanvas/config';
import type { CanvasLink } from './link.js';
import type { ProjectStore } from './store.js';
import type { RequestQueue } from './requests.js';
import { ToolError, type Logger } from './log.js';

export interface ServerContext {
  store: ProjectStore;
  /** null when the WebSocket link is disabled. */
  link: CanvasLink | null;
  log: Logger;
  version: string;
  /** Pending canvas requests ("Discover with Claude"). */
  requests: RequestQueue;
}

export const CACHE_DIR = '.flowcanvas/cache';

export function originOf(ctx: ServerContext): string {
  try {
    return ctx.store.get().project.origin;
  } catch {
    return ctx.store.defaultOrigin;
  }
}

export function requireCanvas(ctx: ServerContext): CanvasLink {
  if (!ctx.link || !ctx.link.linked) {
    throw new ToolError(`Open the Flow Canvas tab for ${originOf(ctx)} to use this tool. (No canvas is linked to this MCP server.)`);
  }
  ctx.link.assertReady();
  return ctx.link;
}

export function canvasReady(ctx: ServerContext): boolean {
  return !!ctx.link && ctx.link.ready;
}

export function assertNotPaused(ctx: ServerContext): void {
  if (ctx.link?.paused) {
    throw new ToolError(
      'Claude is paused on the Flow Canvas tab ("Pause Claude" is on), so write tools are blocked. Ask the user to turn it off, then try again. Read tools still work.',
    );
  }
}

export interface Screenshot {
  data: string; // base64
  mimeType: string;
  source: 'canvas' | 'cache';
  device: string | null;
  file?: string;
}

export function cacheFile(screenId: string, state: string, device: string): string {
  return `${CACHE_DIR}/${screenId}-${state}-${device}.webp`;
}

/** Screenshot from the canvas, or the last cached still at .flowcanvas/cache/<screen>-<state>-<device>.webp. */
export async function getScreenshot(ctx: ServerContext, screenId: string, state: string, device?: string): Promise<Screenshot> {
  const cfg = ctx.store.get();
  const screen = cfg.screens.find((s) => s.id === screenId);
  if (!screen) throw new ToolError(`Unknown screen "${screenId}". Known: ${cfg.screens.map((s) => s.id).join(', ') || '(none)'}.`);
  if (!screen.states.includes(state)) throw new ToolError(`Screen "${screenId}" has no state "${state}". States: ${screen.states.join(', ')}.`);
  if (device && !cfg.devices.some((d) => d.id === device)) {
    throw new ToolError(`Unknown device "${device}". Devices: ${cfg.devices.map((d) => d.id).join(', ')}.`);
  }

  let canvasError: string | null = null;
  if (ctx.link?.ready) {
    try {
      const r = await ctx.link.request('get_screenshot', { screenId, state, ...(device ? { device } : {}) }, 30_000);
      const data = r.webp.replace(/^data:image\/[a-z+]+;base64,/, '');
      const dev = r.device ?? device ?? null;
      if (dev) {
        const rel = cacheFile(screenId, state, dev);
        const abs = path.join(ctx.store.dir, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, Buffer.from(data, 'base64')).catch(() => undefined);
      }
      return { data, mimeType: 'image/webp', source: 'canvas', device: dev };
    } catch (e) {
      canvasError = (e as Error).message;
    }
  }

  const cached = await findCached(ctx, cfg, screenId, state, device);
  if (cached) {
    const buf = await fs.readFile(path.join(ctx.store.dir, cached.file));
    return { data: buf.toString('base64'), mimeType: 'image/webp', source: 'cache', device: cached.device, file: cached.file };
  }
  if (canvasError) throw new ToolError(`${canvasError} No cached still for ${screenId}:${state} either.`);
  throw new ToolError(
    `Open the Flow Canvas tab for ${originOf(ctx)} to use this tool. No cached still for ${screenId}:${state} in ${CACHE_DIR}/ either.`,
  );
}

async function findCached(
  ctx: ServerContext,
  cfg: FlowCanvasConfig,
  screenId: string,
  state: string,
  device?: string,
): Promise<{ file: string; device: string } | null> {
  const candidates = device ? [device] : cfg.devices.map((d) => d.id);
  for (const d of candidates) {
    const rel = cacheFile(screenId, state, d);
    if (await exists(path.join(ctx.store.dir, rel))) return { file: rel, device: d };
  }
  if (device) return null;
  // Any device: <screen>-<state>-<device>.webp
  const dir = path.join(ctx.store.dir, CACHE_DIR);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const prefix = `${screenId}-${state}-`;
  const hit = names.find((n) => n.startsWith(prefix) && n.endsWith('.webp'));
  return hit ? { file: `${CACHE_DIR}/${hit}`, device: hit.slice(prefix.length, -'.webp'.length) } : null;
}

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(
    (s) => s.isFile(),
    () => false,
  );
}
