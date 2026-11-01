import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enterFrame, fakeBridge, leaveFrame } from './test-utils';

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  leaveFrame();
});

describe('react', () => {
  it('useFcState renders the URL state first, then re-renders on welcome', async () => {
    enterFrame('?fc-frame=f1&fc-state=loading');
    const { fc } = await import('./index');
    const { useFcState } = await import('./react');
    const bridge = fakeBridge();
    const renders: string[] = [];
    function Probe() {
      const s = useFcState();
      renders.push(s);
      return <p data-testid="s">{s}</p>;
    }
    fc.init();
    render(<Probe />);
    expect(screen.getByTestId('s').textContent).toBe('loading');
    act(() => bridge.reply({ type: 'welcome', state: 'error' }));
    expect(screen.getByTestId('s').textContent).toBe('error');
    expect(renders.at(-1)).toBe('error');
    bridge.off();
  });

  it('useFcState drops back to default when the handshake times out', async () => {
    enterFrame('?fc-frame=f1&fc-state=empty');
    const { fc } = await import('./index');
    const { useFcState } = await import('./react');
    function Probe() {
      return <p data-testid="s">{useFcState()}</p>;
    }
    fc.init();
    render(<Probe />);
    expect(screen.getByTestId('s').textContent).toBe('empty');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('s').textContent).toBe('default');
  });

  it('FcTarget adds data-fc to its child and keeps its props', async () => {
    const { FcTarget } = await import('./react');
    render(
      <FcTarget id="get-started">
        <button className="btn">Get started</button>
      </FcTarget>,
    );
    const b = screen.getByRole('button');
    expect(b.getAttribute('data-fc')).toBe('get-started');
    expect(b.className).toBe('btn');
  });

  it('useFcReady sends ready once settled', async () => {
    enterFrame('?fc-frame=f1');
    const { fc } = await import('./index');
    const { useFcReady } = await import('./react');
    const bridge = fakeBridge();
    fc.init();
    bridge.reply({ type: 'welcome', state: 'default' });
    function Screen({ ok }: { ok: boolean }) {
      useFcReady(ok);
      return null;
    }
    const r = render(<Screen ok={false} />);
    expect(bridge.sent.some((m) => m.type === 'ready')).toBe(false);
    r.rerender(<Screen ok />);
    expect(bridge.sent.filter((m) => m.type === 'ready')).toHaveLength(1);
    bridge.off();
  });

  it('screensFromRoutes flattens a route tree', async () => {
    const { screensFromRoutes } = await import('./react');
    const out = screensFromRoutes([
      { path: '/', children: [{ index: true, handle: { fc: { id: 'welcome', group: 'onboarding' } } }, { path: 'catalog' }, { path: 'product/:id' }, { path: '*' }] },
    ]);
    expect(out.map(({ id, path, group }) => ({ id, path, group }))).toEqual([
      { id: 'welcome', path: '/', group: 'onboarding' },
      { id: 'catalog', path: '/catalog', group: undefined },
      { id: 'product-id', path: '/product/:id', group: undefined },
    ]);
  });
});

describe('next', () => {
  it('reads fc-state from search params only in a canvas frame', async () => {
    const { fcStateFromSearchParams } = await import('./next');
    expect(fcStateFromSearchParams({ 'fc-frame': 'f1', 'fc-state': 'empty' })).toBe('empty');
    expect(fcStateFromSearchParams(new URLSearchParams('fc-frame=f1&fc-state=error'))).toBe('error');
    expect(fcStateFromSearchParams({ 'fc-state': 'empty' })).toBe('default');
    expect(fcStateFromSearchParams(undefined)).toBe('default');
    vi.stubEnv('NODE_ENV', 'production');
    expect(fcStateFromSearchParams({ 'fc-frame': 'f1', 'fc-state': 'empty' })).toBe('default');
  });

  it('nextScreens reads the pages build manifest', async () => {
    const { nextScreens } = await import('./next');
    (window as any).__BUILD_MANIFEST = { sortedPages: ['/', '/_app', '/_error', '/catalog', '/product/[id]', '/api/x'] };
    expect(nextScreens()).toEqual([
      { id: 'home', path: '/' },
      { id: 'catalog', path: '/catalog' },
      { id: 'product-id', path: '/product/:id' },
    ]);
    delete (window as any).__BUILD_MANIFEST;
  });
});

describe('msw', () => {
  it('picks handlers for the current state with a default fallback', async () => {
    enterFrame('?fc-frame=f1&fc-state=empty');
    const { fc } = await import('./index');
    const { fcHandlers } = await import('./msw');
    fc.init();
    expect(fcHandlers({ default: ['d'], empty: ['e'] })).toEqual(['e']);
    expect(fcHandlers({ default: ['d'] })).toEqual(['d']);
  });
});

describe('vue', () => {
  it('useFcState follows the welcome', async () => {
    enterFrame('?fc-frame=f1&fc-state=partial');
    const { fc } = await import('./index');
    const { useFcState } = await import('./vue');
    const bridge = fakeBridge();
    fc.init();
    const s = useFcState();
    expect(s.value).toBe('partial');
    bridge.reply({ type: 'welcome', state: 'success' });
    expect(s.value).toBe('success');
    bridge.off();
  });
});
