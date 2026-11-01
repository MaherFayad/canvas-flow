/**
 * Answers to the MCP server's `request` messages (canvas-only tools and
 * confirm prompts). Results match CanvasResultSchemas in the link protocol.
 */
import { frameKey, type Edge, type FlowCanvasConfig } from '@flowcanvas/config';
import type { MessageOf } from '@flowcanvas/protocol';
import type { CanvasMethod } from '@flowcanvas/mcp/link-protocol';
import { useProject } from '@/store/project';
import { deviceById, useUi } from '@/store/ui';
import { useClaude } from '@/store/claude';
import type { FrameHost } from './frameHost';
import { liveFrame } from './liveFrame';
import { descendants } from './sections';
import { stillFor } from './stillsAdapter';

/** Hooks the Canvas component registers (camera, selection). */
export const canvasApi: {
  focus: ((itemId: string) => boolean) | null;
  selection: (() => { ids: string[]; items: Array<{ id: string; type: string }> }) | null;
} = { focus: null, selection: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`Missing ${name}.`);
  return v;
};

/** Edges to play: a section's (and its sub-sections') edges, or the given ids, in order. */
export function flowEdges(c: FlowCanvasConfig, p: { sectionId?: string; edgeIds?: string[] }): Edge[] {
  if (p.edgeIds?.length) return p.edgeIds.map((id) => c.edges.find((e) => e.id === id)).filter((e): e is Edge => !!e);
  if (!p.sectionId) return [];
  const inside = descendants(c, p.sectionId);
  const order = c.screens.filter((s) => s.section && inside.has(s.section)).map((s) => s.id);
  const rank = new Map(order.map((id, i) => [id, i]));
  return c.edges
    .filter((e) => rank.has(e.from.screen))
    .sort((a, b) => rank.get(a.from.screen)! - rank.get(b.from.screen)! || (rank.get(a.to.screen) ?? 99) - (rank.get(b.to.screen) ?? 99));
}

async function query(host: FrameHost, screen: string, state: string, selector: string) {
  const f = await liveFrame(host, screen, state);
  if (!f) return null;
  return host.request<MessageOf<'query-result'>>(f.frameId, { fc: 'query', id: '', selector }, 4000);
}

async function readBaseTokens(host: FrameHost) {
  const ui = useUi.getState();
  if (ui.baseTokens?.length) return ui.baseTokens;
  const f = [...host.frames.values()].find((x) => !x.discover && x.nonce && x.ready);
  if (f) host.send(f.frameId, { fc: 'tokens-request' });
  for (let i = 0; i < 25; i++) {
    const t = useUi.getState().baseTokens;
    if (t?.length) return t;
    await sleep(120);
  }
  return useUi.getState().baseTokens ?? [];
}

export function confirmOnCanvas(action: 'delete' | 'set_tokens', message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `cf-${Date.now().toString(36)}`;
    const c = useClaude.getState();
    c.set({ confirms: [...c.confirms, { id, action, message, resolve }] });
    useUi.getState().set({ announce: `${message}. Allow or Deny.` });
  });
}

export async function handleRequest(host: FrameHost | null, method: CanvasMethod, params: Record<string, unknown>): Promise<unknown> {
  const config = useProject.getState().config;
  switch (method) {
    case 'confirm': {
      const action = params.action === 'set_tokens' ? 'set_tokens' : 'delete';
      return { allowed: await confirmOnCanvas(action, String(params.message ?? 'Claude wants to make a change')) };
    }
    case 'focus': {
      const id = str(params.itemId, 'itemId');
      if (useUi.getState().mode !== 'canvas') {
        useUi.getState().set({ mode: 'canvas' });
        await sleep(400);
      }
      for (let i = 0; i < 10 && !canvasApi.focus; i++) await sleep(100);
      return { ok: canvasApi.focus?.(id) ?? false };
    }
    case 'get_selection': {
      const sel = canvasApi.selection?.();
      if (sel) return sel;
      const e = useUi.getState().selectedEdge;
      return { ids: e ? [e] : [], items: e ? [{ id: e, type: 'edge' }] : [] };
    }
    case 'get_tokens': {
      if (!host) throw new Error('No frames are connected.');
      return { base: await readBaseTokens(host), overrides: config.tokens };
    }
    case 'set_tokens': {
      if (!host) throw new Error('No frames are connected.');
      const vars = (params.vars ?? {}) as Record<string, string | null>;
      const base = new Set((await readBaseTokens(host)).map((t) => t.name));
      const live: Record<string, string> = {};
      for (const [k, v] of Object.entries(vars)) live[k] = v ?? '';
      host.broadcast({ fc: 'tokens', vars: live });
      const names = Object.keys(vars);
      return { applied: names.filter((n) => base.has(n)), unknown: names.filter((n) => !base.has(n)) };
    }
    case 'check_target': {
      if (!host) throw new Error('No frames are connected.');
      const screen = str(params.screenId, 'screenId');
      const state = typeof params.state === 'string' ? params.state : 'default';
      const r = await query(host, screen, state, str(params.selector, 'selector'));
      if (!r) throw new Error(`The ${screen} · ${state} frame did not load. Open Canvas mode and make sure its section is not collapsed.`);
      return { found: r.found, rect: r.rect, count: r.found ? 1 : 0 };
    }
    case 'get_screenshot': {
      const screen = str(params.screenId, 'screenId');
      const state = typeof params.state === 'string' ? params.state : 'default';
      const device = typeof params.device === 'string' ? params.device : deviceById(config.devices, useUi.getState().deviceId).id;
      return stillFor(screen, state, device);
    }
    case 'play_flow': {
      if (!host) throw new Error('No frames are connected.');
      const edges = flowEdges(config, { sectionId: params.sectionId as string | undefined, edgeIds: params.edgeIds as string[] | undefined });
      const steps: Array<{ edgeId: string; ok: boolean; error?: string }> = [];
      const screens = new Set(config.screens.map((s) => s.id));
      for (const e of edges) {
        if (!screens.has(e.to.screen)) {
          steps.push({ edgeId: e.id, ok: false, error: `Unknown target screen ${e.to.screen}` });
          continue;
        }
        const target = e.trigger.target;
        if (!target) {
          steps.push({ edgeId: e.id, ok: true });
          continue;
        }
        const r = await query(host, e.from.screen, e.from.state, target);
        if (!r) steps.push({ edgeId: e.id, ok: false, error: `${frameKey(e.from.screen, e.from.state)} did not load` });
        else if (!r.found) steps.push({ edgeId: e.id, ok: false, error: `Target ${target} not found on ${frameKey(e.from.screen, e.from.state)}` });
        else steps.push({ edgeId: e.id, ok: true });
      }
      return { pass: steps.every((s) => s.ok), steps };
    }
  }
}
