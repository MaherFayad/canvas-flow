import type { FlowCanvasConfig } from '@flowcanvas/config';

const j = (v: unknown) => JSON.stringify(v);

function countById<T extends { id: string }>(a: T[], b: T[]): number {
  const ma = new Map(a.map((x) => [x.id, j(x)]));
  const mb = new Map(b.map((x) => [x.id, j(x)]));
  let n = 0;
  for (const [k, v] of ma) if (mb.get(k) !== v) n++;
  for (const k of mb.keys()) if (!ma.has(k)) n++;
  return n;
}

function countByKey(a: Record<string, unknown>, b: Record<string, unknown>): number {
  let n = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (j(a[k]) !== j(b[k])) n++;
  return n;
}

/** Number of items that differ between the saved config and the working copy (the "unsaved" counter). */
export function countChanges(saved: FlowCanvasConfig, cur: FlowCanvasConfig): number {
  if (saved === cur) return 0;
  return (
    (j(saved.project) !== j(cur.project) ? 1 : 0) +
    countById(saved.screens, cur.screens) +
    countById(saved.edges, cur.edges) +
    countById(saved.sections, cur.sections) +
    countById(saved.notes, cur.notes) +
    countById(saved.images, cur.images) +
    countById(saved.comments, cur.comments) +
    countById(saved.devices, cur.devices) +
    countByKey(saved.mocks, cur.mocks) +
    countByKey(saved.tokens, cur.tokens)
  );
}

/** Top-bar text: "1 unsaved edge" when only edges changed, else "N unsaved changes". */
export function describeChanges(saved: FlowCanvasConfig, cur: FlowCanvasConfig): { count: number; text: string; onlyEdges: boolean } {
  const count = countChanges(saved, cur);
  const edges = countById(saved.edges, cur.edges);
  const onlyEdges = count > 0 && edges === count;
  const noun = onlyEdges ? 'edge' : 'change';
  return { count, onlyEdges, text: count ? `${count} unsaved ${noun}${count === 1 ? '' : 's'}` : '' };
}
