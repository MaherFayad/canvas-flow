// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { pageBackground, withTimeout } from './prepare';

describe('capture prepare', () => {
  it('falls back to white when the page has no background', () => {
    expect(pageBackground(window)).toBe('#ffffff');
  });
  it('uses the body background when set', () => {
    document.body.style.backgroundColor = 'rgb(244, 241, 234)';
    expect(pageBackground(window)).toBe('rgb(244, 241, 234)');
    document.body.style.backgroundColor = '';
  });
  it('times out to the fallback', async () => {
    await expect(withTimeout(new Promise<number>(() => {}), 5, 7)).resolves.toBe(7);
  });
});
