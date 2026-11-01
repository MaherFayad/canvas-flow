/**
 * Comments (feature 10): numbered pins on frames with the element under the
 * pin, threads, filters, "For Claude", pins that follow their selector, and
 * "Copy as prompt".
 */
import { frameKey, id as newId, type Comment, type FlowCanvasConfig } from '@flowcanvas/config';
import type { ElementContext, Rect } from '@flowcanvas/protocol';
import { descendants } from './sections';

export type { ElementContext };
export const ME = 'me';
export const CLAUDE = 'claude';

export type CommentFilter = 'open' | 'resolved' | 'mine' | 'claude';
export const COMMENT_FILTERS: CommentFilter[] = ['open', 'resolved', 'mine', 'claude'];
export const FILTER_LABEL: Record<CommentFilter, string> = { open: 'Open', resolved: 'Resolved', mine: 'Mine', claude: 'For Claude' };

/** "@claude" anywhere in the text marks a comment For Claude. */
export function mentionsClaude(text: string): boolean {
  return /(^|[^\w@])@claude\b/i.test(text);
}

export function newComment(input: {
  frame: string;
  device?: string;
  x: number;
  y: number;
  element: ElementContext | null;
  text: string;
  forClaude: boolean;
  author?: string;
}): Comment {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    id: newId('c'),
    status: 'open',
    to: input.forClaude || mentionsClaude(input.text) ? 'claude' : null,
    anchor: {
      frame: input.frame,
      ...(input.device ? { device: input.device } : {}),
      x: clamp(input.x),
      y: clamp(input.y),
      element: input.element,
    },
    thread: [{ author: input.author ?? ME, text: input.text, at: new Date().toISOString() }],
  };
}

export function filterComments(list: Comment[], f: CommentFilter, me = ME): Comment[] {
  switch (f) {
    case 'open':
      return list.filter((c) => c.status === 'open');
    case 'resolved':
      return list.filter((c) => c.status === 'resolved');
    case 'mine':
      return list.filter((c) => c.thread[0]?.author === me);
    case 'claude':
      return list.filter((c) => c.to === 'claude');
  }
}

/** Pin number: position in the config's comment list, 1-based (stable as long as comments are not deleted). */
export function commentNumber(c: FlowCanvasConfig, id: string): number {
  return c.comments.findIndex((x) => x.id === id) + 1;
}

export interface Probe {
  found: boolean;
  rect: Rect | null;
}

/**
 * Where to draw a pin, in CSS px inside the frame's viewport.
 * - No live answer yet: the saved spot.
 * - Selector still matches: keep the pin at the same offset inside the
 *   element's new box (layout shifts carry it along).
 * - Selector no longer matches (or the element has no box): the saved spot, stale.
 */
export function pinPoint(anchor: Comment['anchor'], viewport: { w: number; h: number }, probe?: Probe): { x: number; y: number; stale: boolean } {
  const base = { x: anchor.x * viewport.w, y: anchor.y * viewport.h };
  const el = anchor.element;
  if (!probe || !el) return { ...base, stale: false };
  const r = probe.rect;
  if (!probe.found || !r || (r.w <= 0 && r.h <= 0)) return { ...base, stale: true };
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(0, max));
  return { x: r.x + clamp(base.x - el.rect.x, r.w), y: r.y + clamp(base.y - el.rect.y, r.h), stale: false };
}

/* ------------------------------ prompts ------------------------------ */

const fence = (s: string) => (s.includes('```') ? s.replace(/```/g, '``​`') : s);

function frameName(c: FlowCanvasConfig, key: string): string {
  const [sid, st = 'default'] = key.split(':');
  const s = c.screens.find((x) => x.id === sid);
  return `${s?.title ?? sid} · ${st}`;
}

function elementBlock(el: ElementContext): string[] {
  const out = [`Element: \`${el.selector}\` (${el.tag})${el.text ? ` "${el.text}"` : ''}`];
  out.push(`Box: ${el.rect.w}×${el.rect.h} at (${el.rect.x}, ${el.rect.y})`);
  const st = Object.entries(el.styles);
  if (st.length) out.push(`Styles: ${st.map(([k, v]) => `${k} ${v}`).join('; ')}`);
  if (el.html) out.push('', '```html', fence(el.html), '```');
  return out;
}

/** "Copy as prompt" for one thread: clean markdown with the element context. */
export function threadPrompt(c: FlowCanvasConfig, cm: Comment): string {
  const n = commentNumber(c, cm.id);
  const screen = c.screens.find((s) => s.id === cm.anchor.frame.split(':')[0]);
  const device = c.devices.find((d) => d.id === cm.anchor.device);
  const lines = [
    `## Comment #${n} on ${frameName(c, cm.anchor.frame)}${device ? ` (${device.label})` : ''}`,
    '',
    `Status: ${cm.status}${cm.to === 'claude' ? ' · For Claude' : ''} · id \`${cm.id}\``,
  ];
  if (screen) lines.push(`Screen: \`${screen.id}\` at \`${screen.path}\`, state \`${cm.anchor.frame.split(':')[1] ?? 'default'}\``);
  if (cm.anchor.element) lines.push('', ...elementBlock(cm.anchor.element));
  else lines.push(`Spot: ${Math.round(cm.anchor.x * 100)}% across, ${Math.round(cm.anchor.y * 100)}% down`);
  lines.push('', 'Thread:');
  for (const m of cm.thread) {
    const who = m.author === CLAUDE ? 'Claude' : m.author;
    lines.push(`- **${who}** (${m.at.slice(0, 16).replace('T', ' ')}): ${m.text.replace(/\n+/g, ' ')}${m.changes?.length ? ` Changes: ${m.changes.join(', ')}` : ''}`);
  }
  return lines.join('\n') + '\n';
}

/** "Copy as prompt" for a section: its screens, flows, notes and open comments. */
export function sectionPrompt(c: FlowCanvasConfig, sid: string): string {
  const sec = c.sections.find((s) => s.id === sid);
  if (!sec) return '';
  const inside = descendants(c, sid);
  const screens = c.screens.filter((s) => s.section && inside.has(s.section));
  const ids = new Set(screens.map((s) => s.id));
  const title = new Map(c.screens.map((s) => [s.id, s.title]));
  const edges = c.edges.filter((e) => ids.has(e.from.screen) || ids.has(e.to.screen));
  const notes = c.notes.filter((n) => (n.section && inside.has(n.section)) || (n.attachTo?.type === 'section' && inside.has(n.attachTo.id)));
  const comments = c.comments.filter((cm) => cm.status === 'open' && ids.has(cm.anchor.frame.split(':')[0]!));
  const lines = [`# Section: ${sec.title}`, '', `Project: ${c.project.name} (${c.project.origin}) · section id \`${sec.id}\``, '', '## Screens'];
  for (const s of screens) lines.push(`- ${s.title} (\`${s.id}\`, \`${s.path}\`): states ${s.states.join(', ')}`);
  if (edges.length) {
    lines.push('', '## Flows');
    for (const e of edges) {
      const t = e.trigger;
      lines.push(
        `- ${title.get(e.from.screen) ?? e.from.screen} · ${e.from.state} → ${title.get(e.to.screen) ?? e.to.screen} · ${e.to.state}: ${t.gesture}${t.label ? ` "${t.label}"` : ''}${t.target ? ` on \`${t.target}\`` : ''} (${e.transition.type} ${e.transition.duration}ms, ${e.kind}) · \`${e.id}\``,
      );
    }
  }
  if (notes.length) {
    lines.push('', '## Notes');
    for (const n of notes) lines.push(`- [${n.kind}] ${n.text.replace(/\n+/g, ' ')}`);
  }
  if (comments.length) {
    lines.push('', '## Open comments', '');
    for (const cm of comments) lines.push(threadPrompt(c, cm));
  }
  return lines.join('\n').trimEnd() + '\n';
}

export { frameKey };
