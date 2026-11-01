import { EdgeSchema, id as newId, toKebab, type Edge, type FlowCanvasConfig, type Screen } from '@flowcanvas/config';
import { normPath } from '../url';
import { REF_SLOT } from './geometry';
import { resolvePositions, type Point } from './layout';

/** Screen whose path matches: exact path+query first, then pathname only. */
export function screenForPath(c: FlowCanvasConfig, path: string): Screen | undefined {
  const p = normPath(path);
  const exact = c.screens.find((s) => normPath(s.path) === p);
  if (exact) return exact;
  const bare = p.split('?')[0];
  return c.screens.find((s) => normPath(s.path).split('?')[0] === bare);
}

export function uniqueScreenId(c: FlowCanvasConfig, path: string): string {
  const bare = normPath(path).split('?')[0] ?? '/';
  const base = bare === '/' ? 'home' : toKebab(bare);
  let idc = base;
  let n = 2;
  while (c.screens.some((s) => s.id === idc)) idc = `${base}-${n++}`;
  return idc;
}

export function titleFromPath(path: string): string {
  const bare = normPath(path).split('?')[0] ?? '/';
  if (bare === '/') return 'Home';
  const last = bare.split('/').filter(Boolean).pop() ?? bare;
  const words = last.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** First free reference-unit spot to the right of `from` on its row. */
function freeSpot(c: FlowCanvasConfig, from: Screen, positions: Map<string, Point>): Point {
  const base = positions.get(from.id) ?? { x: 0, y: 0 };
  const occupied = (p: Point) =>
    c.screens.some((s) => {
      const q = positions.get(s.id);
      if (!q) return false;
      const h = s.states.length * REF_SLOT.h;
      return p.x < q.x + REF_SLOT.w && p.x + REF_SLOT.w > q.x && p.y < q.y + h && p.y + REF_SLOT.h > q.y;
    });
  let p = { x: base.x + REF_SLOT.w, y: base.y };
  for (let i = 0; i < 50 && occupied(p); i++) p = { x: p.x + REF_SLOT.w, y: p.y };
  return p;
}

export interface RecordInput {
  from: { screen: string; state: string };
  toPath: string;
  click: { target: string; text: string };
}

export interface RecordResult {
  config: FlowCanvasConfig;
  edge: Edge | null;
  createdScreen: Screen | null;
}

/**
 * Record mode: a click followed by a nav makes an edge from the frame's
 * screen:state to the screen at the new path (created when unknown).
 * Pure: returns a new config, so the store applies it as one undo step.
 */
export function recordEdge(c: FlowCanvasConfig, input: RecordInput): RecordResult {
  const fromScreen = c.screens.find((s) => s.id === input.from.screen);
  if (!fromScreen) return { config: c, edge: null, createdScreen: null };
  let config = c;
  let target = screenForPath(c, input.toPath);
  let createdScreen: Screen | null = null;
  if (!target) {
    const positions = resolvePositions(c);
    createdScreen = {
      id: uniqueScreenId(c, input.toPath),
      title: titleFromPath(input.toPath),
      section: fromScreen.section,
      path: normPath(input.toPath),
      states: ['default'],
      position: freeSpot(c, fromScreen, positions),
    };
    // Pin the source's auto position too, so the new screen does not shift it.
    const screens = c.screens.map((s) => (s.position ? s : { ...s, position: positions.get(s.id) }));
    config = { ...c, screens: [...screens, createdScreen] };
    target = createdScreen;
  }
  const dup = config.edges.find(
    (e) =>
      e.from.screen === input.from.screen &&
      e.from.state === input.from.state &&
      e.to.screen === target!.id &&
      (e.trigger.target ?? '') === input.click.target,
  );
  if (dup) return { config, edge: null, createdScreen };
  const edge = EdgeSchema.parse({
    id: newId('e'),
    from: { screen: input.from.screen, state: input.from.state },
    to: { screen: target.id, state: target.states[0] ?? 'default' },
    trigger: { label: input.click.text, gesture: 'tap', target: input.click.target },
  });
  return { config: { ...config, edges: [...config.edges, edge] }, edge, createdScreen };
}
