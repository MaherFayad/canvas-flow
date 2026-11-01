/**
 * Link-like elements a discovery frame may click (MAIN world): buttons in
 * nav / header / [role=navigation], tabs in a tablist, [role=link] and
 * [data-fc]. Real <a href> links are left to the link crawl. Every candidate
 * gets a safety verdict (lib/routes/safety.ts); unsafe ones are listed (for the
 * report) but never clicked.
 */
import type { Clickable } from '@flowcanvas/protocol/lite';
import { unsafeReason, type ClickInfo } from '../routes/safety';

export const CLICKABLE_SELECTOR = '[role=link],nav button,header button,[role=navigation] button,[role=tablist] [role=tab],[data-fc]';
const MAX = 500;

const attr = (el: Element, n: string) => el.getAttribute(n);
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function labelOf(el: Element): string {
  return (squash(attr(el, 'aria-label')) || squash(el.textContent) || squash(attr(el, 'title')) || squash(attr(el, 'data-fc')) || el.tagName.toLowerCase()).slice(0, 60);
}

export function clickInfo(el: Element): ClickInfo {
  const tag = el.tagName.toLowerCase();
  return {
    tag,
    type: attr(el, 'type'),
    role: attr(el, 'role'),
    text: squash(el.textContent).slice(0, 200),
    ariaLabel: attr(el, 'aria-label'),
    title: attr(el, 'title'),
    fc: attr(el, 'data-fc'),
    id: attr(el, 'id'),
    name: attr(el, 'name'),
    href: attr(el, 'href'),
    inForm: !!el.closest('form'),
    toggle: el.hasAttribute('aria-pressed') || el.hasAttribute('aria-checked'),
    download: el.hasAttribute('download'),
    newWindow: attr(el, 'target') === '_blank',
    disabled: (el as HTMLButtonElement).disabled === true || attr(el, 'aria-disabled') === 'true',
  };
}

/** Candidates in document order. Index = position in this list (stable across reloads of the same page). */
export function candidates(doc: Document): Element[] {
  let all: Element[];
  try {
    all = Array.from(doc.querySelectorAll(CLICKABLE_SELECTOR));
  } catch {
    return [];
  }
  return all
    .filter((el) => {
      if (el.tagName === 'A' && el.hasAttribute('href')) return false; // the link crawl covers it
      try {
        return el.getClientRects().length > 0;
      } catch {
        return false;
      }
    })
    .slice(0, MAX);
}

export function listClickables(doc: Document): Clickable[] {
  return candidates(doc).map((el, index) => {
    const label = labelOf(el);
    const fc = attr(el, 'data-fc');
    const role = attr(el, 'role');
    const target = fc ? `[data-fc="${fc}"]` : `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ''} "${label}"`;
    const skip = unsafeReason(clickInfo(el));
    return skip ? { index, label, target, skip } : { index, label, target };
  });
}
