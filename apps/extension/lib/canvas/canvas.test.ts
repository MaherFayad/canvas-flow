import { describe, expect, it } from 'vitest';
import { ConfigSchema, DEVICE_PRESETS, type FlowCanvasConfig } from '@flowcanvas/config';
import { selectLive } from './live';
import { recordEdge, screenForPath } from './record';
import { Crawler, addPathScreens, addSdkScreens } from './discover';
import { countChanges, describeChanges } from './diff';
import { layoutFrames, resolvePositions } from './layout';
import { playerLayout, triggerText } from './player';
import { bezierFn, formatBezier, parseEasing } from './easing';
import { groupTokens, splitLength } from './tokenGroups';

const cfg = (extra: Partial<FlowCanvasConfig> = {}): FlowCanvasConfig =>
  ConfigSchema.parse({
    version: 1,
    project: { name: 't', origin: 'http://localhost:3000' },
    sections: [{ id: 'onb', title: 'Onboarding' }],
    screens: [
      { id: 'welcome', title: 'Welcome', section: 'onb', path: '/' },
      { id: 'catalog', title: 'Catalog', section: 'onb', path: '/catalog', states: ['default', 'empty'] },
    ],
    ...extra,
  });

describe('live / still selection', () => {
  const frames = Array.from({ length: 20 }, (_, i) => ({ key: `f${i}`, x: i * 500, y: 0, w: 440, h: 900 }));
  const view = { x: 0, y: 0, w: 5000, h: 1000 };
  it('only frames in view, at zoom ≥ 0.5', () => {
    expect([...selectLive({ frames, view: { x: 0, y: 0, w: 1200, h: 1000 }, zoom: 1 })].sort()).toEqual(['f0', 'f1', 'f2']);
    expect(selectLive({ frames, view, zoom: 0.4 }).size).toBe(0);
  });
  it('caps at 12 and keeps recently live frames (LRU)', () => {
    const lastLive = new Map([['f9', 100], ['f8', 90]]);
    const live = selectLive({ frames, view: { x: 0, y: 0, w: 10000, h: 1000 }, zoom: 1, lastLive });
    expect(live.size).toBe(12);
    expect(live.has('f9') && live.has('f8')).toBe(true);
  });
  it('hovered (forced) frames are live even when zoomed out', () => {
    const live = selectLive({ frames, view, zoom: 0.2, forced: new Set(['f15']) });
    expect([...live]).toEqual(['f15']);
  });
});

describe('record-mode edge creation', () => {
  it('links to an existing screen by path, label = click text, target = selector', () => {
    const r = recordEdge(cfg(), { from: { screen: 'welcome', state: 'default' }, toPath: '/catalog?fc-frame=x', click: { target: '[data-fc="go"]', text: 'Go' } });
    expect(r.createdScreen).toBeNull();
    expect(r.edge).toMatchObject({ from: { screen: 'welcome', state: 'default' }, to: { screen: 'catalog', state: 'default' }, trigger: { label: 'Go', target: '[data-fc="go"]', gesture: 'tap' } });
    expect(r.config.edges).toHaveLength(1);
  });
  it('creates the screen when the path is unknown, in the source section', () => {
    const r = recordEdge(cfg(), { from: { screen: 'catalog', state: 'empty' }, toPath: '/product/vase', click: { target: 'a', text: 'Vase' } });
    expect(r.createdScreen).toMatchObject({ id: 'product-vase', title: 'Vase', path: '/product/vase', section: 'onb' });
    expect(r.config.screens.every((s) => s.position)).toBe(true);
    expect(r.edge?.from).toEqual({ screen: 'catalog', state: 'empty' });
  });
  it('does not duplicate an identical edge', () => {
    const once = recordEdge(cfg(), { from: { screen: 'welcome', state: 'default' }, toPath: '/catalog', click: { target: 'a', text: 'x' } });
    const twice = recordEdge(once.config, { from: { screen: 'welcome', state: 'default' }, toPath: '/catalog', click: { target: 'a', text: 'x' } });
    expect(twice.edge).toBeNull();
    expect(twice.config.edges).toHaveLength(1);
  });
  it('screenForPath ignores trailing slash and fc params', () => {
    expect(screenForPath(cfg(), '/catalog/?fc-state=empty')?.id).toBe('catalog');
  });
});

describe('discovery', () => {
  it('crawls 2 levels, max pages, skipping logout/delete', () => {
    const c = new Crawler('/', 2, 4);
    const p0 = c.next()!;
    c.addLinks(['/a', '/logout', '/account/delete', '/b'], p0.depth);
    const p1 = c.next()!;
    c.addLinks(['/a/deep'], p1.depth);
    const p2 = c.next()!;
    expect(p2.path).toBe('/b');
    const p3 = c.next()!;
    c.addLinks(['/too-deep'], p3.depth);
    expect(p3.path).toBe('/a/deep');
    expect(c.next()).toBeNull(); // depth limit and max 4 pages
  });
  it('adds crawled paths to Unsorted, 3 per row, skipping known paths', () => {
    const c = addPathScreens(cfg(), ['/', '/a', '/b', '/c', '/d']);
    const fresh = c.screens.filter((s) => s.section === 'unsorted');
    expect(fresh.map((s) => s.path)).toEqual(['/a', '/b', '/c', '/d']);
    expect(c.sections.find((s) => s.id === 'unsorted')?.title).toBe('Unsorted');
    const ys = new Set(fresh.map((s) => s.position!.y));
    expect(ys.size).toBe(2);
  });
  it('turns SDK screens into sections by group', () => {
    const c = addSdkScreens(cfg({ screens: [] }), [{ id: 'bag', path: '/bag', group: 'checkout', states: ['default', 'empty'] }]);
    expect(c.sections.some((s) => s.id === 'checkout' && s.title === 'Checkout')).toBe(true);
    expect(c.screens[0]).toMatchObject({ id: 'bag', section: 'checkout', states: ['default', 'empty'] });
  });
});

describe('layout', () => {
  it('states sit below their screen; device switch re-lays without overlap', () => {
    const c = cfg();
    for (const d of DEVICE_PRESETS) {
      const { frames } = layoutFrames(c, d);
      const empty = frames.find((f) => f.key === 'catalog:empty')!;
      const def = frames.find((f) => f.key === 'catalog:default')!;
      expect(empty.x).toBe(def.x);
      expect(empty.y).toBeGreaterThanOrEqual(def.y + def.h);
      const welcome = frames.find((f) => f.key === 'welcome:default')!;
      expect(welcome.x + welcome.w).toBeLessThanOrEqual(def.x);
    }
    expect(resolvePositions(c).size).toBe(2);
  });
  it('player rows: one item per screen on mobile (stack), every state on desktop', () => {
    const c = cfg({ edges: [{ id: 'e', from: { screen: 'welcome', state: 'default' }, to: { screen: 'catalog', state: 'default' }, trigger: { label: 'Go', gesture: 'tap' } }] as never });
    const mob = playerLayout(c, DEVICE_PRESETS[0]!);
    expect(mob.rows[0]!.items.map((i) => i.key)).toEqual(['welcome:default', 'catalog:default']);
    expect(mob.rows[0]!.items[1]!.stack).toBe(1);
    expect(triggerText(mob.rows[0]!.items[0]!.next!)).toBe('Tap "Go"');
    expect(mob.rows[0]!.summary).toBe('2 steps · Welcome → Catalog');
    const desk = playerLayout(c, DEVICE_PRESETS.find((d) => d.id === 'desktop')!);
    expect(desk.rows[0]!.items).toHaveLength(3);
  });
});

describe('unsaved counter', () => {
  it('counts changed items and describes edge-only changes', () => {
    const a = cfg();
    const r = recordEdge(a, { from: { screen: 'welcome', state: 'default' }, toPath: '/catalog', click: { target: 'a', text: 'x' } });
    expect(countChanges(a, a)).toBe(0);
    expect(describeChanges(a, r.config)).toEqual({ count: 1, onlyEdges: true, text: '1 unsaved edge' });
    expect(describeChanges(a, { ...r.config, tokens: { '--a': '1px' } }).text).toBe('2 unsaved changes');
  });
});

describe('easing + tokens helpers', () => {
  it('parses and evaluates cubic-bezier', () => {
    expect(parseEasing('cubic-bezier(0.2, 0.8, 0.2, 1)')).toEqual([0.2, 0.8, 0.2, 1]);
    expect(parseEasing('ease-in')).toEqual([0.42, 0, 1, 1]);
    expect(parseEasing('steps(4)')).toBeNull();
    expect(formatBezier([0.34, 1.56, 0.64, 1])).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
    const lin = bezierFn([0, 0, 1, 1]);
    expect(lin(0.3)).toBeCloseTo(0.3, 3);
    const snappy = bezierFn([0.2, 0.8, 0.2, 1]);
    expect(snappy(0.5)).toBeGreaterThan(0.85);
    expect(snappy(1)).toBe(1);
  });
  it('groups tokens like the reference panel', () => {
    const g = groupTokens([
      { name: '--color-surface', value: '#fff', type: 'color' },
      { name: '--font-display', value: 'Georgia, serif', type: 'font' },
      { name: '--size-display', value: '32px', type: 'length' },
      { name: '--space-gutter', value: '20px', type: 'length' },
      { name: '--radius-card', value: '14px', type: 'length' },
    ]);
    expect(g.map((x) => x.group)).toEqual(['Colour', 'Font family', 'Type scale', 'Spacing', 'Radius']);
    expect(splitLength('1.5rem')).toEqual({ n: 1.5, unit: 'rem' });
  });
});

import { shortName } from './tokenGroups';
describe('token labels', () => {
  it('keeps names distinct and drops only the group prefix', () => {
    expect(shortName('--accent-muted')).toBe('accent-muted');
    expect(shortName('--danger-muted')).toBe('danger-muted');
    expect(shortName('--accent-ink')).toBe('accent-ink');
    expect(shortName('--surface-raised')).toBe('surface-raised');
    expect(shortName('--text-display')).toBe('display');
    expect(shortName('--font-size-display')).toBe('display');
    expect(shortName('--space-gutter')).toBe('gutter');
    expect(shortName('--radius-card')).toBe('card');
  });
});
