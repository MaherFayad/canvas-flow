import { describe, expect, expectTypeOf, it } from 'vitest';
import * as full from './index';
import * as lite from './lite';
import { parseMessageLite } from './lite';
import { CANVAS_TO_FRAME, FRAME_TO_CANVAS, MessageSchema, parseMessage } from './index';

const nonce = '0123456789abcdef';
const rect = { x: 1, y: 2, w: 30, h: 40 };

/** One valid message per type, with every optional field present. */
const VALID: Record<lite.MessageType, Record<string, unknown>> = {
  hello: { fc: 'hello', v: 1, frame: 'f1', nonce: null, hasSdk: true, url: '/' },
  screens: {
    fc: 'screens', v: 1, frame: 'f1', nonce,
    screens: [{ id: 'catalog', path: '/catalog', group: 'g', title: 'Catalog', states: ['default', 'empty'] }, { id: 'a', path: '/' }],
  },
  ready: { fc: 'ready', v: 1, frame: 'f1', nonce, url: '/catalog' },
  nav: { fc: 'nav', v: 1, frame: 'f1', nonce, from: '/', to: '/catalog' },
  click: { fc: 'click', v: 1, frame: 'f1', nonce, target: '[data-fc="go"]', text: 'Go', rect },
  'query-result': { fc: 'query-result', v: 1, frame: 'f1', nonce, id: 'q1', found: true, rect },
  'tokens-read': {
    fc: 'tokens-read', v: 1, frame: 'f1', nonce,
    tokens: [{ name: '--a', value: '#fff', type: 'color' }, { name: '--b', value: '4px', type: 'length' }],
  },
  'capture-result': { fc: 'capture-result', v: 1, frame: 'f1', nonce, id: 'c1', webp: 'data:image/webp;base64,AA', error: 'x' },
  'element-result': {
    fc: 'element-result', v: 1, frame: 'f1', nonce, id: 'e1',
    element: { selector: 'button', tag: 'button', text: 'Go', rect, html: '<button>Go</button>', styles: { color: 'red' } },
  },
  hmr: { fc: 'hmr', v: 1, frame: 'f1', nonce },
  'links-result': { fc: 'links-result', v: 1, frame: 'f1', nonce, id: 'l1', links: ['/a', '/b?x=1'] },
  welcome: { fc: 'welcome', v: 1, frame: 'f1', nonce, state: 'empty', device: { w: 440, h: 956 } },
  query: { fc: 'query', v: 1, frame: 'f1', nonce, id: 'q1', selector: '#x' },
  tokens: { fc: 'tokens', v: 1, frame: 'f1', nonce, vars: { '--a': '#fff', '--b': '2px' } },
  'tokens-request': { fc: 'tokens-request', v: 1, frame: 'f1', nonce },
  capture: { fc: 'capture', v: 1, frame: 'f1', nonce, id: 'c1', scale: 0.5, quality: 0.8 },
  mocks: {
    fc: 'mocks', v: 1, frame: 'f1', nonce,
    rules: [
      { match: { method: 'POST', url: '/api/*' }, status: 500, body: { error: 'server' }, headers: { 'x-a': '1' }, delay: 200 },
      { match: { url: '/api/products*' }, delay: 'forever' },
    ],
  },
  record: { fc: 'record', v: 1, frame: 'f1', nonce, on: true, intercept: ['[data-fc="go"]', '#pay'] },
  'element-at': { fc: 'element-at', v: 1, frame: 'f1', nonce, id: 'e1', x: 10, y: 20 },
  links: { fc: 'links', v: 1, frame: 'f1', nonce, id: 'l1' },
  'routes-result': {
    fc: 'routes-result', v: 1, frame: 'f1', nonce, id: 'r1', framework: 'react-router',
    routes: [{ path: '/product/:id', auth: true, name: 'product' }, { path: '/' }],
    meta: { buildId: 'development' },
  },
  'clickables-result': {
    fc: 'clickables-result', v: 1, frame: 'f1', nonce, id: 'k1',
    items: [{ index: 0, label: 'Shop', target: '[data-fc="shop"]', skip: 'logout' }, { index: 3, label: 'Classes', target: 'button "Classes"' }],
  },
  'click-probe-result': { fc: 'click-probe-result', v: 1, frame: 'f1', nonce, id: 'p1', ok: true, url: '/catalog' },
  routes: { fc: 'routes', v: 1, frame: 'f1', nonce, id: 'r1' },
  clickables: { fc: 'clickables', v: 1, frame: 'f1', nonce, id: 'k1' },
  'click-probe': { fc: 'click-probe', v: 1, frame: 'f1', nonce, id: 'p1', index: 2, label: 'Shop' },
};

/* Seeded PRNG so failures reproduce. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JUNK: unknown[] = [
  undefined, null, 0, -0, 1, 2, -1, 0.5, 1.5, 99, 100, 599, 600, 200.5, NaN, Infinity, -Infinity,
  '', 'x', '--x', 'forever', 'GET', 'color', 'nope', 'abcdefg', 'abcdefgh', 'x'.repeat(2049), 'x'.repeat(2048),
  true, false, [], [1], ['a'], {}, { a: 1 }, { a: 'b' }, new Date(0), new Map(), new Set(), rect,
  ...Object.keys(VALID),
];

const DELETE = Symbol('delete');
type Path = Array<string | number>;
function paths(v: unknown, at: Path = []): Path[] {
  const out: Path[] = [at];
  if (Array.isArray(v)) v.forEach((x, i) => out.push(...paths(x, [...at, i])));
  else if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Map) && !(v instanceof Set))
    for (const k of Object.keys(v)) out.push(...paths((v as Record<string, unknown>)[k], [...at, k]));
  return out;
}
function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
  return v;
}
function mutate(msg: Record<string, unknown>, r: () => number): unknown {
  const m = clone(msg);
  const n = 1 + Math.floor(r() * 3);
  let root: unknown = m;
  for (let i = 0; i < n; i++) {
    const all = paths(root).filter((p) => p.length > 0);
    const pick = <T>(xs: T[]) => clone(xs[Math.floor(r() * xs.length)]!);
    const op = r();
    if (op < 0.03) {
      root = pick(JUNK); // replace the whole message
      continue;
    }
    if (!all.length) continue;
    const p = pick(all);
    let parent = root as Record<string | number, unknown>;
    for (const k of p.slice(0, -1)) parent = parent[k] as Record<string | number, unknown>;
    const key = p[p.length - 1]!;
    if (!parent || typeof parent !== 'object') continue;
    if (op < 0.35) {
      if (Array.isArray(parent)) parent.splice(key as number, 1);
      else delete parent[key];
    } else if (op < 0.85) parent[key] = pick(JUNK);
    else if (Array.isArray(parent)) parent.push(pick(JUNK));
    else parent[['extra', 'zzz', '__x'][Math.floor(r() * 3)]!] = pick(JUNK); // unknown key: both must strip it
  }
  return root;
}
/** Valid variants: drop optional fields, set them to undefined. */
function validVariants(): unknown[] {
  const out: unknown[] = Object.values(VALID).map(clone);
  out.push({ ...VALID.welcome, device: undefined }, (({ device: _d, ...w }) => w)(VALID.welcome));
  out.push((({ error: _e, ...c }) => c)(VALID['capture-result']), { ...VALID['capture-result'], webp: null });
  out.push({ ...VALID['query-result'], rect: null, found: false }, { ...VALID['element-result'], element: null });
  out.push({ ...VALID.mocks, rules: [{ match: { url: '/x', method: undefined }, status: undefined, body: undefined }] });
  out.push({ ...VALID.mocks, rules: [] }, { ...VALID.screens, screens: [] }, { ...VALID.tokens, vars: {} });
  out.push((({ meta: _m, ...r }) => r)(VALID['routes-result']), { ...VALID['routes-result'], framework: null, routes: [], meta: undefined });
  out.push({ ...VALID['clickables-result'], items: [] }, { ...VALID['click-probe'], index: 0 });
  out.push({ ...VALID.ready, extra: 1, nested: { a: 1 } }, { ...VALID.capture, quality: 0, scale: 1e-9 }, { ...VALID.capture, quality: 1 });
  return out;
}

describe('protocol/lite validator agrees with the zod MessageSchema', () => {
  it('accepts every valid variant with the same output', () => {
    for (const m of validVariants()) {
      const z = parseMessage(m);
      expect(z, JSON.stringify(m)).not.toBeNull();
      expect(parseMessageLite(m)).toStrictEqual(z);
    }
  });

  it('agrees on 20 000 generated variants (valid and invalid)', () => {
    const r = rng(0xfc01);
    const bases = Object.values(VALID);
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 20_000; i++) {
      const m = mutate(bases[i % bases.length]!, r);
      const z = parseMessage(m);
      const l = parseMessageLite(m);
      if (z) accepted++;
      else rejected++;
      if ((z === null) !== (l === null) || (z && JSON.stringify(z) !== JSON.stringify(l))) {
        // Show the case that broke; toStrictEqual gives a readable diff.
        expect({ case: i, lite: l }).toStrictEqual({ case: i, lite: z });
      }
      if (z) expect(l).toStrictEqual(z);
    }
    // The corpus must exercise both sides.
    expect(accepted).toBeGreaterThan(1000);
    expect(rejected).toBeGreaterThan(5000);
  });

  it('agrees on every single-field substitution and deletion (exhaustive)', () => {
    let n = 0;
    for (const base of Object.values(VALID)) {
      for (const p of paths(base).filter((x) => x.length > 0)) {
        for (const junk of [...JUNK, DELETE]) {
          const m = clone(base);
          let parent = m as Record<string | number, unknown>;
          for (const k of p.slice(0, -1)) parent = parent[k] as Record<string | number, unknown>;
          const key = p[p.length - 1]!;
          if (junk === DELETE) {
            if (Array.isArray(parent)) parent.splice(key as number, 1);
            else delete parent[key];
          } else parent[key] = clone(junk);
          const z = parseMessage(m);
          const l = parseMessageLite(m);
          if ((z === null) !== (l === null)) expect({ path: p.join('.'), value: String(junk), lite: l }).toStrictEqual({ path: p.join('.'), value: String(junk), lite: z });
          if (z) expect(l).toStrictEqual(z);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(5000);
  });

  it('rejects non-messages', () => {
    for (const x of [null, undefined, 0, '', 'hello', [], [{ fc: 'hello' }], { fc: 'constructor' }, { fc: 'toString', v: 1 }, { fc: 1 }]) {
      expect(parseMessageLite(x)).toBeNull();
      expect(parseMessage(x)).toBeNull();
    }
  });

  it('covers every message type in the zod schema', () => {
    const zodTypes = MessageSchema.options.map((o) => o.shape.fc.value).sort();
    expect(Object.keys(VALID).sort()).toEqual(zodTypes);
    expect([...FRAME_TO_CANVAS, ...CANVAS_TO_FRAME].sort()).toEqual(zodTypes);
  });
});

describe('record.intercept (Player stage tap capture)', () => {
  it('lite and zod agree on the 50-target cap', () => {
    const ok = { fc: 'record', v: 1, frame: 'f1', nonce, on: false, intercept: Array.from({ length: 50 }, (_, i) => `#t${i}`) };
    const tooMany = { ...ok, intercept: [...ok.intercept, '#t50'] };
    expect(parseMessageLite(ok)).toEqual(parseMessage(ok));
    expect(parseMessageLite(ok)).not.toBeNull();
    expect(parseMessageLite(tooMany)).toBeNull();
    expect(parseMessage(tooMany)).toBeNull();
  });
});

describe('discovery probes (routes, clickables, click-probe)', () => {
  it('lite and zod agree on the list caps and integer index', () => {
    const route = { path: '/a' };
    const ok = { ...VALID['routes-result'], routes: Array.from({ length: 1000 }, () => route) };
    const tooMany = { ...ok, routes: [...ok.routes, route] };
    expect(parseMessageLite(ok)).toEqual(parseMessage(ok));
    expect(parseMessageLite(ok)).not.toBeNull();
    expect(parseMessageLite(tooMany)).toBeNull();
    expect(parseMessage(tooMany)).toBeNull();
    for (const index of [1.5, -1, Infinity, NaN, '1']) {
      const m = { ...VALID['click-probe'], index };
      expect(parseMessageLite(m)).toBeNull();
      expect(parseMessage(m)).toBeNull();
    }
  });

  it('every probe request has a matching -result type', () => {
    for (const p of lite.PROBES) {
      expect(CANVAS_TO_FRAME).toContain(p);
      expect(FRAME_TO_CANVAS).toContain(`${p}-result`);
    }
  });
});

describe('protocol/lite types and exports', () => {
  it('plain TS types equal the zod-inferred types', () => {
    expectTypeOf<lite.Message>().toEqualTypeOf<full.Message>();
    expectTypeOf<lite.MessageType>().toEqualTypeOf<full.MessageType>();
    expectTypeOf<lite.MockRule>().toEqualTypeOf<full.MockRule>();
    expectTypeOf<lite.Token>().toEqualTypeOf<full.Token>();
    expectTypeOf<lite.ScreenDecl>().toEqualTypeOf<full.ScreenDecl>();
    expectTypeOf<lite.ElementContext>().toEqualTypeOf<full.ElementContext>();
    expectTypeOf<lite.Rect>().toEqualTypeOf<full.Rect>();
    expectTypeOf<lite.MessageOf<'mocks'>>().toEqualTypeOf<full.MessageOf<'mocks'>>();
    expectTypeOf<lite.SniffedRoute>().toEqualTypeOf<full.SniffedRoute>();
    expectTypeOf<lite.Clickable>().toEqualTypeOf<full.Clickable>();
    expectTypeOf<lite.MessageOf<'routes-result'>>().toEqualTypeOf<full.MessageOf<'routes-result'>>();
  });

  it('`.` re-exports every lite runtime value unchanged', () => {
    for (const [k, v] of Object.entries(lite)) expect((full as Record<string, unknown>)[k], k).toBe(v);
  });

  it('lite sources do not import zod', async () => {
    const fs = await import('node:fs');
    for (const f of ['./lite.ts', './validate.ts']) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src).not.toMatch(/from ['"]zod['"]/);
      expect(src).not.toMatch(/from ['"]\.\/index['"]/);
    }
  });
});
