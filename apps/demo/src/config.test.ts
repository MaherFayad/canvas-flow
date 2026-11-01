import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '@flowcanvas/config';
import { MockRuleSchema, findMock } from '@flowcanvas/protocol';
import { describe, expect, it } from 'vitest';
import { GROUPS, SCREENS } from './screens';

const appDir = join(__dirname, '..');
const raw = JSON.parse(readFileSync(join(appDir, 'flowcanvas.config.json'), 'utf8'));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(f) && !f.endsWith('.test.ts') ? [readFileSync(p, 'utf8')] : [];
  });
}

/** Every data-fc id the app can render: fc.target('x'), fc.target(`x-${…}`) prefixes, and literal data-fc="x". */
function targetIds(): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const src of sources(join(appDir, 'src'))) {
    for (const m of src.matchAll(/fc\.target\('([^']+)'\)|data-fc="([^"]+)"|fc: '([^']+)'/g)) exact.add(m[1] ?? m[2] ?? m[3]!);
    for (const m of src.matchAll(/fc\.target\(`([^`$]+)\$\{/g)) prefixes.push(m[1]!);
  }
  return { exact, prefixes };
}

describe('flowcanvas.config.json', () => {
  const r = parseConfig(raw);

  it('is valid per parseConfig', () => {
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  if (!r.ok) return;
  const c = r.config;

  it('points at the demo dev server', () => {
    expect(c.project.origin).toBe('http://localhost:5173');
  });

  it('has the 4 groups as sections and the 12 screens the app declares', () => {
    expect(c.sections.map((s) => s.id)).toEqual(GROUPS.map((g) => g.id));
    expect(c.screens).toHaveLength(12);
    expect(c.screens.map(({ id, path, section, states }) => ({ id, path, group: section, states }))).toEqual(
      SCREENS.map(({ id, path, group, states }) => ({ id, path, group, states })),
    );
  });

  it('gives every screen at least 3 states, default (or success) first, and Catalog all 5', () => {
    for (const s of c.screens) {
      expect(s.states.length, s.id).toBeGreaterThanOrEqual(3);
      expect(['default', 'success']).toContain(s.states[0]);
    }
    expect(c.screens.reduce((n, s) => n + s.states.length, 0)).toBeGreaterThanOrEqual(50);
    expect(c.screens.find((s) => s.id === 'catalog')!.states).toEqual(['default', 'loading', 'empty', 'partial', 'error']);
  });

  it('positions every screen, one row per screen', () => {
    const ys = c.screens.map((s) => s.position!.y);
    expect(new Set(ys).size).toBe(ys.length);
  });

  it('has Onboarding and Checkout happy paths and an error edge from payment', () => {
    const happy = c.edges.filter((e) => e.kind === 'happy').map((e) => `${e.from.screen}:${e.from.state}>${e.to.screen}:${e.to.state}`);
    expect(happy).toEqual(expect.arrayContaining(['welcome:default>pick-interests:default', 'pick-interests:default>catalog:default']));
    expect(happy).toEqual(
      expect.arrayContaining(['bag:default>checkout:default', 'checkout:default>checkout:loading', 'checkout:loading>order-confirmed:success']),
    );
    const err = c.edges.find((e) => e.kind === 'error');
    expect(err?.from).toEqual({ screen: 'checkout', state: 'default' });
    expect(err?.to).toEqual({ screen: 'checkout', state: 'error' });
  });

  it('edges point at states that exist', () => {
    const states = new Map(c.screens.map((s) => [s.id, s.states]));
    for (const e of c.edges) {
      expect(states.get(e.from.screen), e.id).toContain(e.from.state);
      expect(states.get(e.to.screen), e.id).toContain(e.to.state);
    }
  });

  it('only targets data-fc ids that exist in the app', () => {
    const { exact, prefixes } = targetIds();
    for (const e of c.edges) {
      if (e.trigger.gesture === 'auto-after-ms') continue;
      const m = e.trigger.target?.match(/^\[data-fc="([^"]+)"\]$/);
      expect(m, `${e.id} uses a [data-fc] target`).toBeTruthy();
      const id = m![1]!;
      expect(exact.has(id) || prefixes.some((p) => id.startsWith(p)), `${e.id}: ${id}`).toBe(true);
    }
  });

  it('mocks the 4 non-default Catalog states for the no-SDK path', () => {
    for (const st of ['loading', 'empty', 'partial', 'error']) {
      const rules = c.mocks[`catalog:${st}`];
      expect(rules, st).toBeDefined();
      rules!.forEach((rule) => expect(MockRuleSchema.safeParse(rule).success).toBe(true));
      expect(findMock(rules!, 'GET', '/api/products'), st).toBeDefined();
    }
    expect(c.mocks['catalog:loading']![0]!.delay).toBe('forever');
    expect(c.mocks['catalog:error']![0]!.status).toBe(500);
    expect(c.mocks['catalog:empty']![0]!.body).toEqual({ items: [] });
  });
});
