import type { Device, FlowCanvasConfig, Screen, Section } from '@flowcanvas/config';
import { frameKey } from '@flowcanvas/config';
import { REF_SLOT, SECTION_PAD, SECTION_TITLE_H, frameOuter, slot, toRender } from './geometry';

export interface Point {
  x: number;
  y: number;
}

export const NO_SECTION = '__none__';

export function orderedSections(c: FlowCanvasConfig): Section[] {
  return [...c.sections].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** Screens grouped by section id (NO_SECTION for none), in section order. */
export function screensBySection(c: FlowCanvasConfig): Array<{ id: string; title: string; screens: Screen[] }> {
  const out: Array<{ id: string; title: string; screens: Screen[] }> = [];
  for (const s of orderedSections(c)) out.push({ id: s.id, title: s.title, screens: c.screens.filter((x) => x.section === s.id) });
  const known = new Set(c.sections.map((s) => s.id));
  const rest = c.screens.filter((x) => !x.section || !known.has(x.section));
  if (rest.length) out.push({ id: NO_SECTION, title: 'No section', screens: rest });
  return out;
}

/**
 * Lay out a list of screens starting at `origin` (reference units).
 * One screen per line when any has several states (states sit in a row);
 * otherwise a grid, `perRow` per row.
 */
export function gridPositions(screens: Screen[], origin: Point, perRow = 3): Map<string, Point> {
  const out = new Map<string, Point>();
  const rowMode = screens.some((s) => s.states.length > 1);
  screens.forEach((s, i) => {
    if (rowMode) out.set(s.id, { x: origin.x, y: origin.y + i * REF_SLOT.h });
    else out.set(s.id, { x: origin.x + (i % perRow) * REF_SLOT.w, y: origin.y + Math.floor(i / perRow) * REF_SLOT.h });
  });
  return out;
}

function rowsUsed(screens: Screen[], perRow = 3): number {
  if (!screens.length) return 0;
  return screens.some((s) => s.states.length > 1) ? screens.length : Math.ceil(screens.length / perRow);
}

/** Bottom edge (reference units) of all explicitly positioned screens. */
export function contentBottom(c: FlowCanvasConfig): number {
  let max = -Infinity;
  for (const s of c.screens) if (s.position) max = Math.max(max, s.position.y + REF_SLOT.h);
  return max === -Infinity ? 0 : max;
}

const SECTION_GAP = SECTION_TITLE_H + SECTION_PAD * 2;

/** Positions for every screen: explicit ones as stored, missing ones auto-laid per section below existing content. */
export function resolvePositions(c: FlowCanvasConfig): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const s of c.screens) if (s.position) out.set(s.id, s.position);
  let y = c.screens.some((s) => s.position) ? contentBottom(c) + SECTION_GAP : 0;
  for (const group of screensBySection(c)) {
    const missing = group.screens.filter((s) => !s.position);
    if (!missing.length) continue;
    for (const [id, p] of gridPositions(missing, { x: 0, y })) out.set(id, p);
    y += rowsUsed(missing) * REF_SLOT.h + SECTION_GAP;
  }
  return out;
}

export interface FrameBox {
  key: string;
  screenId: string;
  state: string;
  stateIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SectionBox {
  id: string;
  title: string;
  color: string;
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Render-space boxes for every screen × state frame and every section band. */
export function layoutFrames(c: FlowCanvasConfig, device: Device): { frames: FrameBox[]; sections: SectionBox[] } {
  const pos = resolvePositions(c);
  const outer = frameOuter(device);
  const sl = slot(device);
  const frames: FrameBox[] = [];
  for (const s of c.screens) {
    const p = toRender(pos.get(s.id) ?? { x: 0, y: 0 }, device);
    s.states.forEach((state, i) => {
      frames.push({ key: frameKey(s.id, state), screenId: s.id, state, stateIndex: i, x: p.x + i * sl.w, y: p.y, w: outer.w, h: outer.h });
    });
  }
  const sections: SectionBox[] = [];
  for (const sec of c.sections) {
    const members = frames.filter((f) => c.screens.find((s) => s.id === f.screenId)?.section === sec.id);
    if (!members.length) continue;
    const x0 = Math.min(...members.map((f) => f.x)) - SECTION_PAD;
    const y0 = Math.min(...members.map((f) => f.y)) - SECTION_PAD - SECTION_TITLE_H;
    const x1 = Math.max(...members.map((f) => f.x + f.w)) + SECTION_PAD;
    const y1 = Math.max(...members.map((f) => f.y + f.h)) + SECTION_PAD;
    const count = new Set(members.map((m) => m.screenId)).size;
    sections.push({ id: sec.id, title: sec.title, color: sec.color, count, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return { frames, sections };
}
