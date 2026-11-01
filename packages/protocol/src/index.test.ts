import { describe, expect, it } from 'vitest';
import { acceptFromFrame, findMock, frameUrl, globMatch, guessTokenType, parseMessage, readFrameParams } from './index';

const nonce = 'abcdef0123456789';
describe('protocol', () => {
  it('round-trips every message type through zod', () => {
    const msgs = [
      { fc: 'hello', v: 1, frame: 'f1', nonce: null, hasSdk: true, url: '/' },
      { fc: 'welcome', v: 1, frame: 'f1', nonce, state: 'empty' },
      { fc: 'ready', v: 1, frame: 'f1', nonce, url: '/catalog' },
      { fc: 'nav', v: 1, frame: 'f1', nonce, from: '/', to: '/catalog' },
      { fc: 'click', v: 1, frame: 'f1', nonce, target: '[data-fc="go"]', text: 'Go', rect: { x: 0, y: 0, w: 1, h: 1 } },
      { fc: 'tokens', v: 1, frame: 'f1', nonce, vars: { '--a': '#fff' } },
      { fc: 'mocks', v: 1, frame: 'f1', nonce, rules: [{ match: { method: 'GET', url: '/api/*' }, status: 500 }] },
    ];
    for (const m of msgs) expect(parseMessage(m)?.fc).toBe(m.fc);
  });
  it('rejects junk and wrong versions', () => {
    expect(parseMessage({ fc: 'ready', v: 2, frame: 'f', nonce, url: '/' })).toBeNull();
    expect(parseMessage('hello')).toBeNull();
    expect(parseMessage({ type: 'x' })).toBeNull();
  });
  it('drops wrong origin and bad nonce', () => {
    const data = { fc: 'ready', v: 1, frame: 'f1', nonce, url: '/' };
    const nf = () => nonce;
    expect(acceptFromFrame({ origin: 'http://evil.com', data }, 'http://localhost:3000', nf)).toBeNull();
    expect(acceptFromFrame({ origin: 'http://localhost:3000', data: { ...data, nonce: 'zzzzzzzzzzzz' } }, 'http://localhost:3000', nf)).toBeNull();
    expect(acceptFromFrame({ origin: 'http://localhost:3000', data }, 'http://localhost:3000', nf)?.fc).toBe('ready');
  });
  it('rejects canvas→frame types arriving at the canvas', () => {
    const data = { fc: 'tokens', v: 1, frame: 'f1', nonce, vars: {} };
    expect(acceptFromFrame({ origin: 'http://localhost:3000', data }, 'http://localhost:3000', () => nonce)).toBeNull();
  });
  it('builds and reads frame URLs', () => {
    const u = frameUrl('http://localhost:5173', '/catalog?x=1', 'f9', 'empty');
    expect(u).toBe('http://localhost:5173/catalog?x=1&fc-frame=f9&fc-state=empty');
    expect(readFrameParams(new URL(u).search)).toEqual({ frame: 'f9', state: 'empty' });
  });
  it('matches mock globs', () => {
    expect(globMatch('/api/products*', 'http://localhost:3000/api/products?page=2')).toBe(true);
    expect(globMatch('/api/products*', '/api/orders')).toBe(false);
    expect(findMock([{ match: { method: 'GET', url: '/api/*' }, status: 200 }], 'get', '/api/x')).toBeTruthy();
    expect(findMock([{ match: { method: 'POST', url: '/api/*' }, status: 200 }], 'GET', '/api/x')).toBeUndefined();
  });
  it('guesses token types', () => {
    expect(guessTokenType('#F4F1EA')).toBe('color');
    expect(guessTokenType('oklch(0.7 0.1 200)')).toBe('color');
    expect(guessTokenType('12px')).toBe('length');
    expect(guessTokenType('1.5')).toBe('number');
    expect(guessTokenType('Inter, sans-serif')).toBe('font');
  });
});
