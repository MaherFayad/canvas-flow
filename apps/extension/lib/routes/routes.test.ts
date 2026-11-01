import { describe, expect, it } from 'vitest';
import { bestMatch, fillPattern, fromFileRoute, fromVuePath, isCatchAll, isDynamic, joinPattern, matchPattern, normPattern, pathOnly } from './pattern';
import { UNSAFE_PATH, unsafeReason, words, type ClickInfo } from './safety';

describe('route patterns', () => {
  it('normalises and joins (absolute children win, "?" stays an optional marker)', () => {
    expect(normPattern('//a//b/')).toBe('/a/b');
    expect(normPattern('')).toBe('/');
    expect(normPattern('/p/:id?')).toBe('/p/:id?');
    expect(pathOnly('/a/b/?x=1#h')).toBe('/a/b');
    expect(joinPattern('/', 'shop')).toBe('/shop');
    expect(joinPattern('/shop', ':id')).toBe('/shop/:id');
    expect(joinPattern('/shop', '/abs')).toBe('/abs');
    expect(joinPattern('/shop/', '')).toBe('/shop');
  });

  it('matches params, optional segments and splats', () => {
    expect(matchPattern('/product/:id', '/product/canele-plate')).toEqual({ id: 'canele-plate' });
    expect(matchPattern('/product/:id', '/product/canele-plate?ref=x#top')).toEqual({ id: 'canele-plate' });
    expect(matchPattern('/product/:id', '/product/canele-plate/')).toEqual({ id: 'canele-plate' });
    expect(matchPattern('/product/:id', '/product')).toBeNull();
    expect(matchPattern('/product/:id', '/product/a/b')).toBeNull();
    expect(matchPattern('/product/:id', '/products/a')).toBeNull();
    expect(matchPattern('/product/:id', '/product/caf%C3%A9')).toEqual({ id: 'café' });
    // optional
    expect(matchPattern('/:lang?/about', '/about')).toEqual({});
    expect(matchPattern('/:lang?/about', '/fr/about')).toEqual({ lang: 'fr' });
    expect(matchPattern('/users/:id/posts/:postId?', '/users/4/posts')).toEqual({ id: '4' });
    expect(matchPattern('/users/:id/posts/:postId?', '/users/4/posts/9')).toEqual({ id: '4', postId: '9' });
    // splats: zero or more segments
    expect(matchPattern('/docs/*', '/docs/intro/start')).toEqual({ '*': 'intro/start' });
    expect(matchPattern('/docs/*', '/docs')).toEqual({ '*': '' });
    expect(matchPattern('/*', '/anything/at/all')).toEqual({ '*': 'anything/at/all' });
    expect(matchPattern('/', '/')).toEqual({});
    expect(matchPattern('/', '/x')).toBeNull();
  });

  it('fills patterns and picks the most specific match (catch-all ignored)', () => {
    expect(fillPattern('/classes/:id/booked', { id: 'tableware-course' })).toBe('/classes/tableware-course/booked');
    expect(fillPattern('/users/:id/posts/:postId?', { id: '4' })).toBe('/users/4/posts');
    expect(fillPattern('/docs/*', { '*': 'a/b' })).toBe('/docs/a/b');
    expect(fillPattern('/p/:id', {})).toBeNull();
    expect(fillPattern('/p/:id', { id: 'a b' })).toBe('/p/a%20b');
    const pats = ['/*', '/classes', '/classes/:id', '/classes/:id/book', '/classes/new', '/docs/*'];
    expect(bestMatch(pats, '/classes/new')).toBe('/classes/new');
    expect(bestMatch(pats, '/classes/glaze-lab')).toBe('/classes/:id');
    expect(bestMatch(pats, '/classes/glaze-lab/book')).toBe('/classes/:id/book');
    expect(bestMatch(pats, '/docs/x/y')).toBe('/docs/*');
    expect(bestMatch(pats, '/nowhere')).toBeNull();
    expect(isDynamic('/a/:b')).toBe(true);
    expect(isDynamic('/a/*')).toBe(true);
    expect(isDynamic('/a/b')).toBe(false);
    expect(isCatchAll('/*')).toBe(true);
    expect(isCatchAll('/docs/*')).toBe(false);
  });

  it('converts Next.js / SvelteKit file routes and Vue Router paths', () => {
    expect(fromFileRoute('/product/[id]')).toBe('/product/:id');
    expect(fromFileRoute('/docs/[...slug]')).toBe('/docs/*');
    expect(fromFileRoute('/shop/[[...slug]]')).toBe('/shop/*');
    expect(fromFileRoute('/[[lang]]/about')).toBe('/:lang?/about');
    expect(fromFileRoute('/(marketing)/pricing')).toBe('/pricing');
    expect(fromFileRoute('/@modal/photo/[id=int]')).toBe('/photo/:id');
    expect(fromFileRoute('/')).toBe('/');
    expect(fromVuePath('/users/:id(\\d+)')).toBe('/users/:id');
    expect(fromVuePath('/users/:id(\\d+)/posts/:postId?')).toBe('/users/:id/posts/:postId?');
    expect(fromVuePath('/:pathMatch(.*)*')).toBe('/*');
    expect(fromVuePath('/files/:path(.*)*')).toBe('/*'.replace('/', '/files/'));
    expect(fromVuePath('/c/:chapters+')).toBe('/c/*');
    expect(fromVuePath('/raw/:rest(.*)')).toBe('/raw/*');
  });
});

describe('discovery click safety', () => {
  const nav = (text: string, extra: Partial<ClickInfo> = {}): ClickInfo => ({ tag: 'button', type: 'button', text, ...extra });

  it('lets plain navigation through', () => {
    for (const t of ['Shop', 'Classes', 'Orders', 'Order history', 'Order 77', 'Addresses', 'Profile', 'Settings', 'Home', 'Help', 'Wishlist', 'Next', 'Back'])
      expect(unsafeReason(nav(t)), t).toBeNull();
    expect(unsafeReason({ tag: 'div', role: 'tab', text: 'Reviews' })).toBeNull();
    expect(unsafeReason({ tag: 'span', role: 'link', text: 'Pricing', fc: 'pricing-link' })).toBeNull();
  });

  it('skips anything that changes data, by text, label, title, data-fc, id or name (camelCase and kebab split)', () => {
    const cases: Array<[ClickInfo, string]> = [
      [nav('Log out'), 'log out'],
      [nav('Logout'), 'logout'],
      [nav('Sign out'), 'sign out'],
      [nav('Delete account'), 'delete'],
      [nav('Remove'), 'remove'],
      [nav('Unsubscribe'), 'unsubscribe'],
      [nav('Pay now'), 'pay'],
      [nav('Purchase'), 'purchase'],
      [nav('Buy'), 'buy'],
      [nav('Checkout'), 'checkout'],
      [nav('Place order'), 'place order'],
      [nav('Confirm booking'), 'confirm'],
      [nav('Save'), 'save'],
      [nav('Add to bag'), 'add'],
      [nav('', { fc: 'add-to-bag' }), 'add'],
      [nav('', { id: 'deleteAccountBtn' }), 'delete'],
      [nav('', { ariaLabel: 'Remove item' }), 'remove'],
      [nav('×', { title: 'Delete' }), 'delete'],
      [nav('', { name: 'unsubscribe_all' }), 'unsubscribe'],
      [nav('Retry'), 'retry'],
    ];
    for (const [info, word] of cases) expect(unsafeReason(info), JSON.stringify(info)).toBe(`"${word}"`);
  });

  it('never submits forms, toggles, downloads, opens windows or follows script links', () => {
    expect(unsafeReason({ tag: 'button', type: 'submit', text: 'Continue' })).toBe('submits a form');
    expect(unsafeReason({ tag: 'button', text: 'Continue', inForm: true })).toBe('submits a form'); // default type in a form
    expect(unsafeReason({ tag: 'button', type: 'button', text: 'Next step', inForm: true })).toBe('inside a form');
    expect(unsafeReason({ tag: 'button', type: 'reset', text: 'Start over' })).toBe('submits a form');
    expect(unsafeReason({ tag: 'input', type: 'submit', text: '' })).toBe('form field');
    expect(unsafeReason(nav('Cups', { toggle: true }))).toBe('toggle');
    expect(unsafeReason({ tag: 'div', role: 'switch', text: 'Dark mode' })).toBe('toggle');
    expect(unsafeReason({ tag: 'div', role: 'checkbox', text: 'Remember' })).toBe('toggle');
    expect(unsafeReason({ tag: 'a', role: 'link', text: 'Invoice', download: true })).toBe('downloads a file');
    expect(unsafeReason({ tag: 'a', role: 'link', text: 'Docs', newWindow: true })).toBe('opens a window');
    expect(unsafeReason({ tag: 'span', role: 'link', text: 'Run', href: 'javascript:void(0)' })).toBe('not a page link');
    expect(unsafeReason({ tag: 'span', role: 'link', text: 'Bye', href: '/account/logout' })).toBe('link to /account/logout');
    expect(unsafeReason(nav('Shop', { disabled: true }))).toBe('disabled');
  });

  it('splits identifiers into words and blocks unsafe paths', () => {
    expect(words('addToBag')).toBe('add To Bag');
    expect(words('wishlist-remove-mug_1')).toBe('wishlist remove mug 1');
    for (const p of ['/logout', '/account/sign-out', '/items/3/delete', '/remove', '/unsubscribe?u=1']) expect(UNSAFE_PATH.test(p), p).toBe(true);
    for (const p of ['/catalog', '/product/remote-control', '/account']) expect(UNSAFE_PATH.test(p), p).toBe(false);
  });
});
