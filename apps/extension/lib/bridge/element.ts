import type { ElementContext, Rect } from '@flowcanvas/protocol/lite';
import { buildSelector, visibleText } from './selector';

export const MAX_HTML = 2048;
const PRIVATE = '[data-fc-private]';

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/** outerHTML with private subtrees emptied and form values removed. */
export function sanitizedHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  const scrub = (root: Element) => {
    const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
    for (const n of nodes) {
      if (n.matches(PRIVATE)) {
        n.innerHTML = '';
        continue;
      }
      const tag = n.tagName.toLowerCase();
      if (tag === 'input') n.removeAttribute('value');
      if (tag === 'textarea') n.textContent = '';
      if (tag === 'option') n.removeAttribute('selected');
    }
  };
  scrub(clone);
  return clone.outerHTML;
}

/** Trim HTML to max bytes: keep the opening tag and as much of the inner as fits, then close. */
export function trimHtml(html: string, tag: string, max = MAX_HTML): string {
  if (html.length <= max) return html;
  const close = `</${tag}>`;
  const openEnd = html.indexOf('>') + 1;
  const open = html.slice(0, openEnd);
  const room = max - open.length - close.length - 1;
  if (room <= 0) {
    // Opening tag alone is too big: cut it and mark the cut.
    return html.slice(0, max - 1) + '…';
  }
  return open + html.slice(openEnd, openEnd + room) + '…' + close;
}

function shortFont(cs: CSSStyleDeclaration): string {
  const fam = (cs.fontFamily || '').split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
  return [cs.fontWeight, cs.fontSize, fam].filter(Boolean).join(' ');
}

export function keyStyles(el: Element): Record<string, string> {
  const view = el.ownerDocument.defaultView;
  if (!view) return {};
  const cs = view.getComputedStyle(el);
  const out: Record<string, string> = {
    color: cs.color,
    background: cs.backgroundColor,
    font: shortFont(cs),
    padding: cs.padding,
    margin: cs.margin,
    radius: cs.borderRadius,
  };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

/**
 * Element context for comments (feature 10): selector, tag, visible text, rect,
 * trimmed outerHTML (≤ 2 KB) and key computed styles. Input values and anything
 * inside [data-fc-private] never leave the page.
 */
export function elementContext(el: Element): ElementContext {
  const tag = el.tagName.toLowerCase();
  const isPrivate = !!el.closest(PRIVATE);
  const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
  let text = '';
  if (!isPrivate && !isField) {
    // Text without private descendants.
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll(PRIVATE).forEach((n) => (n.textContent = ''));
    text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) text = visibleText(el, 200);
    if (text.length > 200) text = text.slice(0, 199) + '…';
  }
  return {
    selector: buildSelector(el),
    tag,
    text,
    rect: rectOf(el),
    html: isPrivate ? '' : trimHtml(sanitizedHtml(el), tag),
    styles: keyStyles(el),
  };
}
