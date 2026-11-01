// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ProbeResult } from '@flowcanvas/protocol/lite';
import { BLOCKED, installReadOnlyGuard, isDiscoveryFrame } from './guard';
import { handleProbe } from './probe';
import { listClickables } from './clickables';

type W = Window & typeof globalThis;

describe('read-only guard (discovery frames only)', () => {
  it('applies to discovery frame ids only', () => {
    expect(isDiscoveryFrame('discover~3~abcde')).toBe(true);
    expect(isDiscoveryFrame('catalog~default~x')).toBe(false);
  });

  it('blocks writes: non-GET fetch / XHR, beacons, form submits, window.open and dialogs; GET passes', async () => {
    const realFetch = vi.fn(async () => new Response('ok'));
    window.fetch = realFetch as unknown as typeof fetch;
    const realSend = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
    installReadOnlyGuard(window as W);

    expect(await (await fetch('/api/products')).text()).toBe('ok');
    await expect(fetch('/api/bag', { method: 'POST', body: '{}' })).rejects.toThrow(BLOCKED);
    await expect(fetch(new Request('http://localhost/api/bag/1', { method: 'DELETE' }))).rejects.toThrow(BLOCKED);
    await expect(fetch('/api/x', { method: 'head' })).resolves.toBeTruthy();
    expect(realFetch).toHaveBeenCalledTimes(2);

    const x = new XMLHttpRequest();
    const failed = new Promise((r) => x.addEventListener('error', r));
    x.open('PUT', '/api/me');
    x.send('{}');
    await failed;
    expect(realSend).not.toHaveBeenCalled();
    const g = new XMLHttpRequest();
    g.open('GET', '/api/me');
    g.send();
    expect(realSend).toHaveBeenCalledTimes(1);

    document.body.innerHTML = '<form><button>Pay</button></form>';
    const form = document.querySelector('form')!;
    const onSubmit = vi.fn();
    form.addEventListener('submit', onSubmit);
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(() => form.submit()).not.toThrow();
    expect(() => form.requestSubmit()).not.toThrow();

    expect(window.open('/x')).toBeNull();
    expect(window.confirm('Delete everything?')).toBe(false);
    expect(window.prompt('Name?')).toBeNull();
    expect(navigator.sendBeacon('/log', 'x')).toBe(false);
  });
});

describe('probe clicks (MAIN world)', () => {
  const setup = () => {
    history.replaceState({}, '', '/?fc-frame=discover~1~abc');
    document.body.innerHTML = `
      <header><nav>
        <a href="/catalog">Shop</a>
        <button type="button" id="classes">Classes</button>
        <button type="button" id="out">Log out</button>
      </nav></header>
      <div role="tablist"><div role="tab" id="tab">Reviews</div></div>
      <button type="button" data-fc="add-to-bag">Add</button>
      <form><nav><button>Continue</button></nav></form>`;
    const go = vi.fn(() => history.pushState({}, '', '/classes'));
    const logout = vi.fn();
    document.getElementById('classes')!.addEventListener('click', go);
    document.getElementById('out')!.addEventListener('click', logout);
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    return { go, logout };
  };
  const ask = (m: Parameters<typeof handleProbe>[1], discovery = true) =>
    new Promise<ProbeResult>((resolve) => handleProbe(window, m, discovery, resolve, 200));

  it('lists link-like elements (anchors left to the link crawl) with a verdict each', () => {
    setup();
    expect(listClickables(document)).toEqual([
      { index: 0, label: 'Classes', target: 'button "Classes"' },
      { index: 1, label: 'Log out', target: 'button "Log out"', skip: '"log out"' },
      { index: 2, label: 'Reviews', target: 'div[role=tab] "Reviews"' },
      { index: 3, label: 'Add', target: '[data-fc="add-to-bag"]', skip: '"add"' },
      { index: 4, label: 'Continue', target: 'button "Continue"', skip: 'submits a form' },
    ]);
  });

  it('clicks a safe target and reports the new URL; refuses unsafe, stale or non-discovery requests without clicking', async () => {
    const { go, logout } = setup();
    expect(await ask({ fc: 'click-probe', id: 'p1', index: 0, label: 'Classes' })).toEqual({ fc: 'click-probe-result', id: 'p1', ok: true, url: '/classes' });
    expect(go).toHaveBeenCalledTimes(1);
    expect(await ask({ fc: 'click-probe', id: 'p2', index: 1, label: 'Log out' })).toMatchObject({ ok: false });
    expect(logout).not.toHaveBeenCalled();
    expect(await ask({ fc: 'click-probe', id: 'p3', index: 0, label: 'Something else' })).toMatchObject({ ok: false });
    expect(await ask({ fc: 'click-probe', id: 'p4', index: 99, label: 'Classes' })).toMatchObject({ ok: false });
    expect(await ask({ fc: 'click-probe', id: 'p5', index: 0, label: 'Classes' }, false)).toMatchObject({ ok: false });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('a click that goes nowhere still answers after the settle time', async () => {
    setup();
    const r = await ask({ fc: 'click-probe', id: 'p6', index: 2, label: 'Reviews' });
    expect(r).toMatchObject({ ok: true });
  });
});
