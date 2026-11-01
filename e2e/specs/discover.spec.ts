import { expect, test } from '../fixtures';
import { DEMO, DEMO_NOSDK } from '../fixtures/paths';

type Disc = { running: boolean; done: number; note?: string } | null;

test.describe('discover screens on an empty project', () => {
  test('crawl finds the demo routes without the SDK (links only, 2 levels)', async ({ openCanvas }) => {
    const canvas = await openCanvas(DEMO_NOSDK);
    await expect
      .poll(() => canvas.fc((fc) => (fc.ui.getState().discovery as Disc)?.running === false), { timeout: 60_000 })
      .toBe(true);
    const paths = (await canvas.config()).screens.map((s) => s.path);
    // Welcome links to /interests and /catalog; level 2 reaches product pages and classes.
    for (const p of ['/', '/interests', '/catalog']) expect(paths, `discovered ${p}`).toContain(p);
    expect(paths.length).toBeGreaterThanOrEqual(4);
    expect(paths.every((p) => !/logout|delete|remove/i.test(p))).toBe(true);
    // No SDK: every discovered screen has only the default state.
    expect((await canvas.config()).screens.every((s) => s.states.length === 1)).toBe(true);
    await canvas.shot('discovered-nosdk');
  });

  test('with the SDK, discovery adds the declared screens and their states', async ({ openCanvas }) => {
    const canvas = await openCanvas(DEMO);
    await expect
      .poll(() => canvas.fc((fc) => (fc.ui.getState().discovery as Disc)?.running === false), { timeout: 60_000 })
      .toBe(true);
    const screens = (await canvas.config()).screens;
    const catalog = screens.find((s) => s.path === '/catalog');
    expect(catalog, 'catalog discovered').toBeTruthy();
    expect(catalog!.states).toEqual(expect.arrayContaining(['default', 'loading', 'empty', 'partial', 'error']));
    expect(screens.length).toBeGreaterThanOrEqual(12);
  });
});
