/**
 * Discovery click safety. Discovery must never change app data, so the rule is
 * "only click what looks like navigation": anything that names a data-changing
 * action, submits a form, toggles, downloads or opens a window is skipped.
 * Pure; the MAIN world checks again right before clicking.
 */

/** Words that mean "this changes something". Matched on whole words after splitting camelCase / kebab / snake. */
const UNSAFE_WORDS = [
  'logout', 'log out', 'signout', 'sign out', 'sign off', 'log off',
  'delete', 'remove', 'destroy', 'erase', 'drop', 'trash', 'discard', 'purge', 'wipe',
  'unsubscribe', 'subscribe', 'deactivate', 'disable', 'enable', 'close account', 'cancel',
  'pay', 'payment', 'purchase', 'buy', 'checkout', 'check out', 'place order', 'order now', 'donate', 'refund', 'transfer', 'withdraw', 'charge',
  'submit', 'confirm', 'save', 'send', 'post', 'publish', 'apply', 'accept', 'decline', 'approve', 'reject', 'book', 'reserve', 'rsvp',
  'add', 'create', 'new', 'edit', 'update', 'upload', 'import', 'reset', 'clear', 'archive', 'restore', 'revoke', 'block', 'report',
  'follow', 'unfollow', 'like', 'vote', 'join', 'leave', 'invite', 'share', 'mark', 'rate', 'install', 'uninstall', 'retry',
];
const UNSAFE_RE = new RegExp(`\\b(${UNSAFE_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');

/** Path words that must never be crawled or clicked through to. */
export const UNSAFE_PATH = /logout|log-out|signout|sign-out|delete|remove|destroy|unsubscribe|deactivate/i;

/** "addToBag" / "add-to-bag" / "add_to_bag" → "add to bag" (so word boundaries work on ids and data-fc). */
export function words(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.:/[\]"=]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the MAIN world reads off an element (plain data, so the rules are testable). */
export interface ClickInfo {
  tag: string;
  /** `type` attribute as written (buttons default to submit inside a form). */
  type?: string | null;
  role?: string | null;
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  fc?: string | null;
  id?: string | null;
  name?: string | null;
  href?: string | null;
  inForm?: boolean;
  /** aria-pressed / aria-checked / aria-selected-free toggle state present. */
  toggle?: boolean;
  download?: boolean;
  newWindow?: boolean;
  disabled?: boolean;
}

/** Null when the element looks like plain navigation; otherwise why it is skipped. */
export function unsafeReason(i: ClickInfo): string | null {
  const tag = i.tag.toLowerCase();
  if (i.disabled) return 'disabled';
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'option') return 'form field';
  const type = (i.type ?? '').toLowerCase();
  if (tag === 'button' && (type === 'submit' || type === 'reset' || (!type && i.inForm))) return 'submits a form';
  if (i.inForm) return 'inside a form';
  if (i.toggle || /^(checkbox|switch|radio|menuitemcheckbox|menuitemradio|option|slider|spinbutton)$/i.test(i.role ?? '')) return 'toggle';
  if (i.download) return 'downloads a file';
  if (i.newWindow) return 'opens a window';
  if (i.href && /^\s*(javascript|data|blob|mailto|tel):/i.test(i.href)) return 'not a page link';
  if (i.href && UNSAFE_PATH.test(i.href)) return `link to ${i.href}`;
  for (const s of [i.ariaLabel, i.text, i.title, i.fc, i.id, i.name]) {
    if (!s) continue;
    const m = UNSAFE_RE.exec(words(s));
    if (m) return `"${m[1]!.toLowerCase().replace(/\s+/g, ' ')}"`;
  }
  return null;
}

/** Cap on clicks per page (each click reloads the page first). */
export const MAX_CLICKS_PER_PAGE = 12;
