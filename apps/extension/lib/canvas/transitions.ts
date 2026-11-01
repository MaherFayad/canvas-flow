/**
 * Player transition keyframes (feature 6, UI_REFERENCE motion rule 9).
 * A = the screen on show now (outgoing), B = the next screen (already loaded
 * and painted underneath A). Each plan says which layer is on top during the
 * move and gives Web Animations keyframes for A, B and the dim layer, which
 * sits directly under the top layer.
 */
import type { Edge } from '@flowcanvas/config';
import { SNAPPY, formatBezier, parseEasing } from './easing';

export type TransitionType = Edge['transition']['type'];

export interface TransitionPlan {
  /** Which layer paints on top while animating. */
  top: 'a' | 'b';
  a: Keyframe[] | null;
  b: Keyframe[] | null;
  /** Dim layer opacity keyframes (black), drawn just under the top layer. */
  dim: Keyframe[] | null;
  duration: number;
  easing: string;
}

/** Push dims the screen it covers slightly; a sheet dims it to 40 % (UI_REFERENCE rule 9). */
export const PUSH_DIM = 0.12;
export const SHEET_DIM = 0.4;
export const REDUCED_MS = 120;

const REVERSE: Record<TransitionType, TransitionType> = {
  push: 'pop',
  pop: 'push',
  'sheet-up': 'sheet-down',
  'sheet-down': 'sheet-up',
  fade: 'fade',
  none: 'none',
};

export function reverseOf(t: TransitionType): TransitionType {
  return REVERSE[t];
}

/** WAAPI accepts CSS easing strings directly; fall back to Snappy for anything it would reject. */
export function waapiEasing(s: string): string {
  return parseEasing(s) ? s.trim() : formatBezier(SNAPPY);
}

const tx = (p: string) => ({ transform: `translate3d(${p}, 0, 0)` });
const ty = (p: string) => ({ transform: `translate3d(0, ${p}, 0)` });
const op = (o: number) => ({ opacity: o });

export function planTransition(
  type: TransitionType,
  opts: { duration: number; easing: string; reduced?: boolean },
): TransitionPlan {
  const easing = waapiEasing(opts.easing);
  const duration = Math.max(0, opts.duration);
  if (type === 'none' || duration === 0) return { top: 'b', a: null, b: null, dim: null, duration: 0, easing };
  if (opts.reduced) return { top: 'a', a: [op(1), op(0)], b: null, dim: null, duration: REDUCED_MS, easing: 'linear' };
  switch (type) {
    case 'push':
      return { top: 'b', a: [tx('0%'), tx('-30%')], b: [tx('100%'), tx('0%')], dim: [op(0), op(PUSH_DIM)], duration, easing };
    case 'pop':
      return { top: 'a', a: [tx('0%'), tx('100%')], b: [tx('-30%'), tx('0%')], dim: [op(PUSH_DIM), op(0)], duration, easing };
    case 'sheet-up':
      return { top: 'b', a: null, b: [ty('100%'), ty('0%')], dim: [op(0), op(SHEET_DIM)], duration, easing };
    case 'sheet-down':
      return { top: 'a', a: [ty('0%'), ty('100%')], b: null, dim: [op(SHEET_DIM), op(0)], duration, easing };
    case 'fade':
      // B is fully painted underneath, so fading A out is a true cross-fade with nothing blank showing through.
      return { top: 'a', a: [op(1), op(0)], b: null, dim: null, duration, easing };
    default:
      return { top: 'b', a: null, b: null, dim: null, duration: 0, easing };
  }
}

/** Plan for an edge, forwards or backwards (Back / Esc plays the reverse). */
export function planForEdge(edge: Pick<Edge, 'transition'>, reverse: boolean, reduced = false): TransitionPlan {
  const t = reverse ? reverseOf(edge.transition.type) : edge.transition.type;
  return planTransition(t, { duration: edge.transition.duration, easing: edge.transition.easing, reduced });
}

/** Pick the edge the → key plays: the one to the next step in the row, else the first happy edge, else the first. */
export function primaryEdge(edges: Edge[], preferTo?: { screen: string; state?: string } | null): Edge | null {
  if (!edges.length) return null;
  if (preferTo) {
    const e = edges.find((x) => x.to.screen === preferTo.screen && (!preferTo.state || x.to.state === preferTo.state));
    if (e) return e;
  }
  return edges.find((e) => e.kind === 'happy') ?? edges[0]!;
}

/** Does a click reported by the bridge hit this edge's trigger target? */
export function clickMatches(edge: Edge, target: string): boolean {
  const t = edge.trigger.target?.trim();
  return !!t && t === target.trim();
}
