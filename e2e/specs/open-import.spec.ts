import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { demoConfig, expect, test, until } from '../fixtures';
import { DEMO } from '../fixtures/paths';

test.describe('open the canvas and import a config', () => {
  test('imports the demo config through the UI and hand-shakes with SDK frames', async ({ openCanvas }) => {
    const canvas = await openCanvas(DEMO);
    const config = demoConfig(DEMO);
    await canvas.importConfig(config);

    const got = await canvas.config();
    expect(got.screens.map((s) => s.id)).toEqual(config.screens.map((s) => s.id));
    expect(got.edges).toHaveLength(config.edges.length);

    // Player is the default view: the first step goes live, says hello and becomes ready.
    await canvas.waitReady('welcome:default');
    const welcome = await canvas.waitFrame('welcome:default');
    await expect(welcome.locator('[data-fc="get-started"]')).toBeVisible();
    // The SDK in the demo announced its screens.
    await expect.poll(() => canvas.fc((fc) => Object.values(fc.ui.getState().sdk).some(Boolean))).toBe(true);
    // The iframe viewport is the device's CSS width (iPhone 16 Pro Max preset: 440).
    expect(await welcome.evaluate(() => innerWidth)).toBe(440);
    await canvas.shot('player-after-import');
  });

  test('working copy survives a reload of the canvas tab', async ({ openCanvas }) => {
    const canvas = await openCanvas(DEMO);
    await canvas.importConfig(demoConfig(DEMO, { edges: [] }));
    await canvas.page.waitForTimeout(600); // persist is debounced 300 ms
    await canvas.page.reload();
    const restored = await until(() => canvas.fc((fc) => fc?.project.getState().config), 10_000);
    expect(restored?.project.name).toBe('Helka ceramics');
    expect(restored?.screens).toHaveLength(12);
    expect(restored?.edges).toHaveLength(0);
  });
});

test.describe('header stripping is scoped to canvas sub-frames', () => {
  let server: http.Server;
  let origin = '';
  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });
      res.end(`<!doctype html><title>x</title><h1 id="h">framed ${req.url}</h1><a href="/b">b</a>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

  test('top-level pages keep X-Frame-Options; canvas frames still render', async ({ context, openCanvas }) => {
    const tab = await context.newPage();
    const resp = await tab.goto(origin + '/');
    expect(resp?.headers()['x-frame-options']).toBe('DENY');
    await tab.close();

    const canvas = await openCanvas(origin);
    await canvas.importConfig({
      version: 1,
      project: { name: 'Headers', origin },
      screens: [{ id: 'home', title: 'Home', path: '/', states: ['default'] }],
      edges: [],
    } as never);
    const f = await canvas.waitFrame('home:default');
    await expect(f.locator('#h')).toContainText('framed /');
  });
});
