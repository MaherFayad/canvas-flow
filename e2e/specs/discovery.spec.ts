import { expect, test, type Canvas } from '../fixtures';
import { DEMO, DEMO_NOSDK } from '../fixtures/paths';

type Report = {
  framework: string | null;
  found: { sdk: number; router: number; crawl: number };
  added: { sdk: number; router: number; crawl: number };
  existing: number;
  needsSample: string[];
  samples: Array<{ route: string; path: string; from: string }>;
  skippedClicks: string[];
  authWall: string | null;
};
type Disc = { running: boolean; note?: string; report?: Report } | null;
type Screen = { id: string; path: string; route?: string; source?: string; section: string | null; states: string[] };

/** The demo's 12 routes (apps/demo/src/App.tsx), as patterns. */
const DEMO_ROUTES = [
  '/',
  '/interests',
  '/catalog',
  '/product/:id',
  '/wishlist',
  '/bag',
  '/checkout',
  '/order-confirmed',
  '/classes',
  '/classes/:id',
  '/classes/:id/book',
  '/classes/:id/booked',
];
const DYNAMIC = DEMO_ROUTES.filter((r) => r.includes(':'));

async function discovered(canvas: Canvas): Promise<{ screens: Screen[]; d: NonNullable<Disc> }> {
  await expect.poll(() => canvas.fc((fc) => (fc.ui.getState().discovery as Disc)?.running === false), { timeout: 120_000 }).toBe(true);
  const d = (await canvas.fc((fc) => fc.ui.getState().discovery)) as NonNullable<Disc>;
  return { screens: (await canvas.config()).screens as Screen[], d };
}
const routeOf = (s: Screen) => s.route ?? s.path;

test.describe('discover screens on an empty project', () => {
  test('without the SDK: router sniffing finds all 12 routes, dynamic ones with real samples, no duplicates', async ({ openCanvas }) => {
    const canvas = await openCanvas(DEMO_NOSDK);
    const { screens, d } = await discovered(canvas);
    const r = d.report!;
    expect(r.framework).toBe('react-router');
    expect(r.found.router).toBe(12);
    expect(screens.map(routeOf).sort()).toEqual([...DEMO_ROUTES].sort());
    expect(screens.every((s) => s.source === 'router')).toBe(true);
    // Each dynamic route has one screen whose path is a real page of that route.
    for (const route of DYNAMIC) {
      const s = screens.filter((x) => x.route === route);
      expect(s, route).toHaveLength(1);
      expect(s[0]!.path).not.toContain(':');
      const re = new RegExp('^' + route.replace(/:\w+/g, '[^/]+') + '$');
      expect(s[0]!.path, route).toMatch(re);
    }
    expect(r.needsSample).toEqual([]);
    expect(r.samples.filter((s) => s.from === 'crawl').map((s) => s.route)).toEqual(expect.arrayContaining(['/product/:id', '/classes/:id']));
    // Shared top-level segment → section; no SDK states.
    expect(screens.filter((s) => s.section === 'classes').map((s) => s.route ?? s.path)).toEqual(['/classes', '/classes/:id', '/classes/:id/book', '/classes/:id/booked']);
    expect(screens.every((s) => s.states.length === 1)).toBe(true);
    // Unsafe link-like elements were seen and not clicked (the catalog filter chips are toggles).
    expect(r.skippedClicks.some((s) => /toggle/.test(s))).toBe(true);
    expect(r.authWall).toBeNull();
    // The report is on screen.
    await expect(canvas.page.getByRole('region', { name: 'Discovery report' })).toContainText('From the router (react-router)');
    await canvas.shot('discovered-nosdk');

    // Discover again: everything is already there, nothing is duplicated, no undo step is added.
    const before = await canvas.fc((fc) => fc.project.temporal.getState().pastStates.length);
    await canvas.fc((fc) => fc.ui.getState().set({ discoverRun: fc.ui.getState().discoverRun + 1 }));
    await expect.poll(() => canvas.fc((fc) => fc.ui.getState().discovery?.running === true), { timeout: 10_000 }).toBe(true);
    const again = await discovered(canvas);
    expect(again.screens).toHaveLength(12);
    expect(again.d.report!.existing).toBe(12);
    expect(await canvas.fc((fc) => fc.project.temporal.getState().pastStates.length)).toBe(before);
  });

  test('with the SDK: all 12 from the SDK with their states and groups; the router sniff agrees', async ({ openCanvas }) => {
    const canvas = await openCanvas(DEMO);
    const { screens, d } = await discovered(canvas);
    const r = d.report!;
    expect(screens).toHaveLength(12);
    expect(screens.every((s) => s.source === 'sdk')).toBe(true);
    expect(r.added).toEqual({ sdk: 12, router: 0, crawl: 0 });
    // The router read independently finds the same 12 routes.
    expect(r.framework).toBe('react-router');
    expect(r.found.router).toBe(12);
    expect(screens.map(routeOf).sort()).toEqual([...DEMO_ROUTES].sort());
    const catalog = screens.find((s) => s.path === '/catalog')!;
    expect(catalog.states).toEqual(expect.arrayContaining(['default', 'loading', 'empty', 'partial', 'error']));
    expect(screens.find((s) => s.id === 'product')).toMatchObject({ path: '/product/canele-dinner-plate', route: '/product/:id', section: 'browse' });
    // One undo step for the whole discovery.
    expect(await canvas.fc((fc) => fc.project.temporal.getState().pastStates.length)).toBe(1);
  });
});
