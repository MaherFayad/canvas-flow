/**
 * Screenshot capture inside a frame (feature 8). The heavy library
 * (modern-screenshot) is NOT bundled here: `load()` asks the background to
 * inject `capture.js` into this frame on first use (chrome.scripting), which
 * defines `globalThis.__fcCapture`. The bridge stays small.
 */
export type CaptureFn = (node: Element, opts: CaptureOptions) => Promise<string>;
export interface CaptureOptions {
  scale: number;
  quality: number;
  width: number;
  height: number;
  backgroundColor?: string | null;
}

/** Global the injected capture script defines (isolated world, shared with the bridge). */
export const CAPTURE_GLOBAL = '__fcCapture';

export function idle(win: Window, timeout = 1000): Promise<void> {
  return new Promise((resolve) => {
    const ric = (win as Window & { requestIdleCallback?: Window['requestIdleCallback'] }).requestIdleCallback;
    if (ric) ric.call(win, () => resolve(), { timeout });
    else setTimeout(resolve, 16);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/** Background colour to paint under the page (body, then html, then white). */
function pageBackground(win: Window): string {
  const doc = win.document;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const c = win.getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return '#ffffff';
}

export function createCapturer(win: Window, load: () => Promise<CaptureFn | null>) {
  let fn: Promise<CaptureFn | null> | null = null;
  return async (scale: number, quality: number): Promise<string> => {
    fn ??= load().catch(() => null);
    const cap = await fn;
    if (!cap) {
      fn = null;
      throw new Error('capture library unavailable');
    }
    await withTimeout(win.document.fonts?.ready ?? Promise.resolve(), 2000, undefined);
    await idle(win);
    return cap(win.document.documentElement, {
      scale,
      quality,
      width: win.innerWidth,
      height: win.innerHeight,
      backgroundColor: pageBackground(win),
    });
  };
}
