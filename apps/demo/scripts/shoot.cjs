/**
 * Screenshots of the demo at phone and desktop sizes, plus forced states.
 * States are shown the way the canvas does it: the page sits in an iframe with
 * ?fc-frame&fc-state, and a stand-in bridge answers the SDK hello with a welcome.
 *
 *   pnpm dev   # in another terminal
 *   node scripts/shoot.cjs [filter]   # uses a local or globally installed playwright
 *
 * Output: scripts/out/*.png (gitignored).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
  }
}
const { chromium } = loadPlaywright();

const ORIGIN = process.env.ORIGIN || 'http://localhost:5173';
const OUT = path.join(__dirname, 'out');
const filter = process.argv[2] || '';
const config = require('../flowcanvas.config.json');

const VIEWPORTS = { phone: { width: 440, height: 956 }, desktop: { width: 1440, height: 900 } };

/** Stand-in for the extension bridge: answers SDK hello with a welcome carrying fc-state. */
const fakeBridge = () => {
  const p = new URLSearchParams(location.search);
  if (!p.has('fc-frame')) return;
  const state = p.get('fc-state') || 'default';
  window.addEventListener('flowcanvas:sdk', (e) => {
    const m = JSON.parse(e.detail);
    window.__fcSent = (window.__fcSent || []).concat(m.type);
    if (m.type === 'hello') {
      setTimeout(() => window.dispatchEvent(new CustomEvent('flowcanvas:bridge', { detail: JSON.stringify({ type: 'welcome', state }) })), 20);
    }
  });
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const shots = [];

  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    await ctx.addInitScript(fakeBridge);
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`${vpName} ${page.url()}: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`${vpName} ${page.url()}: ${e.message}`));

    for (const s of config.screens) {
      for (const state of s.states) {
        const name = `${s.id}--${state}--${vpName}`;
        if (filter && !name.includes(filter)) continue;
        const src = `${ORIGIN}${s.path}?fc-frame=${s.id}-${state}&fc-state=${state}`;
        await page.setContent(
          `<html><body style="margin:0"><iframe src="${src}" style="border:0;width:${vp.width}px;height:${vp.height}px;display:block"></iframe></body></html>`,
        );
        const frame = await (await page.waitForSelector('iframe')).contentFrame();
        await frame.waitForLoadState('load');
        // ready is sent once data settles (or right away for loading); 1.5 s auto-ready otherwise
        await frame.waitForFunction(() => (window.__fcSent || []).includes('ready'), null, { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(150);
        const info = await frame.evaluate(() => ({ sent: window.__fcSent || [], hScroll: document.documentElement.scrollWidth > innerWidth }));
        if (info.hScroll) errors.push(`${name}: horizontal scroll`);
        if (!info.sent.includes('ready')) errors.push(`${name}: no ready (sent ${info.sent.join(',')})`);
        const file = path.join(OUT, `${name}.png`);
        await page.screenshot({ path: file });
        shots.push(path.basename(file));
      }
    }
    await ctx.close();
  }

  // No-SDK path: the app derives the same states from what /api returns (as the mock layer would answer).
  if (!filter || 'nosdk'.includes(filter) || filter === 'nosdk') {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.phone });
    const page = await ctx.newPage();
    for (const [state, rules] of Object.entries(config.mocks)) {
      const rule = rules[0];
      await page.unrouteAll();
      await page.route('**/api/products', (route) =>
        rule.delay === 'forever' ? undefined : route.fulfill({ status: rule.status, contentType: 'application/json', body: JSON.stringify(rule.body ?? null) }),
      );
      await page.goto(`${ORIGIN}/catalog`);
      await page.waitForTimeout(400);
      const file = path.join(OUT, `nosdk-${state.replace(':', '--')}.png`);
      await page.screenshot({ path: file });
      shots.push(path.basename(file));
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`${shots.length} screenshots in ${OUT}`);
  if (errors.length) {
    console.log('Problems:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
