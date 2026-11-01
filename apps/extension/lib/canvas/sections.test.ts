import { describe, expect, it } from 'vitest';
import { DEVICE_PRESETS, emptyConfig, parseConfig, type FlowCanvasConfig, type Section } from '@flowcanvas/config';
import { REF_DEVICE, REF_SLOT, frameOuter } from './geometry';
import { layoutFrames, resolvePositions } from './layout';
import {
  COLLAPSED_H,
  GRID_GAP,
  MAX_DEPTH,
  autoLayout,
  canNestUnder,
  collapsedOwner,
  countLabel,
  fitToContent,
  groupSelection,
  moveSection,
  sectionAt,
  sectionLayout,
  ungroup,
} from './sections';

const sec = (id: string, parent: string | null = null, extra: Partial<Section> = {}): Section => ({
  id,
  title: id.toUpperCase(),
  parent,
  color: 'grey',
  layout: 'free',
  collapsed: false,
  locked: false,
  order: 0,
  ...extra,
});

function cfg(over: Partial<FlowCanvasConfig> = {}): FlowCanvasConfig {
  return {
    ...emptyConfig('http://localhost:5173', 'T'),
    sections: [sec('a'), sec('b', 'a'), sec('c', 'b')],
    screens: [
      { id: 'one', title: 'One', section: 'a', path: '/1', states: ['default'] },
      { id: 'two', title: 'Two', section: 'b', path: '/2', states: ['default', 'empty'] },
      { id: 'three', title: 'Three', section: 'c', path: '/3', states: ['default'] },
      { id: 'four', title: 'Four', section: null, path: '/4', states: ['default'] },
    ],
    images: [{ id: 'img-1', rect: { x: 5000, y: 0, w: 300, h: 200 }, crop: null, opacity: 1, overlay: null, section: 'c' }],
    notes: [{ id: 'n-1', kind: 'note', text: 'hi', attachTo: { type: 'section', id: 'b' }, rect: { x: 10, y: 10, w: 220, h: 120 }, section: null, author: 'me', createdAt: '' }],
    ...over,
  };
}

const valid = (c: FlowCanvasConfig) => {
  const r = parseConfig(JSON.parse(JSON.stringify(c)));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.config;
};

describe('nesting (max 3 levels)', () => {
  it('canNestUnder counts levels including the subtree being moved', () => {
    const c = cfg();
    expect(canNestUnder(c, null, 3)).toBe(true);
    expect(canNestUnder(c, 'a', 2)).toBe(true);
    expect(canNestUnder(c, 'b', 1)).toBe(true);
    expect(canNestUnder(c, 'c', 1)).toBe(false);
    expect(canNestUnder(c, 'a', 3)).toBe(false);
  });
  it('grouping items inside level 3 is refused; the config rejects depth 4 too', () => {
    const c = cfg();
    const r = groupSelection(c, { screens: ['three'] });
    expect(r).toEqual({ ok: false, error: `Sections nest up to ${MAX_DEPTH} levels; this group would be deeper.` });
    const deep = { ...c, sections: [...c.sections, sec('d', 'c')] };
    expect(parseConfig(deep).ok).toBe(false);
  });
  it('grouping the whole tree under a new root would be 4 levels: refused', () => {
    expect(groupSelection(cfg(), { sections: ['a'] }).ok).toBe(false);
  });
});

describe('group / ungroup', () => {
  it('Cmd+G: items with a common section get a new child section there', () => {
    const c = cfg();
    const r = groupSelection(c, { screens: ['two'], images: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = valid(r.config);
    const s = out.sections.find((x) => x.id === r.id)!;
    expect(s.parent).toBe('b');
    expect(out.screens.find((x) => x.id === 'two')!.section).toBe(r.id);
  });
  it('mixed parents: the new section goes to the top level; a selected section keeps its contents', () => {
    const c = cfg({ sections: [sec('a'), sec('b', 'a')], images: [] });
    c.screens = c.screens.filter((s) => s.id !== 'three');
    const r = groupSelection(c, { screens: ['four', 'two'], sections: ['b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = valid(r.config);
    expect(out.sections.find((x) => x.id === r.id)!.parent).toBe(null);
    expect(out.sections.find((x) => x.id === 'b')!.parent).toBe(r.id);
    // "two" is inside the selected section b: it stays in b.
    expect(out.screens.find((x) => x.id === 'two')!.section).toBe('b');
    expect(out.screens.find((x) => x.id === 'four')!.section).toBe(r.id);
  });
  it('grouping and ungrouping never move frames on the canvas', () => {
    const c = cfg();
    const before = resolvePositions(c);
    const r = groupSelection(c, { screens: ['four'] });
    if (!r.ok) throw new Error(r.error);
    expect(resolvePositions(r.config)).toEqual(before);
    const u = ungroup(r.config, r.id!);
    if (!u.ok) throw new Error(u.error);
    expect(resolvePositions(u.config)).toEqual(before);
  });
  it('nothing selected: error', () => {
    expect(groupSelection(cfg(), {}).ok).toBe(false);
  });
  it('Cmd+Shift+G: contents move up to the parent, notes attached to it detach', () => {
    const r = ungroup(cfg(), 'b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = valid(r.config);
    expect(out.sections.map((s) => s.id)).toEqual(['a', 'c']);
    expect(out.sections.find((s) => s.id === 'c')!.parent).toBe('a');
    expect(out.screens.find((s) => s.id === 'two')!.section).toBe('a');
    expect(out.notes[0]!.attachTo).toBeNull();
  });
  it('a locked section cannot be ungrouped', () => {
    expect(ungroup(cfg({ sections: [sec('a', null, { locked: true })] }), 'a').ok).toBe(false);
  });
});

describe('collapse', () => {
  it('hides everything inside (frames unmount), shows a header bar with the count', () => {
    const c = cfg({ sections: [sec('a'), sec('b', 'a', { collapsed: true }), sec('c', 'b')] });
    expect(collapsedOwner(c, 'c')).toBe('b');
    expect(collapsedOwner(c, 'a')).toBeNull();
    const { frames } = layoutFrames(c, REF_DEVICE);
    const L = sectionLayout(c, REF_DEVICE, frames, { images: new Map([['img-1', { x: 5000, y: 0, w: 300, h: 200 }]]), notes: new Map() });
    expect([...L.hiddenScreens].sort()).toEqual(['three', 'two']);
    expect([...L.hiddenImages]).toEqual(['img-1']);
    expect([...L.hiddenSections]).toEqual(['c']);
    const b = L.sections.find((s) => s.id === 'b')!;
    expect(b.h).toBe(COLLAPSED_H);
    expect(countLabel(b)).toBe('2 items'); // screen two + section c
    // Visible frame count drops: only frames of visible screens mount.
    const visible = frames.filter((f) => !L.hiddenScreens.has(f.screenId));
    expect(visible.map((f) => f.key).sort()).toEqual(['four:default', 'one:default']);
  });
  it('a section hugs its content, parents contain children, deepest wins sectionAt', () => {
    const c = cfg();
    const { frames } = layoutFrames(c, REF_DEVICE);
    const L = sectionLayout(c, REF_DEVICE, frames, { images: new Map(), notes: new Map() });
    const [a, b, cc] = ['a', 'b', 'c'].map((id) => L.sections.find((s) => s.id === id)!);
    const inside = (o: typeof a, i: typeof a) => i!.x >= o!.x && i!.y >= o!.y && i!.x + i!.w <= o!.x + o!.w && i!.y + i!.h <= o!.y + o!.h;
    expect(inside(a, b)).toBe(true);
    expect(inside(b, cc)).toBe(true);
    const three = frames.find((f) => f.key === 'three:default')!;
    expect(sectionAt(L, { x: three.x + 10, y: three.y + 10 })).toBe('c');
    expect(L.sections.map((s) => s.depth)).toEqual([1, 2, 3]);
  });
});

describe('move, auto-layout, fit', () => {
  it('moving a section moves its screens, sub-sections, images and notes (edges follow frames)', () => {
    const c = cfg({ sections: [sec('a'), sec('b', 'a', { rect: { x: 0, y: 0, w: 100, h: 100 } }), sec('c', 'b')] });
    const before = resolvePositions(c);
    const out = valid(moveSection(c, 'b', { x: 100, y: 50 }));
    const after = resolvePositions(out);
    expect(after.get('two')).toEqual({ x: before.get('two')!.x + 100, y: before.get('two')!.y + 50 });
    expect(after.get('three')).toEqual({ x: before.get('three')!.x + 100, y: before.get('three')!.y + 50 });
    expect(after.get('one')).toEqual(before.get('one'));
    expect(after.get('four')).toEqual(before.get('four'));
    expect(out.sections.find((s) => s.id === 'b')!.rect).toEqual({ x: 100, y: 50, w: 100, h: 100 });
    expect(out.images[0]!.rect).toMatchObject({ x: 5100, y: 50 });
    expect(out.notes[0]!.rect).toMatchObject({ x: 110, y: 60 }); // attached to section b
  });
  it('row: one row left to right; grid: 3 per row with 64 px gaps', () => {
    const screens = ['s1', 's2', 's3', 's4'].map((id, i) => ({ id, title: id, section: 'g', path: `/${id}`, states: i === 1 ? ['default', 'empty'] : ['default'], position: { x: 1000 + i * 7, y: 200 } }));
    const c = { ...emptyConfig('http://localhost:5173'), sections: [sec('g')], screens };
    const row = autoLayout(c, 'g', 'row');
    expect(row.screens.map((s) => s.position)).toEqual([0, 1, 2, 3].map((i) => ({ x: 1000 + i * REF_SLOT.w, y: 200 })));
    expect(row.sections[0]!.layout).toBe('row');
    const grid = autoLayout(c, 'g', 'grid');
    const w = frameOuter(REF_DEVICE).w + GRID_GAP;
    const rowH = 2 * REF_SLOT.h - (REF_SLOT.h - frameOuter(REF_DEVICE).h) + GRID_GAP;
    expect(grid.screens.map((s) => s.position)).toEqual([
      { x: 1000, y: 200 },
      { x: 1000 + w, y: 200 },
      { x: 1000 + 2 * w, y: 200 },
      { x: 1000, y: 200 + rowH },
    ]);
  });
  it('fit to content drops a drawn rect, but keeps it on an empty section', () => {
    const c = cfg({ sections: [sec('a', null, { rect: { x: 0, y: 0, w: 9, h: 9 } }), sec('e', null, { rect: { x: 0, y: 0, w: 9, h: 9 } })] });
    const out = fitToContent(fitToContent(c, 'a'), 'e');
    expect(out.sections[0]!.rect).toBeUndefined();
    expect(out.sections[1]!.rect).toBeDefined();
  });
  it('desktop render scales drawn rects with the slot', () => {
    const c = cfg({ sections: [sec('e', null, { rect: { x: REF_SLOT.w, y: 0, w: REF_SLOT.w, h: 100 } })], screens: [], images: [], notes: [] });
    const desktop = DEVICE_PRESETS.find((d) => d.id === 'desktop')!;
    const L = sectionLayout(c, desktop, [], { images: new Map(), notes: new Map() });
    const s = L.sections[0]!;
    expect(s.x).toBeCloseTo(frameOuter(desktop).w + 200, 0);
    expect(s.w).toBeCloseTo(frameOuter(desktop).w + 200, 0);
  });
});
