import type { Frame } from '@playwright/test';
import { demoConfig, expect, test, type Canvas } from '../fixtures';
import { DEMO, DEMO_NOSDK } from '../fixtures/paths';

const STATES = ['default', 'loading', 'empty', 'partial', 'error'] as const;

/** What each Catalog state looks like in the demo. */
async function expectCatalogState(f: Frame, state: (typeof STATES)[number]) {
  const busy = f.locator('[aria-busy="true"]');
  switch (state) {
    case 'default':
      await expect(f.locator('.product-grid .product-link').first()).toBeVisible();
      expect(await f.locator('.product-grid .product-link').count()).toBeGreaterThanOrEqual(8);
      await expect(f.getByText('didn’t load')).toHaveCount(0);
      break;
    case 'loading':
      await expect(busy).toBeVisible();
      await expect(f.getByRole('status')).toHaveText('Loading the collection');
      break;
    case 'empty':
      await expect(f.getByText('The last firing sold out')).toBeVisible();
      break;
    case 'partial':
      await expect(f.getByText(/6 pieces didn’t load/)).toBeVisible();
      expect(await f.locator('.product-grid .product-link').count()).toBe(6);
      break;
    case 'error':
      await expect(f.getByText('We couldn’t load the shop')).toBeVisible();
      break;
  }
}

async function showCatalogRow(canvas: Canvas) {
  await canvas.setMode('Canvas');
  const keys = STATES.map((s) => `catalog:${s}`);
  await expect.poll(() => canvas.fc((fc) => fc.rf?.getNodes().length ?? 0)).toBeGreaterThan(0);
  await canvas.centerOn(keys, 0.5);
  await canvas.forceLive(keys);
  for (const k of keys) await canvas.waitFrame(k);
}

test.describe('force all 5 Catalog states', () => {
  test('via the SDK (fc-state + handshake, app fixtures)', async ({ openCanvas }) => {
    const canvas = await openCanvas(DEMO);
    await canvas.importConfig(demoConfig(DEMO));
    await showCatalogRow(canvas);
    for (const s of STATES) {
      const f = await canvas.waitFrame(`catalog:${s}`);
      await test.step(`catalog:${s}`, () => expectCatalogState(f, s));
      expect(await f.evaluate(() => new URL(location.href).searchParams.get('fc-state'))).toBe(s);
    }
    // SDK frames report hasSdk and become ready (loading calls fc.ready() itself).
    for (const s of STATES) await canvas.waitReady(`catalog:${s}`);
    await expect.poll(() => canvas.fc((fc) => fc.ui.getState().sdk['catalog:empty'])).toBe(true);
    await canvas.shot('catalog-states-sdk');
  });

  test('via mocks (no SDK: MAIN-world fetch mock layer)', async ({ context, openCanvas }) => {
    // Sanity: the no-SDK build really has no SDK and a normal tab is never mocked.
    const tab = await context.newPage();
    await tab.goto(DEMO_NOSDK + '/catalog');
    await expect(tab.locator('.product-grid .product-link').first()).toBeVisible();
    await tab.close();

    const canvas = await openCanvas(DEMO_NOSDK);
    await canvas.importConfig(demoConfig(DEMO_NOSDK));
    await showCatalogRow(canvas);
    for (const s of STATES) {
      const f = await canvas.waitFrame(`catalog:${s}`);
      await test.step(`catalog:${s}`, () => expectCatalogState(f, s));
    }
    expect(await canvas.fc((fc) => fc.ui.getState().sdk['catalog:empty'] ?? false)).toBe(false);
    await canvas.shot('catalog-states-mocks');
  });
});
