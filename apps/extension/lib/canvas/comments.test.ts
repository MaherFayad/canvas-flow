import { describe, expect, it } from 'vitest';
import { emptyConfig, type Comment, type FlowCanvasConfig } from '@flowcanvas/config';
import { filterComments, mentionsClaude, newComment, pinPoint, sectionPrompt, threadPrompt } from './comments';

const el = {
  selector: '[data-fc="clear-filters"]',
  tag: 'button',
  text: 'Clear filters',
  rect: { x: 180, y: 590, w: 82, h: 28 },
  html: '<button data-fc="clear-filters" class="btn-ghost">Clear filters</button>',
  styles: { color: 'rgb(26, 26, 26)', font: '500 13px Inter' },
};
const viewport = { w: 440, h: 956 };
// Pin dropped 10 px right / 14 px down inside the button.
const anchor: Comment['anchor'] = { frame: 'catalog:empty', device: 'iphone-16-pro-max', x: 190 / 440, y: 604 / 956, element: el };

describe('pin re-anchoring', () => {
  it('no live answer: the saved spot', () => {
    expect(pinPoint(anchor, viewport)).toEqual({ x: 190, y: 604, stale: false });
  });
  it('follows the element when the layout shifts (same offset inside it)', () => {
    const p = pinPoint(anchor, viewport, { found: true, rect: { x: 180, y: 650, w: 82, h: 28 } });
    expect(p).toEqual({ x: 190, y: 664, stale: false });
  });
  it('clamps the offset when the element shrinks', () => {
    const p = pinPoint(anchor, viewport, { found: true, rect: { x: 20, y: 30, w: 4, h: 4 } });
    expect(p).toEqual({ x: 24, y: 34, stale: false });
  });
  it('selector no longer matches: grey "moved or removed" at the saved spot', () => {
    expect(pinPoint(anchor, viewport, { found: false, rect: null })).toEqual({ x: 190, y: 604, stale: true });
  });
  it('matched element with no box (display:none) counts as removed', () => {
    expect(pinPoint(anchor, viewport, { found: true, rect: { x: 0, y: 0, w: 0, h: 0 } }).stale).toBe(true);
  });
  it('a spot comment without element context never goes stale', () => {
    expect(pinPoint({ ...anchor, element: null }, viewport, { found: false, rect: null }).stale).toBe(false);
  });
});

describe('For Claude + filters', () => {
  it('@claude marks a comment for Claude (not emails or other words)', () => {
    expect(mentionsClaude('@claude make this 44px')).toBe(true);
    expect(mentionsClaude('hey @Claude, please')).toBe(true);
    expect(mentionsClaude('mail claude@anthropic.com')).toBe(false);
    expect(mentionsClaude('@claudette')).toBe(false);
    const c = newComment({ frame: 'catalog:empty', x: 0.5, y: 0.5, element: el, text: 'cc @claude', forClaude: false });
    expect(c.to).toBe('claude');
    expect(newComment({ frame: 'a:b', x: 2, y: -1, element: null, text: 'x', forClaude: false })).toMatchObject({ to: null, anchor: { x: 1, y: 0 } });
  });
  it('Open, Resolved, Mine, For Claude', () => {
    const a = newComment({ frame: 'a:default', x: 0, y: 0, element: null, text: 'mine', forClaude: true });
    const b = { ...newComment({ frame: 'a:default', x: 0, y: 0, element: null, text: 'theirs', forClaude: false, author: 'sara' }), status: 'resolved' as const };
    expect(filterComments([a, b], 'open')).toEqual([a]);
    expect(filterComments([a, b], 'resolved')).toEqual([b]);
    expect(filterComments([a, b], 'mine')).toEqual([a]);
    expect(filterComments([a, b], 'claude')).toEqual([a]);
  });
});

describe('Copy as prompt', () => {
  const cfg: FlowCanvasConfig = {
    ...emptyConfig('http://localhost:5173', 'Helka ceramics'),
    sections: [{ id: 'browse', title: 'Browse', parent: null, color: 'grey', layout: 'row', collapsed: false, locked: false, order: 0 }],
    screens: [
      { id: 'catalog', title: 'Catalog', section: 'browse', path: '/catalog', states: ['default', 'empty'] },
      { id: 'product', title: 'Product', section: 'browse', path: '/p/1', states: ['default'] },
    ],
    edges: [{ id: 'e1', from: { screen: 'catalog', state: 'default' }, to: { screen: 'product', state: 'default' }, trigger: { label: 'Open', gesture: 'tap', target: '[data-fc="card"]' }, transition: { type: 'push', duration: 240, easing: 'ease' }, kind: 'happy' }],
    notes: [{ id: 'n1', kind: 'decision', text: 'Cards open the product', attachTo: null, rect: { x: 0, y: 0, w: 1, h: 1 }, section: 'browse', author: 'me', createdAt: '' }],
    comments: [
      {
        id: 'c-1',
        status: 'open',
        to: 'claude',
        anchor,
        thread: [
          { author: 'me', text: '@claude make this a 44 px target', at: '2026-11-01T10:20:00Z' },
          { author: 'claude', text: 'Done', at: '2026-11-01T10:21:30Z', changes: ['e9'] },
        ],
      },
    ],
  };
  it('thread: element context, HTML block, thread with Claude and changes', () => {
    const p = threadPrompt(cfg, cfg.comments[0]!);
    expect(p).toContain('## Comment #1 on Catalog · empty (iPhone 16 Pro Max)');
    expect(p).toContain('Element: `[data-fc="clear-filters"]` (button) "Clear filters"');
    expect(p).toContain('Box: 82×28 at (180, 590)');
    expect(p).toContain('```html\n<button data-fc="clear-filters" class="btn-ghost">Clear filters</button>\n```');
    expect(p).toContain('- **Claude** (2026-11-01 10:21): Done Changes: e9');
  });
  it('section: screens, flows, notes, open comments', () => {
    const p = sectionPrompt(cfg, 'browse');
    expect(p.startsWith('# Section: Browse')).toBe(true);
    expect(p).toContain('- Catalog (`catalog`, `/catalog`): states default, empty');
    expect(p).toContain('Catalog · default → Product · default: tap "Open" on `[data-fc="card"]` (push 240ms, happy) · `e1`');
    expect(p).toContain('- [decision] Cards open the product');
    expect(p).toContain('## Comment #1');
  });
});
