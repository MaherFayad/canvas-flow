/**
 * Tiny safe markdown for sticky notes: paragraphs, **bold**, *italic* / _italic_,
 * `code`, - / * / 1. lists and [links](https://…). Output is a plain tree that
 * the renderer turns into React elements: raw HTML is never interpreted (it
 * stays text) and only http(s) / mailto links survive.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' };

export type Block = { t: 'p'; c: Inline[] } | { t: 'ul' | 'ol'; items: Inline[][] };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function safeHref(href: string): string | null {
  const h = href.trim();
  // Strip control chars and whitespace browsers ignore inside schemes ("java\nscript:").
  const squashed = h.replace(/[\u0000- \u007f]/g, '');
  return SAFE_HREF.test(squashed) && !/^javascript:/i.test(squashed) ? h : null;
}

/** Parse inline markup. Unmatched markers stay literal text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()]/.test(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith('**') || rest.startsWith('__')) {
      const mark = rest.slice(0, 2);
      const end = src.indexOf(mark, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const end = src.indexOf(ch, i + 1);
      // `_` inside a word (snake_case) is not emphasis.
      const wordy = ch === '_' && i > 0 && /\w/.test(src[i - 1]!);
      if (end > i + 1 && !wordy && src[i + 1] !== ' ') {
        flush();
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
      if (m) {
        const href = safeHref(m[2]!);
        flush();
        if (href) out.push({ t: 'link', href, c: parseInline(m[1]!) });
        else out.push(...parseInline(m[1]!)); // unsafe link: keep the label as text only
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const endPara = () => {
    if (!para.length) return;
    const c: Inline[] = [];
    para.forEach((l, i) => {
      if (i) c.push({ t: 'br' });
      c.push(...parseInline(l));
    });
    blocks.push({ t: 'p', c });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const line of lines) {
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      endPara();
      const t = ul ? 'ul' : 'ol';
      if (!list || list.t !== t) {
        endList();
        list = { t, items: [] };
      }
      list.items.push(parseInline((ul ?? ol)![1]!));
      continue;
    }
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }
    endList();
    para.push(line.trim());
  }
  endPara();
  endList();
  return blocks;
}

/** Plain text of a markdown string (for aria labels and prompts). */
export function markdownText(src: string): string {
  const text = (c: Inline[]): string =>
    c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : text(n.c))).join('');
  return parseMarkdown(src)
    .map((b) => (b.t === 'p' ? text(b.c) : b.items.map((i) => `- ${text(i)}`).join(' ')))
    .join(' ');
}
