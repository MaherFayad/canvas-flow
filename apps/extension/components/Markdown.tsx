import { createElement, type ReactNode } from 'react';
import { parseMarkdown, type Inline } from '@/lib/canvas/markdown';

function inline(nodes: Inline[], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'text':
        return n.v;
      case 'br':
        return <br key={k} />;
      case 'code':
        return (
          <code key={k} className="mono" style={{ background: 'rgba(0,0,0,0.06)', borderRadius: 3, paddingInline: 3 }}>
            {n.v}
          </code>
        );
      case 'strong':
        return <strong key={k}>{inline(n.c, k)}</strong>;
      case 'em':
        return <em key={k}>{inline(n.c, k)}</em>;
      case 'link':
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer" className="nodrag" style={{ textDecoration: 'underline' }}>
            {inline(n.c, k)}
          </a>
        );
    }
  });
}

/** Safe markdown → React (no raw HTML, ever). */
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((b, i) =>
        b.t === 'p'
          ? createElement('p', { key: i, style: { margin: '0 0 0.5em' } }, ...inline(b.c, `${i}-`))
          : createElement(
              b.t,
              { key: i, style: { margin: '0 0 0.5em', paddingInlineStart: '1.2em', listStyle: b.t === 'ul' ? 'disc' : 'decimal' } },
              b.items.map((it, j) => <li key={j}>{inline(it, `${i}-${j}-`)}</li>),
            ),
      )}
    </>
  );
}
