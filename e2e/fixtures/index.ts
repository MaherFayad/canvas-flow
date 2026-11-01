/**
 * Playwright fixtures: a fresh Chromium profile with the unpacked extension
 * loaded (persistent context, new headless), its extension id, and a canvas
 * page helper. Every test gets its own profile, so chrome.storage starts empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test as base, chromium, expect, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { DEMO_CONFIG, EXT_DIR } from './paths';

export { expect };

type Json = Record<string, unknown>;

export interface FcConfig extends Json {
  project: { name: string; origin: string };
  screens: Array<{ id: string; path: string; states: string[]; section?: string; title?: string }>;
  edges: Array<Json & { id: string; from: { screen: string; state?: string }; to: { screen: string; state?: string }; trigger: { label?: string; target?: string } }>;
}

/** The demo's checked-in config, pointed at `origin`. */
export function demoConfig(origin: string, patch: Partial<FcConfig> = {}): FcConfig {
  const c = JSON.parse(fs.readFileSync(DEMO_CONFIG, 'utf8')) as FcConfig;
  return { ...c, project: { ...c.project, origin }, ...patch };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns a truthy value (errors count as "not yet"). Returns null on timeout. */
export async function until<T>(fn: () => Promise<T> | T, ms = 15_000, step = 150): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

export class Canvas {
  constructor(
    readonly page: Page,
    readonly origin: string,
  ) {}

  /** Evaluate against the canvas debug handle (`window.__fc`: zustand stores + React Flow instance). */
  fc<T>(fn: (fc: any) => T): Promise<T> {
    return this.page.evaluate(`(${fn.toString()})(window.__fc)`) as Promise<T>;
  }

  async config(): Promise<FcConfig> {
    return this.fc((fc) => fc.project.getState().config);
  }

  /** Import a config through the UI: project menu → Import config… → paste → Import. */
  async importConfig(config: FcConfig) {
    const { page } = this;
    // An empty project starts a discovery crawl on open; let it finish first.
    await expect.poll(() => this.fc((fc) => !fc.ui.getState().discovery?.running), { timeout: 60_000 }).toBe(true);
    await page.locator('header').getByRole('button', { name: /localhost|Helka|127\.0\.0\.1/ }).first().click();
    await page.getByRole('menuitem', { name: /Import config/ }).click();
    await page.getByLabel('Config JSON').fill(JSON.stringify(config));
    await page.locator('dialog').getByRole('button', { name: 'Import', exact: true }).click();
    await expect.poll(() => this.fc((fc) => fc.project.getState().config.project.name)).toBe(config.project.name);
  }

  /** The live iframe for `screen:state`, if any. */
  frame(key: string): Frame | undefined {
    const [screen, state] = key.split(':');
    return this.page.frames().find((f) => {
      if (!f.url().startsWith(this.origin)) return false;
      const id = new URL(f.url()).searchParams.get('fc-frame') ?? '';
      return id.startsWith(`${screen}~${state}~`);
    });
  }

  async waitFrame(key: string, ms = 20_000): Promise<Frame> {
    const f = await until(() => this.frame(key), ms);
    if (!f) throw new Error(`no live frame for ${key}`);
    return f;
  }

  async waitReady(key: string, ms = 20_000): Promise<void> {
    await expect.poll(() => this.fc((fc) => fc.ui.getState().status), { timeout: ms }).toHaveProperty([key], 'ready');
  }

  async setMode(mode: 'Player' | 'Canvas') {
    await this.page.getByRole('group', { name: 'View' }).getByRole('button', { name: mode, exact: true }).click();
  }

  /** Force frames live in Canvas mode (same path as hovering a frame for 400 ms). */
  async forceLive(keys: string[]) {
    await this.page.evaluate(`(() => { const ui = window.__fc.ui.getState(); for (const k of ${JSON.stringify(keys)}) ui.force(k, true); })()`);
  }

  /** Centre the React Flow camera on the nodes for `keys` at `zoom`. */
  async centerOn(keys: string[], zoom = 0.5) {
    await this.page.evaluate(
      `(() => {
        const rf = window.__fc.rf;
        const ns = rf.getNodes().filter((n) => ${JSON.stringify(keys)}.includes(n.id));
        if (!ns.length) throw new Error('no nodes');
        const abs = (n) => { let x = n.position.x, y = n.position.y, p = n.parentId; while (p) { const q = rf.getNode(p); x += q.position.x; y += q.position.y; p = q.parentId; } return { x, y, w: n.measured?.width ?? n.width ?? 440, h: n.measured?.height ?? n.height ?? 956 }; };
        const bs = ns.map(abs);
        const x0 = Math.min(...bs.map((b) => b.x)), x1 = Math.max(...bs.map((b) => b.x + b.w));
        const y0 = Math.min(...bs.map((b) => b.y)), y1 = Math.max(...bs.map((b) => b.y + b.h));
        rf.setCenter((x0 + x1) / 2, (y0 + y1) / 2, { zoom: ${zoom} });
      })()`,
    );
  }

  async shot(name: string) {
    const file = path.join(test.info().outputDir, `${name}.png`);
    await this.page.screenshot({ path: file });
    await test.info().attach(name, { path: file, contentType: 'image/png' });
  }
}

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  openCanvas: (origin: string) => Promise<Canvas>;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(EXT_DIR, 'manifest.json'))) throw new Error(`extension not built: ${EXT_DIR}`);
    // channel 'chromium' = full Chromium in new headless mode (headless-shell cannot load extensions).
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      viewport: { width: 1600, height: 900 },
      acceptDownloads: true,
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
    await use(new URL(sw.url()).host);
  },
  openCanvas: async ({ context, extensionId }, use) => {
    const errors: string[] = [];
    await use(async (origin) => {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`chrome-extension://${extensionId}/canvas.html?origin=${encodeURIComponent(origin)}`);
      await expect.poll(() => page.evaluate(() => !!(window as unknown as { __fc?: unknown }).__fc)).toBe(true);
      return new Canvas(page, origin);
    });
    expect(errors, 'uncaught errors in the canvas page').toEqual([]);
  },
});
