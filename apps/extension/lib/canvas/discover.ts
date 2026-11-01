import { toKebab, type FlowCanvasConfig, type Screen, type Section } from '@flowcanvas/config';
import type { ScreenDecl } from '@flowcanvas/protocol';
import { normPath } from '../url';
import { contentBottom, gridPositions } from './layout';
import { titleFromPath, uniqueScreenId } from './record';
import { SECTION_PAD, SECTION_TITLE_H } from './geometry';

export const UNSORTED = 'unsorted';
export const SKIP_CRAWL = /logout|log-out|signout|sign-out|delete|remove/i;

/** BFS crawl state: follows same-origin links `maxDepth` levels from `/`, at most `maxPages`. */
export class Crawler {
  private queue: Array<{ path: string; depth: number }> = [];
  private seen = new Set<string>();
  readonly visited: string[] = [];

  constructor(
    start = '/',
    private maxDepth = 2,
    private maxPages = 50,
  ) {
    this.enqueue(start, 0);
  }

  private enqueue(path: string, depth: number) {
    const p = normPath(path);
    if (this.seen.has(p) || SKIP_CRAWL.test(p)) return;
    this.seen.add(p);
    this.queue.push({ path: p, depth });
  }

  /** Next page to load, or null when done. */
  next(): { path: string; depth: number } | null {
    if (this.visited.length >= this.maxPages) return null;
    const n = this.queue.shift() ?? null;
    if (n) this.visited.push(n.path);
    return n;
  }

  /** Links found on a page loaded at `depth`. */
  addLinks(links: string[], depth: number) {
    if (depth >= this.maxDepth) return;
    for (const l of links) this.enqueue(l, depth + 1);
  }

  get pending(): number {
    return this.queue.length;
  }
}

function withUnsorted(c: FlowCanvasConfig): Section[] {
  if (c.sections.some((s) => s.id === UNSORTED)) return c.sections;
  const order = c.sections.reduce((m, s) => Math.max(m, s.order), -1) + 1;
  return [...c.sections, { id: UNSORTED, title: 'Unsorted', parent: null, color: 'grey', layout: 'grid', collapsed: false, locked: false, order }];
}

/** Add crawled paths as screens in "Unsorted", laid out 3 per row below existing content. Known paths are skipped. */
export function addPathScreens(c: FlowCanvasConfig, paths: string[]): FlowCanvasConfig {
  const known = new Set(c.screens.map((s) => normPath(s.path)));
  const fresh: Screen[] = [];
  let work = c;
  for (const p of paths) {
    const np = normPath(p);
    if (known.has(np)) continue;
    known.add(np);
    const s: Screen = { id: uniqueScreenId(work, np), title: titleFromPath(np), section: UNSORTED, path: np, states: ['default'] };
    fresh.push(s);
    work = { ...work, screens: [...work.screens, s] };
  }
  if (!fresh.length) return c;
  const top = c.screens.length ? contentBottom(c) + SECTION_TITLE_H + SECTION_PAD * 2 : 0;
  const pos = gridPositions(fresh, { x: 0, y: top }, 3);
  const placed = fresh.map((s) => ({ ...s, position: pos.get(s.id) }));
  return { ...c, sections: withUnsorted(c), screens: [...c.screens, ...placed] };
}

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** SDK screen list → screens (sections from `group`, else Unsorted). */
export function addSdkScreens(c: FlowCanvasConfig, decls: ScreenDecl[]): FlowCanvasConfig {
  let sections = [...c.sections];
  const screens: Screen[] = [...c.screens];
  for (const d of decls) {
    const sid = toKebab(d.id);
    if (screens.some((s) => s.id === sid)) continue;
    let section = UNSORTED;
    if (d.group) {
      section = toKebab(d.group);
      if (!sections.some((s) => s.id === section)) {
        sections.push({ id: section, title: titleCase(d.group), parent: null, color: 'grey', layout: 'row', collapsed: false, locked: false, order: sections.length });
      }
    } else if (!sections.some((s) => s.id === UNSORTED)) {
      sections = withUnsorted({ ...c, sections });
    }
    screens.push({
      id: sid,
      title: d.title ?? titleCase(d.id),
      section,
      path: d.path.startsWith('/') ? d.path : `/${d.path}`,
      states: d.states?.length ? d.states : ['default'],
    });
  }
  return { ...c, sections, screens };
}
