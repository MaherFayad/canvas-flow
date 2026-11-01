import type { Frame } from '@playwright/test';
import { demoConfig, expect, test, type Canvas, type FcConfig } from '../fixtures';
import { DEMO } from '../fixtures/paths';

/**
 * Click inside a live canvas iframe with real mouse events at the element's
 * on-screen position (the frame is scaled by the canvas zoom).
 */
async function clickInFrame(canvas: Canvas, frame: Frame, selector: string) {
  const el = frame.locator(selector).first();
  await el.waitFor();
  // Position inside the frame's own viewport (CSS px, before the canvas zoom).
  const inner = await el.evaluate((n) => {
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  // The iframe's box on the canvas page; Playwright does not apply the canvas's CSS scale to frame coordinates.
  const outer = await (await frame.frameElement()).evaluate((f: Element) => {
    const r = f.getBoundingClientRect();
    return { x: r.x, y: r.y, scale: r.width / (f as HTMLElement).offsetWidth };
  });
  await canvas.page.mouse.click(outer.x + inner.x * outer.scale, outer.y + inner.y * outer.scale);
}

test('record 3 edges by clicking through the demo (Onboarding → product)', async ({ openCanvas }) => {
  const canvas = await openCanvas(DEMO);
  // Screens and states from the demo config, but no edges yet.
  await canvas.importConfig(demoConfig(DEMO, { edges: [] }));
  await canvas.setMode('Canvas');
  await expect.poll(() => canvas.fc((fc) => fc.rf?.getNodes().length ?? 0)).toBeGreaterThan(0);
  await canvas.centerOn(['welcome:default'], 0.7);
  await canvas.forceLive(['welcome:default']);
  await canvas.waitReady('welcome:default');

  await canvas.page.keyboard.press('r');
  await expect.poll(() => canvas.fc((fc) => fc.ui.getState().recording)).toBe(true);

  const f = await canvas.waitFrame('welcome:default');
  const edges = (): Promise<FcConfig['edges']> => canvas.fc((fc) => fc.project.getState().config.edges);

  // 1. Welcome → Get started → /interests
  await clickInFrame(canvas, f, '[data-fc="get-started"]');
  await expect.poll(async () => (await edges()).length).toBe(1);
  await expect(f.locator('[data-fc="interests-continue"]')).toBeVisible();

  // 2. Pick interests → pick two → Continue → /catalog
  await clickInFrame(canvas, f, '[data-fc^="interest-"] >> nth=0');
  await clickInFrame(canvas, f, '[data-fc^="interest-"] >> nth=1');
  await clickInFrame(canvas, f, '[data-fc="interests-continue"]');
  await expect.poll(async () => (await edges()).length).toBe(2);
  await expect(f.locator('[data-fc="product-card"]').first()).toBeVisible();

  // 3. Catalog → product card → /product/<id>
  await clickInFrame(canvas, f, '[data-fc="product-card"]');
  await expect.poll(async () => (await edges()).length).toBe(3);

  const got = await edges();
  expect(got.map((e) => [e.from.screen, e.to.screen, e.trigger.target])).toEqual([
    ['welcome', 'pick-interests', '[data-fc="get-started"]'],
    ['pick-interests', 'catalog', '[data-fc="interests-continue"]'],
    ['catalog', expect.stringMatching(/^product/), '[data-fc="product-card"]'],
  ]);
  expect(got[0]!.trigger.label).toMatch(/Get started/);

  await canvas.page.keyboard.press('r');
  await expect(canvas.page.locator('header [role="status"]')).toContainText(/unsaved/);

  // Undo / redo of a recorded edge is one step each.
  await canvas.fc((fc) => fc.project.temporal.getState().undo());
  expect(await edges()).toHaveLength(2);
  await canvas.fc((fc) => fc.project.temporal.getState().redo());
  expect(await edges()).toHaveLength(3);
  await canvas.shot('recorded-edges');
});
