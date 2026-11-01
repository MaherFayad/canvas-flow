/**
 * Live / still rule (feature 3): a frame is live only when it is on screen AND
 * zoom ≥ 50% AND fewer than `max` frames are live. Hovered frames (400 ms) are
 * forced live. When over budget, the least recently live frame goes still first.
 */
export const MAX_LIVE = 12;
export const MIN_LIVE_ZOOM = 0.5;
export const HOVER_LIVE_MS = 400;

export interface Box {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LiveInput {
  frames: Box[];
  /** Visible area in flow coordinates. */
  view: { x: number; y: number; w: number; h: number };
  zoom: number;
  forced?: ReadonlySet<string>;
  /** key → last time the frame was live (ms). */
  lastLive?: ReadonlyMap<string, number>;
  max?: number;
}

export function intersects(a: Box | LiveInput['view'], b: LiveInput['view']): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function selectLive(input: LiveInput): Set<string> {
  const { frames, view, zoom, forced = new Set(), lastLive = new Map(), max = MAX_LIVE } = input;
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  const visible = zoom >= MIN_LIVE_ZOOM ? frames.filter((f) => intersects(f, view)) : [];
  const byKey = new Map(frames.map((f) => [f.key, f]));
  const candidates = new Map<string, Box>();
  for (const k of forced) {
    const f = byKey.get(k);
    if (f) candidates.set(k, f);
  }
  for (const f of visible) candidates.set(f.key, f);
  const dist = (f: Box) => Math.hypot(f.x + f.w / 2 - cx, f.y + f.h / 2 - cy);
  const ranked = [...candidates.values()].sort((a, b) => {
    const fa = forced.has(a.key) ? 1 : 0;
    const fb = forced.has(b.key) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    const la = lastLive.get(a.key) ?? -1;
    const lb = lastLive.get(b.key) ?? -1;
    if (la !== lb) return lb - la; // most recently live keeps its slot
    return dist(a) - dist(b);
  });
  return new Set(ranked.slice(0, max).map((f) => f.key));
}
