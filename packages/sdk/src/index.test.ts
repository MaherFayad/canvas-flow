import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enterFrame, fakeBridge, freshSdk, leaveFrame } from './test-utils';

const screens = [
  { id: 'welcome', path: '/', group: 'onboarding' },
  { id: 'catalog', path: '/catalog', group: 'browse', states: ['default', 'loading', 'empty', 'partial', 'error'] },
];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  leaveFrame();
});

describe('outside a canvas', () => {
  it('stays inactive and in the default state, and sends nothing', async () => {
    window.history.replaceState(null, '', '/catalog?fc-state=empty');
    const { fc } = await freshSdk();
    const bridge = fakeBridge();
    fc.init({ screens });
    expect(fc.active).toBe(false);
    expect(fc.state()).toBe('default');
    expect(fc.is('empty')).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(bridge.sent).toEqual([]);
    bridge.off();
  });

  it('ignores a top-level page that only has fc-frame in the URL', async () => {
    window.history.replaceState(null, '', '/catalog?fc-frame=f1&fc-state=empty');
    const { fc } = await freshSdk();
    const bridge = fakeBridge();
    fc.init({ screens });
    bridge.reply({ type: 'welcome', state: 'empty' });
    expect(fc.active).toBe(false);
    expect(fc.state()).toBe('default');
    bridge.off();
  });
});

describe('in a canvas frame', () => {
  beforeEach(() => enterFrame('?fc-frame=f1&fc-state=empty'));

  it('reads fc-state from the URL before the welcome arrives', async () => {
    const { fc } = await freshSdk();
    expect(fc.state()).toBe('default'); // not initialised: the app does not use the SDK
    fc.init();
    expect(fc.state()).toBe('empty');
    expect(fc.is('empty')).toBe(true);
    expect(fc.active).toBe(false);
  });

  it('sends hello and the screen list, then flips active on welcome', async () => {
    const { fc } = await freshSdk();
    const bridge = fakeBridge();
    const seen: string[] = [];
    fc.on('state', (s) => seen.push(s));
    fc.init({ screens });
    expect(bridge.sent[0]).toEqual({ type: 'hello' });
    expect(bridge.sent[1]).toEqual({ type: 'screens', screens });
    bridge.reply({ type: 'welcome', state: 'error' });
    expect(fc.active).toBe(true);
    expect(fc.state()).toBe('error');
    expect(seen).toEqual(['error']);
    vi.advanceTimersByTime(1000);
    expect(fc.active).toBe(true);
    // no more hellos after the welcome
    expect(bridge.sent.filter((m) => m.type === 'hello')).toHaveLength(1);
    bridge.off();
  });

  it('retries hello inside the handshake window', async () => {
    const { fc } = await freshSdk();
    const bridge = fakeBridge();
    fc.init({ screens });
    vi.advanceTimersByTime(400);
    expect(bridge.sent.filter((m) => m.type === 'hello').length).toBeGreaterThanOrEqual(2);
    bridge.reply({ type: 'welcome', state: 'partial' });
    expect(fc.active).toBe(true);
    expect(fc.state()).toBe('partial');
    bridge.off();
  });

  it('stays inactive and falls back to default when nobody answers in 500 ms', async () => {
    const { fc } = await freshSdk();
    const bridge = fakeBridge();
    const seen: string[] = [];
    fc.on('state', (s) => seen.push(s));
    fc.init({ screens });
    vi.advanceTimersByTime(499);
    expect(fc.state()).toBe('empty');
    vi.advanceTimersByTime(1);
    expect(fc.active).toBe(false);
    expect(fc.state()).toBe('default');
    expect(seen).toEqual(['default']);
    // a late welcome is ignored
    bridge.reply({ type: 'welcome', state: 'error' });
    expect(fc.active).toBe(false);
    expect(fc.state()).toBe('default');
    bridge.off();
  });

  it('sends ready once, queued until the welcome', async () => {
    const { fc } = await freshSdk();
    const bridge = fakeBridge();
    fc.init();
    fc.ready();
    expect(bridge.sent.some((m) => m.type === 'ready')).toBe(false);
    bridge.reply({ type: 'welcome', state: 'default' });
    fc.ready();
    vi.advanceTimersByTime(3000);
    expect(bridge.sent.filter((m) => m.type === 'ready')).toHaveLength(1);
    bridge.off();
  });

  it('auto-sends ready after 1.5 s when the app never calls it', async () => {
    const { fc } = await freshSdk();
    const bridge = fakeBridge();
    fc.init();
    bridge.reply({ type: 'welcome', state: 'default' });
    vi.advanceTimersByTime(1499);
    expect(bridge.sent.some((m) => m.type === 'ready')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(bridge.sent.filter((m) => m.type === 'ready')).toHaveLength(1);
    bridge.off();
  });

  it('calls token listeners and stops after unsubscribe', async () => {
    const { fc } = await freshSdk();
    const bridge = fakeBridge();
    const fn = vi.fn();
    const off = fc.on('tokens', fn);
    fc.init();
    bridge.reply({ type: 'welcome', state: 'default' });
    bridge.reply({ type: 'tokens', vars: { '--color-bg': '#000' } });
    expect(fn).toHaveBeenCalledWith({ '--color-bg': '#000' });
    off();
    bridge.reply({ type: 'tokens', vars: { '--color-bg': '#fff' } });
    expect(fn).toHaveBeenCalledTimes(1);
    bridge.off();
  });

  it('is a no-op in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { fc } = await freshSdk();
    const bridge = fakeBridge();
    const fn = vi.fn();
    fc.on('tokens', fn);
    fc.init({ screens });
    bridge.reply({ type: 'welcome', state: 'error' });
    bridge.reply({ type: 'tokens', vars: { '--x': '1' } });
    fc.ready();
    vi.advanceTimersByTime(3000);
    expect(bridge.sent).toEqual([]);
    expect(fc.active).toBe(false);
    expect(fc.state()).toBe('default');
    expect(fn).not.toHaveBeenCalled();
    bridge.off();
  });
});

describe('target', () => {
  it('returns a data-fc attribute', async () => {
    const { fc } = await freshSdk();
    expect(fc.target('get-started')).toEqual({ 'data-fc': 'get-started' });
  });
});

describe('prod entry', () => {
  it('has the same shape and does nothing', async () => {
    const { fc } = await import('./prod');
    fc.init({ screens });
    expect(fc.active).toBe(false);
    expect(fc.state()).toBe('default');
    expect(fc.target('a')).toEqual({ 'data-fc': 'a' });
    expect(typeof fc.on('tokens', () => {})).toBe('function');
  });
});
