import { describe, expect, it, vi } from 'vitest';
import type { MockRule } from '@flowcanvas/protocol';
import { installMockLayer, type MockWindow } from './mock';
import { hmrClassifier } from './main';

/** Minimal XHR stand-in: records whether the real send ran. */
class FakeXHR extends EventTarget {
  responseType: XMLHttpRequestResponseType = '';
  readyState = 0;
  status = 0;
  responseText = '';
  realSends = 0;
  open(_m: string, _u: string, _a?: boolean) {
    this.readyState = 1;
  }
  send(_b?: unknown) {
    this.realSends++;
  }
}

function makeWin() {
  const realFetch = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response('{"real":true}', { status: 200 }));
  const win = {
    fetch: realFetch as unknown as typeof fetch,
    XMLHttpRequest: class extends FakeXHR {} as unknown as typeof XMLHttpRequest,
    Response,
    location: { href: 'http://localhost:3000/catalog?fc-frame=f1&fc-state=empty' },
  } satisfies MockWindow;
  return { win, realFetch };
}

const rules: MockRule[] = [
  { match: { method: 'GET', url: '/api/products*' }, status: 200, body: { items: [] } },
  { match: { method: 'POST', url: '/api/order' }, status: 500, body: 'boom', headers: { 'X-Trace': 't1' } },
  { match: { method: 'GET', url: '/api/slow' }, status: 200, delay: 'forever' },
  { match: { method: 'GET', url: '/api/later' }, status: 200, body: { ok: 1 }, delay: 30 },
];

describe('fetch mock layer', () => {
  it('holds requests until rules arrive, then answers from the matching rule', async () => {
    const { win, realFetch } = makeWin();
    const layer = installMockLayer(win, 5000);
    const p = win.fetch('/api/products?page=2');
    await new Promise((r) => setTimeout(r, 20));
    expect(realFetch).not.toHaveBeenCalled();
    layer.setRules(rules);
    const res = await p;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    expect(res.headers.get('content-type')).toBe('application/json');
    layer.uninstall();
  });
  it('status, string body and headers; method must match; unmatched passes through', async () => {
    const { win, realFetch } = makeWin();
    const layer = installMockLayer(win, 5000);
    layer.setRules(rules);
    const r = await win.fetch(new Request('http://localhost:3000/api/order', { method: 'POST' }));
    expect(r.status).toBe(500);
    expect(await r.text()).toBe('boom');
    expect(r.headers.get('x-trace')).toBe('t1');
    const pass = await win.fetch('/api/order'); // GET → no rule
    expect(await pass.json()).toEqual({ real: true });
    expect(realFetch).toHaveBeenCalledTimes(1);
    layer.uninstall();
  });
  it("delay: 'forever' never settles; numeric delay waits", async () => {
    const { win } = makeWin();
    const layer = installMockLayer(win, 5000);
    layer.setRules(rules);
    let settled = false;
    void win.fetch('/api/slow').then(() => (settled = true));
    const t0 = Date.now();
    const later = await win.fetch('/api/later');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
    expect(await later.json()).toEqual({ ok: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);
    layer.uninstall();
  });
  it('passes everything through after the wait times out with no rules (mocks-none)', async () => {
    const { win, realFetch } = makeWin();
    const layer = installMockLayer(win, 10);
    const r = await win.fetch('/api/products');
    expect(await r.json()).toEqual({ real: true });
    expect(realFetch).toHaveBeenCalledTimes(1);
    layer.uninstall();
  });
});

describe('XHR mock layer', () => {
  it('fakes a matched response with events; unmatched uses the real send', async () => {
    const { win } = makeWin();
    const layer = installMockLayer(win, 5000);
    layer.setRules(rules);
    const xhr = new win.XMLHttpRequest() as unknown as FakeXHR & XMLHttpRequest;
    xhr.responseType = 'json';
    const loaded = new Promise<void>((r) => xhr.addEventListener('load', () => r()));
    xhr.open('GET', '/api/products');
    xhr.send();
    await loaded;
    expect(xhr.readyState).toBe(4);
    expect(xhr.status).toBe(200);
    expect(xhr.response).toEqual({ items: [] });
    expect(xhr.getResponseHeader('Content-Type')).toBe('application/json');
    expect(xhr.realSends).toBe(0);

    const other = new win.XMLHttpRequest() as unknown as FakeXHR & XMLHttpRequest;
    other.open('GET', '/api/unknown');
    other.send();
    expect(other.realSends).toBe(1);
    layer.uninstall();
  });
  it('holds an XHR sent before rules arrive', async () => {
    const { win } = makeWin();
    const layer = installMockLayer(win, 5000);
    const xhr = new win.XMLHttpRequest() as unknown as FakeXHR & XMLHttpRequest;
    const loaded = new Promise<void>((r) => xhr.addEventListener('load', () => r()));
    xhr.open('POST', '/api/order');
    xhr.send('{}');
    expect(xhr.realSends).toBe(0);
    layer.setRules(rules);
    await loaded;
    expect(xhr.status).toBe(500);
    expect(xhr.responseText).toBe('boom');
    layer.uninstall();
  });
});

describe('HMR classifier', () => {
  it('flags Vite updates and webpack rebuilds, not the initial ok', () => {
    const vite = hmrClassifier();
    expect(vite('{"type":"connected"}')).toBe(false);
    expect(vite('{"type":"update","updates":[]}')).toBe(true);
    const wp = hmrClassifier();
    expect(wp('{"type":"ok"}')).toBe(false);
    expect(wp('{"type":"invalid"}')).toBe(false);
    expect(wp('{"type":"ok"}')).toBe(true);
  });
});
