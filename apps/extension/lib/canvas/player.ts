/**
 * Player board layout (UI_REFERENCE "Player mode"): a vertically scrolling
 * board; each section is a horizontal row of device frames with the trigger
 * text in the gaps. Mobile: one frame per screen (extra states drawn as a
 * stack behind it). Desktop: every state of a screen gets its own frame.
 * Coordinates are unscaled board pixels.
 */
import { frameKey, type Device, type Edge, type FlowCanvasConfig, type Screen } from '@flowcanvas/config';
import { chromeInsets } from './geometry';
import { screensBySection } from './layout';

export const BOARD_PAD = 64;
export const ROW_TITLE_H = 56;
export const ITEM_HEADER_H = 26;
export const ITEM_GAP = 150;
export const ROW_GAP = 110;

export interface PlayerItem {
  key: string;
  screen: Screen;
  state: string;
  /** Extra states drawn as stacked cards behind (mobile only). */
  stack: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Edge to the next item in the row, if one exists. */
  next: Edge | null;
}

export interface PlayerRow {
  id: string;
  title: string;
  summary: string;
  y: number;
  items: PlayerItem[];
}

export function deviceBox(d: Device): { w: number; h: number } {
  const i = chromeInsets(d);
  return { w: d.w + 2 * i.side, h: i.top + d.h + i.bottom + 2 * i.side };
}

/** Edge from a screen (any state, preferring `state`) to another screen. */
export function edgeBetween(c: FlowCanvasConfig, from: Screen, state: string, to: Screen): Edge | null {
  const all = c.edges.filter((e) => e.from.screen === from.id && e.to.screen === to.id);
  return all.find((e) => e.from.state === state) ?? all[0] ?? null;
}

export function outgoing(c: FlowCanvasConfig, screen: string, state: string): Edge[] {
  return c.edges.filter((e) => e.from.screen === screen && e.from.state === state);
}

export function playerLayout(c: FlowCanvasConfig, d: Device): { rows: PlayerRow[]; w: number; h: number } {
  const mobile = d.chrome !== 'none';
  const box = deviceBox(d);
  const rows: PlayerRow[] = [];
  let y = BOARD_PAD;
  let maxW = 0;
  for (const g of screensBySection(c)) {
    if (!g.screens.length) continue;
    const items: PlayerItem[] = [];
    let x = BOARD_PAD + 40;
    const fy = y + ROW_TITLE_H + ITEM_HEADER_H;
    const entries: Array<{ screen: Screen; state: string; stack: number }> = [];
    for (const s of g.screens) {
      if (mobile) entries.push({ screen: s, state: s.states[0] ?? 'default', stack: Math.min(2, s.states.length - 1) });
      else for (const st of s.states) entries.push({ screen: s, state: st, stack: 0 });
    }
    entries.forEach((e, i) => {
      const nextE = entries[i + 1];
      const next = nextE && nextE.screen.id !== e.screen.id ? edgeBetween(c, e.screen, e.state, nextE.screen) : null;
      items.push({ key: frameKey(e.screen.id, e.state), ...e, x, y: fy, w: box.w, h: box.h, next });
      x += box.w + ITEM_GAP;
    });
    const first = g.screens[0]!.title;
    const last = g.screens[g.screens.length - 1]!.title;
    const n = g.screens.length;
    rows.push({ id: g.id, title: g.title, summary: `${n} step${n === 1 ? '' : 's'}${n > 1 ? ` · ${first} → ${last}` : ''}`, y, items });
    maxW = Math.max(maxW, x - ITEM_GAP + BOARD_PAD);
    y = fy + box.h + 24 + ROW_GAP;
  }
  return { rows, w: maxW, h: y };
}

const VERB: Partial<Record<Edge['trigger']['gesture'], string>> = {
  tap: 'Tap',
  'long-press': 'Long-press',
  submit: 'Submit',
  'swipe-left': 'Swipe left',
  'swipe-right': 'Swipe right',
  'swipe-up': 'Swipe up',
  'swipe-down': 'Swipe down',
};

/** `Tap "Get started"`, `Submit "Continue"`, or the bare label for auto edges. */
export function triggerText(e: Edge): string {
  const verb = VERB[e.trigger.gesture];
  const label = e.trigger.label || e.trigger.target || '';
  if (!verb) return label || 'Automatically';
  return label ? `${verb} "${label}"` : verb;
}

export function edgeMeta(e: Edge): string {
  return `${e.trigger.gesture} · ${e.transition.type} · ${e.transition.duration}ms`;
}
