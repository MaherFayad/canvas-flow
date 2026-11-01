import { demoConfig, expect, test } from '../fixtures';
import { DEMO } from '../fixtures/paths';

test('Player steps through Onboarding with the arrow keys; neighbours are live', async ({ openCanvas }) => {
  const canvas = await openCanvas(DEMO);
  await canvas.importConfig(demoConfig(DEMO));
  const step = () => canvas.fc((fc) => fc.ui.getState().step?.key ?? null);

  await canvas.waitReady('welcome:default');
  // Active step and its neighbour are live (frames pre-load before you step).
  await expect.poll(() => canvas.fc((fc) => fc.ui.getState().live.has('pick-interests:default'))).toBe(true);
  await canvas.shot('player-step-1');

  await canvas.page.keyboard.press('ArrowRight');
  await expect.poll(step).toBe('pick-interests:default');
  await canvas.waitReady('pick-interests:default');

  await canvas.page.keyboard.press('ArrowRight');
  await expect.poll(step).toBe('catalog:default');
  await canvas.waitReady('catalog:default');
  const catalog = await canvas.waitFrame('catalog:default');
  await expect(catalog.locator('.product-grid .product-link').first()).toBeVisible();
  await canvas.shot('player-step-3');

  await canvas.page.keyboard.press('ArrowLeft');
  await expect.poll(step).toBe('pick-interests:default');
});

test('Player sidebar jumps to another section and pans the board there', async ({ openCanvas }) => {
  const canvas = await openCanvas(DEMO);
  await canvas.importConfig(demoConfig(DEMO));
  await canvas.waitReady('welcome:default');
  const board = canvas.page.getByLabel('Flow board');
  const y0 = await board.evaluate((b) => b.scrollTop);
  await canvas.page.getByRole('navigation', { name: 'Flows' }).getByRole('button', { name: /Bag/ }).first().click();
  await expect.poll(() => canvas.fc((fc) => fc.ui.getState().step?.key ?? null)).toBe('bag:default');
  await expect.poll(() => board.evaluate((b) => b.scrollTop)).toBeGreaterThan(y0 + 200);
  await canvas.waitReady('bag:default');
});
