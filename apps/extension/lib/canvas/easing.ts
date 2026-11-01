/** Cubic-bezier math, CSS easing parsing and an interruptible rAF tween (UI_REFERENCE motion rules 1, 6). */

export type Bezier = [number, number, number, number];

export const SNAPPY: Bezier = [0.2, 0.8, 0.2, 1];
export const CAMERA_MS = 450;

const KEYWORDS: Record<string, Bezier> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** Parse `cubic-bezier(a, b, c, d)` or a keyword. Returns null for anything else (steps(), spring presets…). */
export function parseEasing(s: string): Bezier | null {
  const t = s.trim().toLowerCase();
  if (KEYWORDS[t]) return KEYWORDS[t]!;
  const m = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/.exec(t);
  if (!m) return null;
  const v = m.slice(1).map(Number) as Bezier;
  if (v.some((n) => !Number.isFinite(n)) || v[0] < 0 || v[0] > 1 || v[2] < 0 || v[2] > 1) return null;
  return v;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export function formatBezier(b: Bezier): string {
  return `cubic-bezier(${b.map(r2).join(', ')})`;
}

/** y(x) for a CSS cubic-bezier, via Newton + bisection on x(t). */
export function bezierFn([x1, y1, x2, y2]: Bezier): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

/**
 * Interruptible tween: calling start() again cancels the running one and
 * continues from wherever `read()` is now (no snap).
 */
export function createTween(read: () => number[], write: (v: number[]) => void) {
  let raf = 0;
  return {
    start(to: number[], ms = CAMERA_MS, curve: Bezier = SNAPPY, onDone?: () => void) {
      cancelAnimationFrame(raf);
      const from = read();
      if (ms <= 0 || prefersReducedMotion()) {
        write(to);
        onDone?.();
        return;
      }
      const ease = bezierFn(curve);
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / ms);
        const k = ease(p);
        write(from.map((f, i) => f + ((to[i] ?? f) - f) * k));
        if (p < 1) raf = requestAnimationFrame(step);
        else onDone?.();
      };
      raf = requestAnimationFrame(step);
    },
    cancel() {
      cancelAnimationFrame(raf);
    },
  };
}
