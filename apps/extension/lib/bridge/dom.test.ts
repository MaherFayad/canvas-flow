// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSelector, clickTarget, visibleText } from './selector';
import { MAX_HTML, elementContext, sanitizedHtml, trimHtml } from './element';
import { applyTokens, readTokens } from './tokens';
import { collectLinks } from '../url';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('selector builder', () => {
  it('prefers [data-fc] via clickTarget', () => {
    document.body.innerHTML = '<button data-fc="get-started"><span id="inner">Get <b>started</b></span></button>';
    const el = clickTarget(document.querySelector('b')!);
    expect(buildSelector(el)).toBe('[data-fc="get-started"]');
    expect(visibleText(el)).toBe('Get started');
  });
  it('uses a unique #id', () => {
    document.body.innerHTML = '<div><a id="buy" href="/x">Buy</a></div>';
    expect(buildSelector(document.getElementById('buy')!)).toBe('#buy');
  });
  it('falls back to a short unique CSS path with nth-of-type', () => {
    document.body.innerHTML = '<main id="app"><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></main>';
    const b = document.querySelectorAll('a')[1]!;
    const sel = buildSelector(b);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(b);
    expect(sel.split('>').length).toBeLessThanOrEqual(5);
  });
  it('clickTarget climbs to the nearest interactive element', () => {
    document.body.innerHTML = '<a href="/p"><img alt="Vase"></a>';
    expect(clickTarget(document.querySelector('img')!).tagName).toBe('A');
  });
});

describe('element context', () => {
  it('trims HTML to 2 KB keeping the opening and closing tag', () => {
    const html = `<div class="x">${'a'.repeat(5000)}</div>`;
    const t = trimHtml(html, 'div');
    expect(t.length).toBeLessThanOrEqual(MAX_HTML);
    expect(t.startsWith('<div class="x">')).toBe(true);
    expect(t.endsWith('</div>')).toBe(true);
  });
  it('drops input values and [data-fc-private] contents', () => {
    document.body.innerHTML =
      '<form id="f"><input name="pw" value="hunter2"><textarea>secret notes</textarea><div data-fc-private>Jane Doe, 555-1234</div><button>Save</button></form>';
    const html = sanitizedHtml(document.getElementById('f')!);
    expect(html).not.toContain('hunter2');
    expect(html).not.toContain('secret notes');
    expect(html).not.toContain('Jane Doe');
    const ctx = elementContext(document.getElementById('f')!);
    expect(ctx.text).not.toContain('Jane');
    expect(ctx.html.length).toBeLessThanOrEqual(MAX_HTML);
    expect(ctx.tag).toBe('form');
  });
  it('returns no text/html for an element inside a private area', () => {
    document.body.innerHTML = '<section data-fc-private><p id="p">Card 4242 4242</p></section>';
    const ctx = elementContext(document.getElementById('p')!);
    expect(ctx.text).toBe('');
    expect(ctx.html).toBe('');
    expect(ctx.selector).toBe('#p');
  });
  it('captures key computed styles', () => {
    document.body.innerHTML = '<button id="b" style="color: rgb(1, 2, 3); padding: 6px 12px">Clear filters</button>';
    const ctx = elementContext(document.getElementById('b')!);
    expect(ctx.text).toBe('Clear filters');
    expect(ctx.styles.color).toBe('rgb(1, 2, 3)');
  });
});

describe('tokens + links', () => {
  it('reads :root custom properties and applies overrides', () => {
    const style = document.createElement('style');
    style.textContent = ':root { --color-bg: #F4F1EA; --radius-md: 12px; } .x { --not-root: 1 }';
    document.head.appendChild(style);
    const tokens = readTokens(document);
    expect(tokens.map((t) => t.name).sort()).toEqual(['--color-bg', '--radius-md']);
    expect(tokens.find((t) => t.name === '--color-bg')?.type).toBe('color');
    applyTokens(document, { '--color-bg': '#000000' });
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#000000');
    applyTokens(document, { '--color-bg': '' });
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('');
  });
  it('collects same-origin links without fc params', () => {
    document.body.innerHTML = '<a href="/a?fc-frame=1&x=2">a</a><a href="https://other.dev/b">b</a><a href="#top">t</a><a href="mailto:x@y">m</a>';
    const links = collectLinks(document);
    expect(links).toEqual(['/a?x=2']);
  });
});
