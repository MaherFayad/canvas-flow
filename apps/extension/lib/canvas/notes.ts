/**
 * Sticky notes (feature 10): kinds, placement and "attached notes move with
 * their item". Rects are in reference units like screen positions.
 */
import { NOTE_KINDS, frameKey, id as newId, type Device, type FlowCanvasConfig, type Note } from '@flowcanvas/config';
import { toRender } from './geometry';
import { resolvePositions, type FrameBox, type Point } from './layout';
import type { Box } from './sections';

export type NoteKind = (typeof NOTE_KINDS)[number];

/** Colour + word label for each kind (colour never alone). */
export const NOTE_KIND_META: Record<NoteKind, { label: string; bg: string; line: string; ink: string }> = {
  note: { label: 'Note', bg: '#fff8c5', line: '#eadc7a', ink: '#6b5d00' },
  question: { label: 'Question', bg: '#e6f0ff', line: '#b9d0f7', ink: '#1e4e9c' },
  issue: { label: 'Issue', bg: '#ffe9e7', line: '#f3c0ba', ink: '#a1251b' },
  decision: { label: 'Decision', bg: '#e7f6ec', line: '#b7e0c4', ink: '#1d6b3a' },
  idea: { label: 'Idea', bg: '#f1eaff', line: '#d7c7fa', ink: '#5b33b6' },
};

export const NOTE_SIZE = { w: 220, h: 120 };

export function newNote(at: Point, kind: NoteKind = 'note', section: string | null = null, author = 'me'): Note {
  return {
    id: newId('n'),
    kind,
    text: '',
    attachTo: null,
    rect: { x: Math.round(at.x), y: Math.round(at.y), ...NOTE_SIZE },
    section,
    author,
    createdAt: new Date().toISOString(),
  };
}

export type AttachTarget = { type: 'frame' | 'edge' | 'section' | 'image'; id: string; label: string };

/** Everything a note can be attached to, with readable labels. */
export function attachTargets(c: FlowCanvasConfig): AttachTarget[] {
  const title = new Map(c.screens.map((s) => [s.id, s.title]));
  return [
    ...c.screens.flatMap((s) => s.states.map((st) => ({ type: 'frame' as const, id: frameKey(s.id, st), label: `Frame: ${s.title} · ${st}` }))),
    ...c.edges.map((e) => ({
      type: 'edge' as const,
      id: e.id,
      label: `Edge: ${title.get(e.from.screen) ?? e.from.screen} → ${title.get(e.to.screen) ?? e.to.screen}${e.trigger.label ? ` (${e.trigger.label})` : ''}`,
    })),
    ...c.sections.map((s) => ({ type: 'section' as const, id: s.id, label: `Section: ${s.title}` })),
    ...c.images.map((i) => ({ type: 'image' as const, id: i.id, label: `Image: ${i.caption || i.id}` })),
  ];
}

/** Position (reference units) of whatever a note is attached to. */
function anchorOf(c: FlowCanvasConfig, pos: Map<string, Point>, a: NonNullable<Note['attachTo']>): Point | null {
  switch (a.type) {
    case 'frame':
      return pos.get(a.id.split(':')[0]!) ?? null;
    case 'image': {
      const i = c.images.find((x) => x.id === a.id);
      return i ? { x: i.rect.x, y: i.rect.y } : null;
    }
    case 'edge': {
      const e = c.edges.find((x) => x.id === a.id);
      const p = e && pos.get(e.from.screen);
      const q = e && pos.get(e.to.screen);
      return p && q ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : null;
    }
    case 'section':
      return null; // moveSection shifts notes attached to a section
  }
}

/**
 * Attached notes move with their item: compare item positions before and
 * after a change and shift each attached note that did not move itself.
 * Returns `next` unchanged (same object) when nothing needs to follow.
 */
export function followAttachments(prev: FlowCanvasConfig, next: FlowCanvasConfig): FlowCanvasConfig {
  if (prev === next || !next.notes.some((n) => n.attachTo)) return next;
  const before = new Map(prev.notes.map((n) => [n.id, n]));
  let p0: Map<string, Point> | null = null;
  let p1: Map<string, Point> | null = null;
  let changed = false;
  const notes = next.notes.map((n) => {
    const old = before.get(n.id);
    if (!n.attachTo || !old || old.rect.x !== n.rect.x || old.rect.y !== n.rect.y) return n;
    if (JSON.stringify(old.attachTo) !== JSON.stringify(n.attachTo)) return n;
    if (n.rect.x === 0 && n.rect.y === 0) return n; // auto-placed next to its item (see noteBox)
    p0 ??= resolvePositions(prev);
    p1 ??= resolvePositions(next);
    const a = anchorOf(prev, p0, n.attachTo);
    const b = anchorOf(next, p1, n.attachTo);
    if (!a || !b) return n;
    const dx = Math.round(b.x - a.x);
    const dy = Math.round(b.y - a.y);
    if (!dx && !dy) return n;
    changed = true;
    return { ...n, rect: { ...n.rect, x: n.rect.x + dx, y: n.rect.y + dy } };
  });
  return changed ? { ...next, notes } : next;
}

/**
 * Render box of a note. A note attached with no position of its own (0, 0 —
 * e.g. Claude's add_note on a frame whose screen is auto-laid out) is drawn
 * just above its item.
 */
export function noteBox(n: Note, device: Device, frames: Map<string, FrameBox>, images: Map<string, Box>): Box {
  const auto = n.attachTo && n.rect.x === 0 && n.rect.y === 0;
  if (auto && n.attachTo) {
    if (n.attachTo.type === 'frame') {
      const key = n.attachTo.id.includes(':') ? n.attachTo.id : `${n.attachTo.id}:default`;
      const f = frames.get(key) ?? [...frames.values()].find((x) => x.screenId === n.attachTo!.id.split(':')[0]);
      if (f) return { x: f.x, y: f.y - n.rect.h - 24, w: n.rect.w, h: n.rect.h };
    }
    if (n.attachTo.type === 'image') {
      const i = images.get(n.attachTo.id);
      if (i) return { x: i.x, y: i.y - n.rect.h - 24, w: n.rect.w, h: n.rect.h };
    }
  }
  const p = toRender(n.rect, device);
  return { x: p.x, y: p.y, w: n.rect.w, h: n.rect.h };
}
