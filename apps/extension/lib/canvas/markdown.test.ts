import { describe, expect, it } from 'vitest';
import { markdownText, parseInline, parseMarkdown, safeHref, type Block, type Inline } from './markdown';

/** Every href in a parsed tree. */
function hrefs(blocks: Block[]): string[] {
  const walk = (c: Inline[]): string[] => c.flatMap((n) => (n.t === 'link' ? [n.href, ...walk(n.c)] : n.t === 'strong' || n.t === 'em' ? walk(n.c) : []));
  return blocks.flatMap((b) => (b.t === 'p' ? walk(b.c) : b.items.flatMap(walk)));
}

describe('markdown renderer: features', () => {
  it('paragraphs, bold, italic, code', () => {
    expect(parseMarkdown('Hello **bold** and *it* and `x < y`\n\nSecond')).toEqual([
      {
        t: 'p',
        c: [
          { t: 'text', v: 'Hello ' },
          { t: 'strong', c: [{ t: 'text', v: 'bold' }] },
          { t: 'text', v: ' and ' },
          { t: 'em', c: [{ t: 'text', v: 'it' }] },
          { t: 'text', v: ' and ' },
          { t: 'code', v: 'x < y' },
        ],
      },
      { t: 'p', c: [{ t: 'text', v: 'Second' }] },
    ]);
  });
  it('bullet and numbered lists', () => {
    const b = parseMarkdown('- one\n- **two**\n\n1. a\n2. b');
    expect(b.map((x) => x.t)).toEqual(['ul', 'ol']);
    expect((b[0] as { items: Inline[][] }).items).toHaveLength(2);
    expect((b[1] as { items: Inline[][] }).items).toHaveLength(2);
  });
  it('links with http(s) and mailto', () => {
    expect(hrefs(parseMarkdown('[Figma](https://figma.com/x) and [mail](mailto:a@b.c)'))).toEqual(['https://figma.com/x', 'mailto:a@b.c']);
  });
  it('snake_case is not emphasis; unmatched markers stay text', () => {
    expect(parseInline('fc_state and *open')).toEqual([{ t: 'text', v: 'fc_state and *open' }]);
  });
});

describe('markdown renderer: safety', () => {
  it('raw HTML stays literal text (never an element)', () => {
    const b = parseMarkdown('<img src=x onerror=alert(1)><script>alert(1)</script>');
    expect(b).toEqual([{ t: 'p', c: [{ t: 'text', v: '<img src=x onerror=alert(1)><script>alert(1)</script>' }] }]);
  });
  it('drops javascript:, data: and other schemes but keeps the label', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', '//evil.com', 'java%0ascript:x']) {
      const b = parseMarkdown(`[click](${bad})`);
      expect(hrefs(b)).toEqual([]);
      expect(markdownText(`[click](${bad})`)).toContain('click');
    }
  });
  it('safeHref ignores control characters inside a scheme', () => {
    expect(safeHref('java\tscript:alert(1)')).toBeNull();
    expect(safeHref(' https://ok.dev ')).toBe('https://ok.dev');
  });
  it('link labels cannot smuggle markup', () => {
    const b = parseMarkdown('[<b>x</b>](https://a.dev)');
    expect(b[0]).toEqual({ t: 'p', c: [{ t: 'link', href: 'https://a.dev', c: [{ t: 'text', v: '<b>x</b>' }] }] });
  });
  it('plain text extraction for labels and prompts', () => {
    expect(markdownText('**Skip** goes to `Catalog`\n- one')).toBe('Skip goes to Catalog - one');
  });
});
