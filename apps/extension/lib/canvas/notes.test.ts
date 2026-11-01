import { beforeEach, describe, expect, it } from 'vitest';
import { emptyConfig, type FlowCanvasConfig, type Note } from '@flowcanvas/config';
import { REF_DEVICE } from './geometry';
import { layoutFrames } from './layout';
import { attachTargets, followAttachments, noteBox } from './notes';
import { useProject } from '@/store/project';

const note = (id: string, attachTo: Note['attachTo'], x = 100, y = 100): Note => ({
  id,
  kind: 'issue',
  text: id,
  attachTo,
  rect: { x, y, w: 220, h: 120 },
  section: null,
  author: 'me',
  createdAt: '',
});

const base = (): FlowCanvasConfig => ({
  ...emptyConfig('http://localhost:5173'),
  screens: [
    { id: 'a', title: 'A', section: null, path: '/a', states: ['default'], position: { x: 0, y: 0 } },
    { id: 'b', title: 'B', section: null, path: '/b', states: ['default'], position: { x: 1000, y: 0 } },
  ],
  edges: [{ id: 'e1', from: { screen: 'a', state: 'default' }, to: { screen: 'b', state: 'default' }, trigger: { label: 'Go', gesture: 'tap' }, transition: { type: 'push', duration: 240, easing: 'ease' }, kind: 'happy' }],
  images: [{ id: 'img', rect: { x: 0, y: 2000, w: 100, h: 100 }, crop: null, opacity: 1, overlay: null, section: null }],
  notes: [note('n-frame', { type: 'frame', id: 'a:default' }), note('n-edge', { type: 'edge', id: 'e1' }), note('n-img', { type: 'image', id: 'img' }), note('n-free', null)],
});

describe('attached notes move with their item', () => {
  it('frame, edge (half the move of one end) and image', () => {
    const prev = base();
    const next = { ...prev, screens: prev.screens.map((s) => (s.id === 'a' ? { ...s, position: { x: 40, y: 60 } } : s)), images: [{ ...prev.images[0]!, rect: { ...prev.images[0]!.rect, x: 7, y: 2003 } }] };
    const out = followAttachments(prev, next);
    const r = (id: string) => out.notes.find((n) => n.id === id)!.rect;
    expect(r('n-frame')).toMatchObject({ x: 140, y: 160 });
    expect(r('n-edge')).toMatchObject({ x: 120, y: 130 });
    expect(r('n-img')).toMatchObject({ x: 107, y: 103 });
    expect(r('n-free')).toMatchObject({ x: 100, y: 100 });
  });
  it('a note moved in the same change keeps its own move; nothing moved → same object', () => {
    const prev = base();
    expect(followAttachments(prev, { ...prev })).toEqual({ ...prev });
    const next = {
      ...prev,
      screens: prev.screens.map((s) => (s.id === 'a' ? { ...s, position: { x: 40, y: 60 } } : s)),
      notes: prev.notes.map((n) => (n.id === 'n-frame' ? { ...n, rect: { ...n.rect, x: 5, y: 5 } } : n)),
    };
    expect(followAttachments(prev, next).notes.find((n) => n.id === 'n-frame')!.rect).toMatchObject({ x: 5, y: 5 });
  });
  it('the project store applies it in the same undo step as the move', () => {
    useProject.getState().load(base());
    useProject.getState().moveScreen('a', { x: 10, y: 0 });
    expect(useProject.getState().config.notes[0]!.rect).toMatchObject({ x: 110, y: 100 });
    useProject.temporal.getState().undo();
    expect(useProject.getState().config.notes[0]!.rect).toMatchObject({ x: 100, y: 100 });
  });
});

describe('placement + targets', () => {
  beforeEach(() => useProject.getState().load(base()));
  it('an attached note at (0, 0) is drawn just above its frame', () => {
    const c = base();
    const frames = new Map(layoutFrames(c, REF_DEVICE).frames.map((f) => [f.key, f]));
    const b = noteBox(note('x', { type: 'frame', id: 'b' }, 0, 0), REF_DEVICE, frames, new Map());
    const f = frames.get('b:default')!;
    expect(b).toEqual({ x: f.x, y: f.y - 120 - 24, w: 220, h: 120 });
  });
  it('lists frames, edges, sections and images with readable labels', () => {
    const t = attachTargets(base());
    expect(t.map((x) => x.label)).toEqual(['Frame: A · default', 'Frame: B · default', 'Edge: A → B (Go)', 'Image: img']);
  });
});
