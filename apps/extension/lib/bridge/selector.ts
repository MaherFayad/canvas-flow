/** Selector helpers shared by record mode and element context. */

const CSS_ESCAPE = (s: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^a-zA-Z0-9_-])/g, '\\$1');

const INTERACTIVE = 'a[href],button,[role="button"],[role="link"],[role="tab"],[role="menuitem"],input,select,textarea,summary,label';

/** The element a click "means": closest [data-fc], else closest interactive element, else the target itself. */
export function clickTarget(el: Element): Element {
  return el.closest('[data-fc]') ?? el.closest(INTERACTIVE) ?? el;
}

function isUnique(doc: Document, sel: string, el: Element): boolean {
  try {
    const all = doc.querySelectorAll(sel);
    return all.length === 1 && all[0] === el;
  } catch {
    return false;
  }
}

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag;
}

/**
 * Short, stable-ish selector for an element:
 *  1. `[data-fc="id"]` when the element has data-fc (use clickTarget() first to climb to it)
 *  2. `#id` when unique
 *  3. a short CSS path (max 5 segments), anchored at the nearest ancestor with a unique id.
 */
export function buildSelector(el: Element): string {
  const doc = el.ownerDocument;
  const fc = el.getAttribute('data-fc');
  if (fc !== null) return `[data-fc="${fc.replace(/"/g, '\\"')}"]`;
  if (el.id && isUnique(doc, `#${CSS_ESCAPE(el.id)}`, el)) return `#${CSS_ESCAPE(el.id)}`;

  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== doc.documentElement && parts.length < 5) {
    if (cur !== el && cur.id && isUnique(doc, `#${CSS_ESCAPE(cur.id)}`, cur)) {
      parts.unshift(`#${CSS_ESCAPE(cur.id)}`);
      break;
    }
    parts.unshift(segment(cur));
    const sel = parts.join(' > ');
    if (isUnique(doc, sel, el)) return sel;
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

/** Visible label of an element, trimmed to `max` chars. */
export function visibleText(el: Element, max = 80): string {
  const aria = el.getAttribute('aria-label');
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
  let t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t && aria) t = aria.trim();
  if (!t && el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button')) t = el.value;
  if (!t) t = el.getAttribute('title') ?? el.getAttribute('alt') ?? '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
