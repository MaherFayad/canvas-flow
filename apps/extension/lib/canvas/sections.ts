/**
 * Sections (feature 9): named areas holding frames, images, notes and other
 * sections (nesting up to 3 levels). Pure functions over the config so they
 * are testable; the canvas renders their output.
 *
 * Units: like screen positions, section rects and image / note rects are
 * stored in reference units (see geometry.ts); positions scale to the current
 * device's slot, sizes of drawn section rects scale the same way.
 */
import { SECTION_COLORS, id as newId, sectionDepth, type Device, type FlowCanvasConfig, type Section } from '@flowcanvas/config';
import { GAP_Y, REF_DEVICE, REF_SLOT, SECTION_TITLE_H, frameOuter, slot, toRef, toRender } from './geometry';
import { resolvePositions, type FrameBox, type Point } from './layout';

export const MAX_DEPTH = 3;
export const SECTION_HEADER_H = SECTION_TITLE_H;
export const SECTION_INSET = 32;
export const COLLAPSED_H = 88;
export const GRID_GAP = 64;
export const GRID_PER_ROW = 3;

export type SectionColor = (typeof SECTION_COLORS)[number];

/** Colour + a word label (colour is never the only cue). */
export const SECTION_COLOR_META: Record<SectionColor, { label: string; chip: string; fill: string; line: string }> = {
  grey: { label: 'Grey', chip: '#9a9a9a', fill: 'rgba(255,255,255,0.28)', line: '#d6d6d6' },
  blue: { label: 'Blue', chip: '#3b82f6', fill: 'rgba(59,130,246,0.05)', line: '#bcd3fb' },
  green: { label: 'Green', chip: '#22a559', fill: 'rgba(34,165,89,0.05)', line: '#b6e2c6' },
  amber: { label: 'Amber', chip: '#d98a06', fill: 'rgba(217,138,6,0.06)', line: '#f0d29c' },
  red: { label: 'Red', chip: '#dc2626', fill: 'rgba(220,38,38,0.05)', line: '#f2bcbc' },
  purple: { label: 'Purple', chip: '#8b5cf6', fill: 'rgba(139,92,246,0.05)', line: '#d6c8fb' },
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SectionView extends Box {
  id: string;
  title: string;
  color: SectionColor;
  parent: string | null;
  depth: number;
  collapsed: boolean;
  locked: boolean;
  /** Hidden because an ancestor is collapsed. */
  hidden: boolean;
  counts: { screens: number; images: number; notes: number; sections: number };
}

export interface ItemBoxes {
  images: Map<string, Box>;
  notes: Map<string, Box>;
}

export interface BoardLayout {
  sections: SectionView[];
  /** Screens / images / notes / sections inside a collapsed section (not rendered; frames unmount). */
  hiddenScreens: Set<string>;
  hiddenImages: Set<string>;
  hiddenNotes: Set<string>;
  hiddenSections: Set<string>;
}

/* ------------------------------ tree ------------------------------ */

const byId = (c: FlowCanvasConfig) => new Map(c.sections.map((s) => [s.id, s]));

/** [id, parent, grandparent, …] (cycle-safe). */
export function chain(c: FlowCanvasConfig, id: string | null | undefined): string[] {
  const m = byId(c);
  const out: string[] = [];
  let cur = id ?? null;
  while (cur && m.has(cur) && !out.includes(cur)) {
    out.push(cur);
    cur = m.get(cur)!.parent;
  }
  return out;
}

/** The section and every section nested in it. */
export function descendants(c: FlowCanvasConfig, id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of c.sections) if (s.parent && out.has(s.parent) && !out.has(s.id)) (out.add(s.id), (grew = true));
  }
  return out;
}

/** Levels in the subtree rooted at id (a leaf is 1). */
export function subtreeHeight(c: FlowCanvasConfig, id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const kids = c.sections.filter((s) => s.parent === id);
  return 1 + Math.max(0, ...kids.map((k) => subtreeHeight(c, k.id, seen)));
}

/** Top-most collapsed section that hides items in `sectionId` (null when visible). */
export function collapsedOwner(c: FlowCanvasConfig, sectionId: string | null | undefined): string | null {
  const m = byId(c);
  let owner: string | null = null;
  for (const s of chain(c, sectionId)) if (m.get(s)!.collapsed) owner = s;
  return owner;
}

/** Can a section with a subtree of `height` levels live under `parent`? (max 3 levels, config enforces too) */
export function canNestUnder(c: FlowCanvasConfig, parent: string | null, height = 1): boolean {
  const d = parent ? sectionDepth(c, parent) : 0;
  return d + height <= MAX_DEPTH;
}

/* ------------------------------ layout ------------------------------ */

function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Section rect (reference units) → render box for `device`. */
export function rectToRender(r: Box, device: Device): Box {
  const p = toRender(r, device);
  const s = slot(device);
  return { x: p.x, y: p.y, w: (r.w * s.w) / REF_SLOT.w, h: (r.h * s.h) / REF_SLOT.h };
}

/** Render box → reference-unit rect. */
export function rectToRef(b: Box, device: Device): Box {
  const p = toRef(b, device);
  const s = slot(device);
  return { x: p.x, y: p.y, w: Math.round((b.w * REF_SLOT.w) / s.w), h: Math.round((b.h * REF_SLOT.h) / s.h) };
}

/**
 * Boxes for every section, bottom-up: a section hugs its frames, images,
 * notes and child sections (a collapsed child counts as its header bar),
 * plus its drawn rect. Collapsed = header bar only.
 */
export function sectionLayout(c: FlowCanvasConfig, device: Device, frames: FrameBox[], items: ItemBoxes): BoardLayout {
  const screenSection = new Map(c.screens.map((s) => [s.id, s.section]));
  const hiddenScreens = new Set<string>();
  const hiddenImages = new Set<string>();
  const hiddenNotes = new Set<string>();
  const hiddenSections = new Set<string>();
  for (const s of c.screens) if (collapsedOwner(c, s.section)) hiddenScreens.add(s.id);
  for (const i of c.images) if (collapsedOwner(c, i.section)) hiddenImages.add(i.id);
  for (const n of c.notes) if (collapsedOwner(c, n.section)) hiddenNotes.add(n.id);
  for (const s of c.sections) if (collapsedOwner(c, s.parent)) hiddenSections.add(s.id);

  const order = [...c.sections].sort((a, b) => sectionDepth(c, b.id) - sectionDepth(c, a.id));
  const visible = new Map<string, Box>();
  const views = new Map<string, SectionView>();
  for (const sec of order) {
    const content: Box[] = [];
    for (const f of frames) if (screenSection.get(f.screenId) === sec.id) content.push(f);
    for (const i of c.images) if (i.section === sec.id && !i.overlay && items.images.has(i.id)) content.push(items.images.get(i.id)!);
    for (const n of c.notes) if (n.section === sec.id && items.notes.has(n.id)) content.push(items.notes.get(n.id)!);
    const kids = c.sections.filter((s) => s.parent === sec.id);
    for (const k of kids) if (visible.has(k.id)) content.push(visible.get(k.id)!);
    const inner = union(content);
    const padded = inner && {
      x: inner.x - SECTION_INSET,
      y: inner.y - SECTION_INSET - SECTION_HEADER_H,
      w: inner.w + 2 * SECTION_INSET,
      h: inner.h + 2 * SECTION_INSET + SECTION_HEADER_H,
    };
    const drawn = sec.rect ? rectToRender(sec.rect, device) : null;
    const full = union([padded, drawn].filter((b): b is Box => !!b)) ?? { x: 0, y: 0, w: 640, h: 240 };
    const box = sec.collapsed ? { x: full.x, y: full.y, w: Math.max(480, Math.min(full.w, 1600)), h: COLLAPSED_H } : full;
    visible.set(sec.id, box);
    views.set(sec.id, {
      ...box,
      id: sec.id,
      title: sec.title,
      color: sec.color,
      parent: sec.parent,
      depth: sectionDepth(c, sec.id),
      collapsed: sec.collapsed,
      locked: sec.locked,
      hidden: hiddenSections.has(sec.id),
      counts: {
        screens: c.screens.filter((s) => s.section === sec.id).length,
        images: c.images.filter((i) => i.section === sec.id).length,
        notes: c.notes.filter((n) => n.section === sec.id).length,
        sections: kids.length,
      },
    });
  }
  // Parents first (render order: outer boxes behind inner ones).
  const sections = c.sections.map((s) => views.get(s.id)!).sort((a, b) => a.depth - b.depth);
  return { sections, hiddenScreens, hiddenImages, hiddenNotes, hiddenSections };
}

/** "3 steps" for screens only, else "N items". */
export function countLabel(v: Pick<SectionView, 'counts'>): string {
  const { screens, images, notes, sections } = v.counts;
  const total = screens + images + notes + sections;
  if (total === screens) return `${screens} ${screens === 1 ? 'step' : 'steps'}`;
  return `${total} ${total === 1 ? 'item' : 'items'}`;
}

/** Deepest visible section whose box contains the point. */
export function sectionAt(layout: BoardLayout, p: Point, exclude?: Set<string>): string | null {
  const hits = layout.sections.filter(
    (s) => !s.hidden && !exclude?.has(s.id) && p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h,
  );
  hits.sort((a, b) => b.depth - a.depth);
  return hits[0]?.id ?? null;
}

/* ------------------------------ edits ------------------------------ */

export interface Selection {
  screens?: string[];
  images?: string[];
  notes?: string[];
  sections?: string[];
}

export type EditResult = { ok: true; config: FlowCanvasConfig; id?: string } | { ok: false; error: string };

/** Pin every screen at its resolved spot (so auto-layout never reshuffles others), applying `fn` to some. */
function pinScreens(c: FlowCanvasConfig, move: (id: string, p: Point) => Point | null): FlowCanvasConfig['screens'] {
  const pos = resolvePositions(c);
  return c.screens.map((s) => {
    const p = pos.get(s.id) ?? s.position ?? { x: 0, y: 0 };
    const next = move(s.id, p);
    return next ? { ...s, position: next } : s.position ? s : { ...s, position: p };
  });
}

/**
 * Cmd/Ctrl+G: wrap the selected items in a new section. Its parent is the
 * items' common section (or `parent` when given); nesting is limited to 3.
 */
export function groupSelection(c: FlowCanvasConfig, sel: Selection, opts: { title?: string; parent?: string | null; rect?: Box } = {}): EditResult {
  const sections = new Set(sel.sections ?? []);
  // Items already inside a selected section come along with it.
  const inSelected = (sec: string | null | undefined) => chain(c, sec).some((x) => sections.has(x));
  const topSections = [...sections].filter((s) => !inSelected(c.sections.find((x) => x.id === s)?.parent));
  const screens = (sel.screens ?? []).filter((id) => !inSelected(c.screens.find((s) => s.id === id)?.section));
  const images = (sel.images ?? []).filter((id) => !inSelected(c.images.find((s) => s.id === id)?.section));
  const notes = (sel.notes ?? []).filter((id) => !inSelected(c.notes.find((s) => s.id === id)?.section));
  if (!topSections.length && !screens.length && !images.length && !notes.length && !opts.rect) {
    return { ok: false, error: 'Select frames, notes, images or sections to group.' };
  }
  const parents = new Set<string | null>([
    ...topSections.map((id) => c.sections.find((s) => s.id === id)?.parent ?? null),
    ...screens.map((id) => c.screens.find((s) => s.id === id)?.section ?? null),
    ...images.map((id) => c.images.find((s) => s.id === id)?.section ?? null),
    ...notes.map((id) => c.notes.find((s) => s.id === id)?.section ?? null),
  ]);
  const parent = opts.parent !== undefined ? opts.parent : parents.size === 1 ? [...parents][0]! : null;
  const height = 1 + Math.max(0, ...topSections.map((s) => subtreeHeight(c, s)));
  if (!canNestUnder(c, parent, height)) {
    return { ok: false, error: `Sections nest up to ${MAX_DEPTH} levels; this group would be deeper.` };
  }
  const sid = newId('sec');
  const n = c.sections.length + 1;
  const section: Section = {
    id: sid,
    title: opts.title ?? `Section ${n}`,
    parent,
    color: 'grey',
    ...(opts.rect ? { rect: opts.rect } : {}),
    layout: 'free',
    collapsed: false,
    locked: false,
    order: Math.max(-1, ...c.sections.map((s) => s.order)) + 1,
  };
  const S = new Set(screens);
  const I = new Set(images);
  const N = new Set(notes);
  const T = new Set(topSections);
  return {
    ok: true,
    id: sid,
    config: {
      ...c,
      sections: [...c.sections.map((s) => (T.has(s.id) ? { ...s, parent: sid } : s)), section],
      // Pin positions first: auto-layout orders by section, so regrouping must not move frames.
      screens: pinScreens(c, () => null).map((s) => (S.has(s.id) ? { ...s, section: sid } : s)),
      images: c.images.map((s) => (I.has(s.id) ? { ...s, section: sid } : s)),
      notes: c.notes.map((s) => (N.has(s.id) ? { ...s, section: sid } : s)),
    },
  };
}

/** Cmd/Ctrl+Shift+G: remove the section; its contents move up to its parent. */
export function ungroup(c: FlowCanvasConfig, sid: string): EditResult {
  const sec = c.sections.find((s) => s.id === sid);
  if (!sec) return { ok: false, error: 'Select a section to ungroup.' };
  if (sec.locked) return { ok: false, error: `${sec.title} is locked. Unlock it to ungroup.` };
  const up = sec.parent;
  return {
    ok: true,
    config: {
      ...c,
      sections: c.sections.filter((s) => s.id !== sid).map((s) => (s.parent === sid ? { ...s, parent: up } : s)),
      screens: pinScreens(c, () => null).map((s) => (s.section === sid ? { ...s, section: up } : s)),
      images: c.images.map((s) => (s.section === sid ? { ...s, section: up } : s)),
      notes: c.notes.map((n) => ({
        ...n,
        section: n.section === sid ? up : n.section,
        attachTo: n.attachTo?.type === 'section' && n.attachTo.id === sid ? null : n.attachTo,
      })),
    },
  };
}

/** Move a section and everything inside it by `d` (reference units). Edges follow their frames. */
export function moveSection(c: FlowCanvasConfig, sid: string, d: Point): FlowCanvasConfig {
  if (!d.x && !d.y) return c;
  const secs = descendants(c, sid);
  const shift = <T extends { x: number; y: number }>(r: T): T => ({ ...r, x: r.x + d.x, y: r.y + d.y });
  return {
    ...c,
    screens: pinScreens(c, (id, p) => (secs.has(c.screens.find((s) => s.id === id)?.section ?? '') ? shift(p) : null)),
    sections: c.sections.map((s) => (secs.has(s.id) && s.rect ? { ...s, rect: shift(s.rect) } : s)),
    images: c.images.map((i) => (i.section && secs.has(i.section) ? { ...i, rect: shift(i.rect) } : i)),
    notes: c.notes.map((n) =>
      (n.section && secs.has(n.section)) || (n.attachTo?.type === 'section' && secs.has(n.attachTo.id)) ? { ...n, rect: shift(n.rect) } : n,
    ),
  };
}

/**
 * Auto-layout a section's screens (reference units, from the section's
 * current top-left): row = one row left → right; grid = 3 per row, 64 px gaps.
 * Each screen's extra states stay stacked below it.
 */
export function autoLayout(c: FlowCanvasConfig, sid: string, mode: 'row' | 'grid'): FlowCanvasConfig {
  const pos = resolvePositions(c);
  const members = c.screens
    .filter((s) => s.section === sid)
    .map((s) => ({ s, p: pos.get(s.id) ?? { x: 0, y: 0 } }))
    .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);
  if (!members.length) return { ...c, sections: c.sections.map((s) => (s.id === sid ? { ...s, layout: mode } : s)) };
  const origin = { x: Math.min(...members.map((m) => m.p.x)), y: Math.min(...members.map((m) => m.p.y)) };
  const outer = frameOuter(REF_DEVICE);
  const next = new Map<string, Point>();
  if (mode === 'row') {
    members.forEach((m, i) => next.set(m.s.id, { x: origin.x + i * REF_SLOT.w, y: origin.y }));
  } else {
    let y = origin.y;
    for (let r = 0; r * GRID_PER_ROW < members.length; r++) {
      const row = members.slice(r * GRID_PER_ROW, (r + 1) * GRID_PER_ROW);
      row.forEach((m, i) => next.set(m.s.id, { x: origin.x + i * (outer.w + GRID_GAP), y }));
      const states = Math.max(...row.map((m) => m.s.states.length));
      y += states * REF_SLOT.h - GAP_Y + GRID_GAP;
    }
  }
  return {
    ...c,
    screens: pinScreens(c, (id) => next.get(id) ?? null),
    sections: c.sections.map((s) => (s.id === sid ? { ...s, layout: mode } : s)),
  };
}

/** Fit to content: drop the drawn rect so the box hugs what is inside (kept when the section is empty). */
export function fitToContent(c: FlowCanvasConfig, sid: string): FlowCanvasConfig {
  const has =
    c.screens.some((s) => s.section === sid) ||
    c.images.some((s) => s.section === sid) ||
    c.notes.some((s) => s.section === sid) ||
    c.sections.some((s) => s.parent === sid);
  if (!has) return c;
  return { ...c, sections: c.sections.map((s) => (s.id === sid && s.rect ? (({ rect: _r, ...rest }) => rest)(s) : s)) };
}

export function patchSection(c: FlowCanvasConfig, sid: string, patch: Partial<Section>): FlowCanvasConfig {
  return { ...c, sections: c.sections.map((s) => (s.id === sid ? { ...s, ...patch } : s)) };
}
