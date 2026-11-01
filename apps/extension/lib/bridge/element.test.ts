// @vitest-environment happy-dom
/** Privacy rules for comment element context (BUILD_PLAN Security: "Comments carry page HTML"). */
import { beforeEach, describe, expect, it } from 'vitest';
import { ElementContextSchema } from '@flowcanvas/protocol';
import { MAX_HTML, elementContext } from './element';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('element context: never leaks typed values or private areas', () => {
  it('an <input> itself: no value in html, no text', () => {
    document.body.innerHTML = '<label>Email <input id="e" type="email" value="jane@doe.dev" placeholder="you@x"></label>';
    const input = document.getElementById('e') as HTMLInputElement;
    input.value = 'typed-secret@doe.dev';
    const ctx = elementContext(input);
    expect(ctx.tag).toBe('input');
    expect(ctx.text).toBe('');
    expect(ctx.html).not.toContain('jane@doe.dev');
    expect(ctx.html).not.toContain('typed-secret');
    expect(ctx.html).toContain('placeholder="you@x"');
  });
  it('a password field inside a form: neither the value attribute nor the typed value', () => {
    document.body.innerHTML = '<form id="f"><input type="password" value="hunter2"><button>Sign in</button></form>';
    (document.querySelector('input') as HTMLInputElement).value = 'typed-pw';
    const ctx = elementContext(document.getElementById('f')!);
    expect(JSON.stringify(ctx)).not.toMatch(/hunter2|typed-pw/);
    expect(ctx.text).toBe('Sign in');
  });
  it('select: the chosen option is not marked', () => {
    document.body.innerHTML = '<select id="s"><option>Visa</option><option selected>Amex 3782</option></select>';
    const ctx = elementContext(document.getElementById('s')!);
    expect(ctx.text).toBe('');
    expect(ctx.html).not.toMatch(/selected/);
  });
  it('[data-fc-private] subtree is emptied in html and text, even deep inside', () => {
    document.body.innerHTML = '<div id="card"><h3>Order</h3><div><p data-fc-private>Jane Doe, 4 Rue X, +966 55 000 0000</p></div><button>Pay</button></div>';
    const ctx = elementContext(document.getElementById('card')!);
    expect(JSON.stringify(ctx)).not.toMatch(/Jane|Rue X|966/);
    expect(ctx.text).toBe('Order Pay');
    expect(ctx.html).toContain('data-fc-private');
  });
  it('an element that is itself private, or inside one, gives selector only', () => {
    document.body.innerHTML = '<div data-fc-private id="p"><span id="s">secret</span></div>';
    for (const id of ['p', 's']) {
      const ctx = elementContext(document.getElementById(id)!);
      expect(ctx.text).toBe('');
      expect(ctx.html).toBe('');
      expect(ctx.selector).toBe(`#${id}`);
    }
  });
  it('html is at most 2 KB after trimming and still validates against the protocol', () => {
    document.body.innerHTML = `<ul id="l">${'<li data-fc-private>x</li><li>item</li>'.repeat(400)}</ul>`;
    const ctx = elementContext(document.getElementById('l')!);
    expect(ctx.html.length).toBeLessThanOrEqual(MAX_HTML);
    expect(ElementContextSchema.safeParse(ctx).success).toBe(true);
  });
  it('key computed styles: color, background, font, padding, margin, radius', () => {
    document.body.innerHTML = '<button id="b" style="color:rgb(26,26,26);padding:6px 12px;border-radius:14px;margin:0">Clear filters</button>';
    const s = elementContext(document.getElementById('b')!).styles;
    expect(Object.keys(s)).toEqual(expect.arrayContaining(['color', 'font', 'padding', 'radius']));
    expect(s.radius).toBe('14px');
  });
});
