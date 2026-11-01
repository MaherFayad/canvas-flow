// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_TO_MAIN_EVENT, BRIDGE_TO_SDK_EVENT, MAIN_EVENT, SDK_EVENT, emitInPage, onInPage } from '@flowcanvas/protocol';
import { startBridge, type Bridge } from './bridge';
import { startDiscover } from '../main/discover';

const EXT = 'chrome-extension://abcdefghijklmnop';
const NONCE = '0123456789abcdef0123456789abcdef';

function setup(search = '?fc-frame=f1&fc-state=empty', extra: Partial<Parameters<typeof startBridge>[0]> = {}) {
  history.replaceState({}, '', '/catalog' + search);
  const sent: Array<Record<string, unknown>> = [];
  const parent = { postMessage: vi.fn((m: Record<string, unknown>, o: string) => (expect(o).toBe(EXT), sent.push(m))) };
  Object.defineProperty(window, 'parent', { configurable: true, value: parent });
  Object.defineProperty(window, 'top', { configurable: true, value: parent });
  window.name = '';
  const bridge = startBridge({ win: window, extensionOrigin: EXT, autoReadyMs: 20, ...extra });
  const fromCanvas = (data: Record<string, unknown>, origin = EXT) =>
    window.dispatchEvent(new MessageEvent('message', { data: { v: 1, frame: 'f1', nonce: NONCE, ...data }, origin }));
  return { bridge, sent, fromCanvas };
}

let current: Bridge | null = null;
afterEach(() => {
  current?.stop();
  current = null;
});

describe('bridge', () => {
  it('is inert outside a canvas frame', () => {
    history.replaceState({}, '', '/plain');
    Object.defineProperty(window, 'top', { configurable: true, value: window });
    expect(startBridge({ win: window, extensionOrigin: EXT })).toBeNull();
  });

  it('says hello, accepts welcome only from the extension origin, then flushes buffered messages', async () => {
    const { bridge, sent, fromCanvas } = setup();
    current = bridge;
    expect(sent[0]).toMatchObject({ fc: 'hello', frame: 'f1', nonce: null, url: '/catalog' });
    // SDK screens before welcome are buffered.
    emitInPage(SDK_EVENT, { type: 'screens', screens: [{ id: 'a', path: '/' }] });
    expect(sent).toHaveLength(1);
    fromCanvas({ fc: 'welcome', state: 'empty' }, 'http://evil.localhost');
    expect(sent).toHaveLength(1);
    fromCanvas({ fc: 'welcome', state: 'empty' });
    expect(sent[1]).toMatchObject({ fc: 'screens', nonce: NONCE });
    // After welcome, a wrong nonce is ignored.
    fromCanvas({ fc: 'query', id: 'q1', selector: 'body', nonce: 'ffffffffffffffff' });
    expect(sent).toHaveLength(2);
    fromCanvas({ fc: 'query', id: 'q2', selector: 'body' });
    expect(sent[2]).toMatchObject({ fc: 'query-result', id: 'q2', found: true });
    // Auto-ready after load.
    await new Promise((r) => setTimeout(r, 40));
    expect(sent.some((m) => m.fc === 'ready')).toBe(true);
  });

  it('answers an SDK hello with welcome, even when the SDK says hello first', () => {
    const { bridge, fromCanvas } = setup();
    current = bridge;
    const got: unknown[] = [];
    const off = onInPage(BRIDGE_TO_SDK_EVENT, (m) => got.push(m));
    emitInPage(SDK_EVENT, { type: 'hello' });
    expect(got).toHaveLength(0);
    fromCanvas({ fc: 'welcome', state: 'empty' });
    expect(got).toEqual([{ type: 'welcome', state: 'empty' }]);
    emitInPage(SDK_EVENT, { type: 'hello' });
    expect(got).toHaveLength(2);
    off();
  });

  it('forwards mocks to MAIN (and again on main-ready), MAIN nav to the canvas', () => {
    const { bridge, sent, fromCanvas } = setup();
    current = bridge;
    const main: unknown[] = [];
    const off = onInPage(BRIDGE_TO_MAIN_EVENT, (m) => main.push(m));
    fromCanvas({ fc: 'welcome', state: 'empty' });
    fromCanvas({ fc: 'mocks', rules: [] });
    expect(main).toEqual([{ type: 'mocks', rules: [] }]);
    emitInPage(MAIN_EVENT, { type: 'main-ready' });
    expect(main).toHaveLength(2);
    emitInPage(MAIN_EVENT, { type: 'nav', from: 'http://localhost/catalog?fc-frame=f1', to: 'http://localhost/product?fc-frame=f1' });
    expect(sent.at(-1)).toMatchObject({ fc: 'nav', from: '/catalog', to: '/product' });
    off();
  });

  it('record mode reports clicks with selector and text; tokens apply + reach the SDK', () => {
    const { bridge, sent, fromCanvas } = setup();
    current = bridge;
    document.body.innerHTML = '<button data-fc="go"><span>Get started</span></button>';
    fromCanvas({ fc: 'welcome', state: 'empty' });
    fromCanvas({ fc: 'record', on: true });
    document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sent.at(-1)).toMatchObject({ fc: 'click', target: '[data-fc="go"]', text: 'Get started' });
    fromCanvas({ fc: 'record', on: false });
    const n = sent.length;
    document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sent).toHaveLength(n);
    const sdk: unknown[] = [];
    const off = onInPage(BRIDGE_TO_SDK_EVENT, (m) => sdk.push(m));
    fromCanvas({ fc: 'tokens', vars: { '--x': '4px' } });
    expect(document.documentElement.style.getPropertyValue('--x')).toBe('4px');
    expect(sdk).toEqual([{ type: 'tokens', vars: { '--x': '4px' } }]);
    off();
  });

  it('answers element-at; relays discovery probes to the MAIN world without the nonce (links, routes, clickables)', async () => {
    const loadDiscover = vi.fn(async () => {
      startDiscover(window); // what the background injects (discover.js)
    });
    const { bridge, sent, fromCanvas } = setup(undefined, { loadDiscover });
    current = bridge;
    const main: Array<Record<string, unknown>> = [];
    const off = onInPage<Record<string, unknown>>(BRIDGE_TO_MAIN_EVENT, (m) => main.push(m));
    document.body.innerHTML = '<a href="/about">About</a><nav><button type="button">Classes</button><button type="button">Log out</button></nav>';
    fromCanvas({ fc: 'welcome', state: 'empty' });
    fromCanvas({ fc: 'element-at', id: 'e1', x: 1, y: 1 });
    expect(sent.at(-1)).toMatchObject({ fc: 'element-result', id: 'e1' });
    fromCanvas({ fc: 'links', id: 'l1' });
    fromCanvas({ fc: 'routes', id: 'r1' });
    await vi.waitFor(() => expect(sent.some((m) => m.fc === 'routes-result')).toBe(true));
    expect(loadDiscover).toHaveBeenCalledTimes(1);
    expect(sent.find((m) => m.fc === 'links-result')).toMatchObject({ id: 'l1', links: ['/about'], nonce: NONCE });
    expect(sent.find((m) => m.fc === 'routes-result')).toMatchObject({ id: 'r1', framework: null, routes: [] });
    expect(main.filter((m) => m.type === 'probe').every((m) => !JSON.stringify(m).includes(NONCE))).toBe(true);
    // happy-dom has no layout boxes: stub getClientRects so the nav buttons count as visible.
    const rects = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    fromCanvas({ fc: 'clickables', id: 'k1' });
    await vi.waitFor(() => expect(sent.some((m) => m.fc === 'clickables-result')).toBe(true));
    expect(sent.find((m) => m.fc === 'clickables-result')!.items).toEqual([
      { index: 0, label: 'Classes', target: 'button "Classes"' },
      { index: 1, label: 'Log out', target: 'button "Log out"', skip: '"log out"' },
    ]);
    // Not a discovery frame (id "f1"): probe clicks are refused even for safe targets.
    fromCanvas({ fc: 'click-probe', id: 'p1', index: 0, label: 'Classes' });
    await vi.waitFor(() => expect(sent.some((m) => m.fc === 'click-probe-result')).toBe(true));
    expect(sent.find((m) => m.fc === 'click-probe-result')).toMatchObject({ ok: false });
    rects.mockRestore();
    off();
  });

  it('intercepts Player targets: reports the matched selector and cancels the default action', () => {
    const { bridge, sent, fromCanvas } = setup();
    current = bridge;
    document.body.innerHTML = '<a href="/next" data-fc="go"><span>Get started</span></a><button id="other">Other</button>';
    let appSaw = 0;
    document.body.addEventListener('click', () => appSaw++);
    fromCanvas({ fc: 'welcome', state: 'empty' });
    fromCanvas({ fc: 'record', on: false, intercept: ['[data-fc="go"]'] });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('span')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(appSaw).toBe(0);
    expect(sent.at(-1)).toMatchObject({ fc: 'click', target: '[data-fc="go"]', text: 'Get started' });
    // Other clicks pass through untouched and are not reported (record is off).
    const n = sent.length;
    document.getElementById('other')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sent).toHaveLength(n);
    expect(appSaw).toBe(1);
    // A global record toggle keeps the list; [] clears it.
    fromCanvas({ fc: 'record', on: false });
    document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sent).toHaveLength(n + 1);
    fromCanvas({ fc: 'record', on: false, intercept: [] });
    document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sent).toHaveLength(n + 1);
  });

  it('captures with the lazily loaded library, once, and reports errors', async () => {
    const shot = vi.fn(async (_w: Window, _scale: number, _quality: number) => 'data:image/webp;base64,AAAA');
    const load = vi.fn(async () => shot);
    const { bridge, sent, fromCanvas } = setup(undefined, { loadCapturer: load });
    current = bridge;
    fromCanvas({ fc: 'welcome', state: 'empty' });
    expect(load).not.toHaveBeenCalled();
    fromCanvas({ fc: 'capture', id: 'c1', scale: 0.5, quality: 0.8 });
    fromCanvas({ fc: 'capture', id: 'c2', scale: 0.5, quality: 0.8 });
    await vi.waitFor(() => expect(sent.filter((m) => m.fc === 'capture-result')).toHaveLength(2), { timeout: 3000 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(shot.mock.calls[0]!.slice(1)).toEqual([0.5, 0.8]);
    expect(sent.find((m) => m.id === 'c1')).toMatchObject({ webp: 'data:image/webp;base64,AAAA' });
    shot.mockRejectedValueOnce(new Error('tainted'));
    fromCanvas({ fc: 'capture', id: 'c3', scale: 0.5, quality: 0.8 });
    await vi.waitFor(() => expect(sent.find((m) => m.id === 'c3')).toMatchObject({ webp: null, error: 'tainted' }), { timeout: 3000 });
  });
});
