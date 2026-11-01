import fs from 'node:fs';
import { parseConfig } from '@flowcanvas/config';
import { demoConfig, expect, test } from '../fixtures';
import { DEMO } from '../fixtures/paths';

const cssVar = (f: import('@playwright/test').Frame, name: string) =>
  f.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('change a token and see it in every live frame; Discard all reverts', async ({ openCanvas }) => {
  const canvas = await openCanvas(DEMO);
  await canvas.importConfig(demoConfig(DEMO));
  await canvas.waitReady('welcome:default');

  await canvas.page.getByRole('button', { name: /^Tokens/ }).click();
  await expect(canvas.page.getByRole('complementary', { name: 'Tokens' })).toBeVisible();
  const base = await expect
    .poll(() => canvas.fc((fc) => (fc.ui.getState().baseTokens ?? []).length))
    .toBeGreaterThan(5)
    .then(() => canvas.fc((fc) => fc.ui.getState().baseTokens as Array<{ name: string; value: string; type: string }>));
  expect(base.find((t) => t.name === '--surface')?.type).toBe('color');
  expect(base.find((t) => t.name === '--text-display')).toMatchObject({ value: '27px', type: 'length' });

  // Every live frame that has hand-shaken (status ready).
  const live = await canvas.fc((fc) => {
    const s = fc.ui.getState();
    return [...s.live].filter((k: string) => s.status[k] === 'ready') as string[];
  });
  expect(live.length).toBeGreaterThan(0);
  const frames = await Promise.all(live.map((k) => canvas.waitFrame(k)));
  for (const f of frames) await expect.poll(() => cssVar(f, '--text-display')).toBe('27px');

  const welcome = await canvas.waitFrame('welcome:default');
  const h1Size = () => welcome.evaluate(() => parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize));
  const before = await h1Size();

  await canvas.page.getByLabel('--text-display slider').fill('40');
  for (const f of frames) await expect.poll(() => cssVar(f, '--text-display')).toBe('40px');
  // The headline actually re-rendered larger (its size derives from the token).
  await expect.poll(h1Size).toBeGreaterThan(before);
  await canvas.shot('tokens-changed');

  await canvas.page.getByRole('button', { name: 'Discard all' }).click();
  for (const f of frames) await expect.poll(() => cssVar(f, '--text-display')).toBe('27px');
});

test('export config: download event and the file parses with parseConfig', async ({ openCanvas }) => {
  const canvas = await openCanvas(DEMO);
  const config = demoConfig(DEMO);
  await canvas.importConfig(config);
  // One edit so the export carries a change: retitle the first edge's label through the store.
  await canvas.fc((fc) => {
    const s = fc.project.getState();
    const c = s.config;
    s.load?.({ ...c, edges: c.edges.map((e: any, i: number) => (i === 0 ? { ...e, trigger: { ...e.trigger, label: 'Start here' } } : e)) }, s.saved);
  });

  await canvas.page.locator('header').getByRole('button', { name: /Helka/ }).first().click();
  const [download] = await Promise.all([
    canvas.page.waitForEvent('download'),
    canvas.page.getByRole('menuitem', { name: /Download flowcanvas\.config\.json/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('flowcanvas.config.json');
  const file = test.info().outputPath('flowcanvas.config.json');
  await download.saveAs(file);
  const parsed = parseConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n')).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.config.screens.map((s) => s.id)).toEqual(config.screens.map((s) => s.id));
  expect(parsed.config.edges).toHaveLength(config.edges.length);
  expect(parsed.config.edges[0]!.trigger.label).toBe('Start here');
  // Saving clears the unsaved counter.
  await expect(canvas.page.locator('header [role="status"]')).toHaveText('');
});
