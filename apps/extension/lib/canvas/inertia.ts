/**
 * Inertia on drag-pan release (UI_REFERENCE motion rule 2). React Flow's
 * d3-zoom stops dead on mouse-up; we sample the viewport while the pane is
 * dragged and, on release, keep it moving with an exponential decay
 * (time constant ~325 ms, as in iOS-style kinetic scrolling). Any new
 * pointer-down, wheel or key press, or any other camera
 * move (fly-to, fitView, minimap), stops it where it is.
 */
import { useEffect } from 'react';
import { useReactFlow, useStoreApi } from '@xyflow/react';
import { prefersReducedMotion } from './easing';

export const INERTIA_TAU = 325;
/** Below this release speed (px/ms) there is no glide. */
export const MIN_SPEED = 0.15;
/** Velocity is measured over the last part of the drag only. */
export const SAMPLE_MS = 100;
/** Throw distance = velocity × τ × this (a bit shorter than the pure-physics value feels calmer). */
export const THROW = 0.8;

export interface Sample {
  x: number;
  y: number;
  t: number;
}

/** Release velocity (px/ms) from recent samples; zero if the pointer rested before release. */
export function releaseVelocity(samples: Sample[], now: number): { vx: number; vy: number } {
  const recent = samples.filter((s) => now - s.t <= SAMPLE_MS);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const a = recent[0]!;
  const b = recent[recent.length - 1]!;
  if (now - b.t > 50) return { vx: 0, vy: 0 }; // held still before letting go
  const dt = Math.max(1, b.t - a.t);
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
}

/** Offset from the release point at time t (ms) for a release velocity v (px/ms). */
export function decayOffset(v: number, t: number, tau = INERTIA_TAU): number {
  return v * tau * THROW * (1 - Math.exp(-t / tau));
}

/** Total glide length and when the remaining motion drops under half a pixel. */
export function decayEnd(v: number, tau = INERTIA_TAU): { distance: number; ms: number } {
  const distance = v * tau * THROW;
  const ms = Math.abs(distance) < 0.5 ? 0 : tau * Math.log(Math.abs(distance) / 0.5);
  return { distance, ms };
}

/**
 * Hook for Canvas mode: inertia after a pane drag, and `will-change: transform`
 * on the viewport layer only while it is moving (so text re-rasterises sharp at rest).
 */
export function useCanvasMotion(container: React.RefObject<HTMLElement | null>) {
  const rf = useReactFlow();
  const store = useStoreApi();
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let samples: Sample[] = [];
    let dragging = false;
    let raf = 0;
    let lastGlide: { ms: number; distance: number; stoppedBy: string } | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const viewportEl = () => root.querySelector<HTMLElement>('.react-flow__viewport');

    const moving = () => {
      const el = viewportEl();
      if (el && el.style.willChange !== 'transform') el.style.willChange = 'transform';
      clearTimeout(idle);
      idle = setTimeout(() => {
        const v = viewportEl();
        if (v) v.style.willChange = '';
      }, 160);
    };
    let last = store.getState().transform;
    const unsub = store.subscribe((s) => {
      if (s.transform === last) return;
      last = s.transform;
      moving();
      if (dragging) {
        const [x, y] = s.transform;
        samples.push({ x, y, t: performance.now() });
        if (samples.length > 30) samples = samples.slice(-15);
      }
    });

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onDown = (e: PointerEvent) => {
      stop();
      const t = e.target as Element | null;
      dragging = !!t?.closest('.react-flow__pane') && e.button === 0;
      samples = [];
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      if (prefersReducedMotion()) return;
      const now = performance.now();
      const { vx, vy } = releaseVelocity(samples, now);
      if (Math.hypot(vx, vy) < MIN_SPEED) return;
      const [x0, y0, zoom] = store.getState().transform;
      const end = Math.max(decayEnd(vx).ms, decayEnd(vy).ms);
      const t0 = now;
      let set = { x: x0, y: y0 };
      const step = (ts: number) => {
        // Anything else moved the camera (fly-to, fitView, minimap): it wins, the glide stops.
        const [cx, cy, cz] = store.getState().transform;
        if (Math.abs(cx - set.x) > 0.5 || Math.abs(cy - set.y) > 0.5 || cz !== zoom) {
          lastGlide = { ms: ts - t0, distance: Math.hypot(set.x - x0, set.y - y0), stoppedBy: 'camera' };
          raf = 0;
          return;
        }
        const t = ts - t0;
        set = { x: x0 + decayOffset(vx, t), y: y0 + decayOffset(vy, t) };
        rf.setViewport({ ...set, zoom });
        raf = t < end ? requestAnimationFrame(step) : 0;
        if (!raf) lastGlide = { ms: t, distance: Math.hypot(set.x - x0, set.y - y0), stoppedBy: 'rest' };
      };
      raf = requestAnimationFrame(step);
    };
    root.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    root.addEventListener('wheel', stop, { capture: true, passive: true });
    window.addEventListener('keydown', stop, true);
    const w = window as unknown as { __fc?: Record<string, unknown> };
    (w.__fc ??= {}).inertia = { active: () => raf !== 0, last: () => lastGlide };
    return () => {
      stop();
      clearTimeout(idle);
      unsub();
      root.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      root.removeEventListener('wheel', stop, true);
      window.removeEventListener('keydown', stop, true);
    };
  }, [container, rf, store]);
}
