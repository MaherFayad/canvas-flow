import { describe, expect, it } from 'vitest';
import { EASING_PRESETS, EdgeSchema, emptyConfig, type FlowCanvasConfig } from '@flowcanvas/config';
import type { Token } from '@flowcanvas/protocol';
import { bezierFn, curveGraph, formatBezier, parseEasing } from './easing';
import { clickMatches, planForEdge, planTransition, primaryEdge, reverseOf, waapiEasing } from './transitions';
import { effectiveValues, needsTailwindNote, toCss, toDtcg } from './tokenExport';
import { decayEnd, decayOffset, releaseVelocity, INERTIA_TAU } from './inertia';
import { hashString, missingStills, stillHash, stillKey } from './capture';
import { notableState } from './player';

const edge = (p: Partial<Parameters<typeof EdgeSchema.parse>[0]> & Record<string, unknown>) =>
  EdgeSchema.parse({ id: 'e', from: { screen: 'a' }, to: { screen: 'b' }, ...p });

describe('bezier editor math', () => {
  it('parses cubic-bezier strings and keywords, rejects bad x', () => {
    expect(parseEasing('cubic-bezier(0.2, 0.8, 0.2, 1)')).toEqual([0.2, 0.8, 0.2, 1]);
    expect(parseEasing('  CUBIC-BEZIER(.34,1.56,.64,1) ')).toEqual([0.34, 1.56, 0.64, 1]);
    expect(parseEasing('ease-out')).toEqual([0, 0, 0.58, 1]);
    expect(parseEasing('cubic-bezier(1.2, 0, 0, 1)')).toBeNull(); // x out of 0..1
    expect(parseEasing('cubic-bezier(0, -0.5, 1, 1.8)')).toEqual([0, -0.5, 1, 1.8]); // y may overshoot
    expect(parseEasing('cubic-bezier(a, 0, 0, 1)')).toBeNull();
    expect(parseEasing('steps(4)')).toBeNull();
  });
  it('formats with 2 decimals and round-trips every preset', () => {
    expect(formatBezier([0.333333, 1.5555, 0.2, 1])).toBe('cubic-bezier(0.33, 1.56, 0.2, 1)');
    for (const v of Object.values(EASING_PRESETS)) {
      const p = parseEasing(v)!;
      expect(parseEasing(formatBezier(p))).toEqual(p.map((n) => Math.round(n * 100) / 100));
    }
  });
  it('overshoot curve goes above 1 and lands on 1', () => {
    const f = bezierFn(parseEasing(EASING_PRESETS.overshoot!)!);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => f(i / 49)))).toBeGreaterThan(1.05);
    expect(f(1)).toBe(1);
    expect(f(0)).toBe(0);
  });
  it('graph mapping inverts and keeps overshooting handles visible', () => {
    const g = curveGraph(168, 14);
    for (const [x, y] of [[0, 0], [1, 1], [0.34, 1.56], [0.5, -0.3]] as const) {
      const [bx, by] = g.fromPx(g.toX(x), g.toY(y));
      expect(bx).toBeCloseTo(x, 6);
      expect(by).toBeCloseTo(y, 6);
      expect(g.toY(y)).toBeGreaterThanOrEqual(0);
      expect(g.toY(y)).toBeLessThanOrEqual(168);
    }
    expect(g.fromPx(-50, -500)).toEqual([0, 2]); // x clamps to 0..1, y to -1..2
  });
});

describe('player transitions', () => {
  it('push slides A to -30% and B in from 100% with a slight dim; reverse is pop', () => {
    const p = planTransition('push', { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    expect(p.top).toBe('b');
    expect(p.a?.at(-1)).toEqual({ transform: 'translate3d(-30%, 0, 0)' });
    expect(p.b?.[0]).toEqual({ transform: 'translate3d(100%, 0, 0)' });
    expect(p.duration).toBe(240);
    expect(p.easing).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
    expect(reverseOf('push')).toBe('pop');
    const back = planForEdge(edge({ transition: { type: 'push', duration: 240 } }), true);
    expect(back.top).toBe('a');
    expect(back.a?.at(-1)).toEqual({ transform: 'translate3d(100%, 0, 0)' });
    expect(back.b?.[0]).toEqual({ transform: 'translate3d(-30%, 0, 0)' });
  });
  it('sheet-up rises over a 40% dim; sheet-down is its reverse', () => {
    const up = planTransition('sheet-up', { duration: 320, easing: 'ease-out' });
    expect(up.top).toBe('b');
    expect(up.b?.[0]).toEqual({ transform: 'translate3d(0, 100%, 0)' });
    expect(up.dim?.at(-1)).toEqual({ opacity: 0.4 });
    expect(up.a).toBeNull();
    const down = planTransition(reverseOf('sheet-up'), { duration: 320, easing: 'ease-out' });
    expect(down.top).toBe('a');
    expect(down.dim?.[0]).toEqual({ opacity: 0.4 });
  });
  it('fade fades the top layer out over the fully painted next screen; none is instant', () => {
    const f = planTransition('fade', { duration: 250, easing: 'ease-out' });
    expect(f).toMatchObject({ top: 'a', a: [{ opacity: 1 }, { opacity: 0 }], b: null });
    expect(planTransition('none', { duration: 300, easing: 'linear' }).duration).toBe(0);
    expect(planTransition('push', { duration: 0, easing: 'linear' }).duration).toBe(0);
  });
  it('reduced motion swaps with a 120 ms fade', () => {
    expect(planTransition('push', { duration: 400, easing: 'ease', reduced: true })).toMatchObject({ duration: 120, top: 'a', a: [{ opacity: 1 }, { opacity: 0 }] });
  });
  it('falls back to Snappy for easings WAAPI would reject', () => {
    expect(waapiEasing('spring(1, 100, 10, 0)')).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
    expect(waapiEasing('cubic-bezier(0.34, 1.56, 0.64, 1)')).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
  });
  it('→ plays the edge to the next step, else the first happy edge; taps match trigger.target', () => {
    const e1 = edge({ id: '1', to: { screen: 'x' }, kind: 'error', trigger: { label: 'Pay', target: '[data-fc="pay"]' } });
    const e2 = edge({ id: '2', to: { screen: 'y' }, trigger: { label: 'Pay', target: '[data-fc="pay"]' } });
    expect(primaryEdge([e1, e2])?.id).toBe('2');
    expect(primaryEdge([e1, e2], { screen: 'x' })?.id).toBe('1');
    expect(primaryEdge([])).toBeNull();
    expect(clickMatches(e1, '[data-fc="pay"]')).toBe(true);
    expect(clickMatches(e1, '[data-fc="other"]')).toBe(false);
  });
});

describe('token export', () => {
  const base: Token[] = [
    { name: '--surface', value: '#FAF7F0', type: 'color' },
    { name: '--font-display', value: "'Sorts Mill Goudy', serif", type: 'font' },
    { name: '--font-size-display', value: '27px', type: 'length' },
    { name: '--radius-card', value: '14px', type: 'length' },
    { name: '--line-height', value: '1.5', type: 'number' },
  ];
  it('W3C design tokens JSON: groups, $value/$type, css var kept', () => {
    const vals = effectiveValues(base, { '--radius-card': '16px' }, { '--surface': '#FFFFFF' });
    const j = toDtcg(vals);
    expect(j.color!.surface).toEqual({ $value: '#FFFFFF', $type: 'color', $extensions: { 'dev.flowcanvas': { cssVar: '--surface' } } });
    expect(j.fontFamily!.display!.$value).toEqual(['Sorts Mill Goudy', 'serif']);
    expect(j.fontSize!.display).toMatchObject({ $value: '27px', $type: 'dimension' });
    expect(j.radius!.card!.$value).toBe('16px');
    expect(j.other!['line-height']).toMatchObject({ $value: 1.5, $type: 'number' });
    // Every leaf has $value, no leaf has a key starting with "$" other than the DTCG ones.
    for (const g of Object.values(j)) for (const t of Object.values(g)) expect('$value' in t).toBe(true);
  });
  it('CSS :root block', () => {
    expect(toCss(base.slice(0, 2))).toBe(":root {\n  --surface: #FAF7F0;\n  --font-display: 'Sorts Mill Goudy', serif;\n}\n");
  });
  it('Tailwind v3 note when no colour variables exist', () => {
    expect(needsTailwindNote(null)).toBe(false);
    expect(needsTailwindNote([])).toBe(true);
    expect(needsTailwindNote(base.slice(2))).toBe(true);
    expect(needsTailwindNote(base)).toBe(false);
  });
});

describe('pan inertia', () => {
  it('release velocity from the last 100 ms; none if the pointer rested', () => {
    const s = [
      { x: 0, y: 0, t: 0 },
      { x: 50, y: 10, t: 900 },
      { x: 100, y: 20, t: 950 },
      { x: 150, y: 30, t: 1000 },
    ];
    expect(releaseVelocity(s, 1000)).toEqual({ vx: 1, vy: 0.2 });
    expect(releaseVelocity(s, 1200)).toEqual({ vx: 0, vy: 0 });
  });
  it('decays exponentially with a ~325 ms time constant and stops', () => {
    expect(INERTIA_TAU).toBe(325);
    const total = decayOffset(1, 1e9);
    expect(decayOffset(1, INERTIA_TAU) / total).toBeCloseTo(1 - Math.exp(-1), 5); // 63% after one τ
    expect(decayOffset(1, 0)).toBe(0);
    const end = decayEnd(1);
    expect(end.distance).toBeCloseTo(total, 5);
    expect(total - decayOffset(1, end.ms)).toBeCloseTo(0.5, 3);
    expect(decayEnd(0).ms).toBe(0);
  });
});

describe('screenshots', () => {
  const c: FlowCanvasConfig = {
    ...emptyConfig('http://localhost:5173'),
    screens: [
      { id: 'a', title: 'A', path: '/a', states: ['default', 'loading'] },
      { id: 'b', title: 'B', path: '/b', states: ['default'] },
    ] as FlowCanvasConfig['screens'],
  };
  const dev = c.devices[0]!;
  it('hash changes with url, state, size and tokens', () => {
    const h = stillHash('o', '/a', 'default', dev, {});
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(stillHash('o', '/a', 'default', dev, {})).toBe(h);
    expect(stillHash('o', '/a', 'loading', dev, {})).not.toBe(h);
    expect(stillHash('o', '/a', 'default', { w: 1, h: 2 }, {})).not.toBe(h);
    expect(stillHash('o', '/a', 'default', dev, { '--x': '1px' })).not.toBe(h);
    expect(stillHash('o', '/a', 'default', dev, { '--b': '1', '--a': '2' })).toBe(stillHash('o', '/a', 'default', dev, { '--a': '2', '--b': '1' }));
    expect(hashString('')).toBe('811c9dc5');
  });
  it('lists frames without a fresh still (missing, stale, or hash changed)', () => {
    const hashOf = (p: string, s: string) => stillHash('o', p, s, dev, {});
    const have = {
      [stillKey('a', 'default', dev.id)]: { id: '1', webp: 'x', hash: hashOf('/a', 'default'), at: 0 },
      [stillKey('a', 'loading', dev.id)]: { id: '2', webp: 'x', hash: hashOf('/a', 'loading'), at: 0, stale: true },
      [stillKey('b', 'default', dev.id)]: { id: '3', webp: 'x', hash: 'old', at: 0 },
    };
    expect(missingStills(c, dev, have, hashOf).map((m) => `${m.screen}:${m.state}`)).toEqual(['a:loading', 'b:default']);
    expect(missingStills(c, dev, {}, hashOf)).toHaveLength(3);
  });
});

describe('sidebar dot', () => {
  it('uses the first state when coloured, else a coloured state an edge leads to, else none', () => {
    const c: FlowCanvasConfig = {
      ...emptyConfig('http://localhost:5173'),
      screens: [
        { id: 'checkout', title: 'Checkout', path: '/c', states: ['default', 'loading', 'error'] },
        { id: 'done', title: 'Done', path: '/d', states: ['success', 'error'] },
        { id: 'catalog', title: 'Catalog', path: '/x', states: ['default', 'loading', 'empty'] },
      ] as FlowCanvasConfig['screens'],
      edges: [edge({ from: { screen: 'checkout' }, to: { screen: 'checkout', state: 'loading' } })],
    };
    expect(notableState(c, c.screens[0]!)).toBe('loading');
    expect(notableState(c, c.screens[1]!)).toBe('success');
    expect(notableState(c, c.screens[2]!)).toBeNull();
  });
});
