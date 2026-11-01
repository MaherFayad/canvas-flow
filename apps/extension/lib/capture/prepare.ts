/**
 * Page preparation for a screenshot. Runs inside the injected capture.js only
 * (never in the bridge content script), so it does not count against the
 * bridge size budget.
 */
export function idle(win: Window, timeout = 1000): Promise<void> {
  return new Promise((resolve) => {
    const ric = (win as Window & { requestIdleCallback?: Window['requestIdleCallback'] }).requestIdleCallback;
    if (ric) ric.call(win, () => resolve(), { timeout });
    else setTimeout(resolve, 16);
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/** Background colour to paint under the page (body, then html, then white). */
export function pageBackground(win: Window): string {
  const doc = win.document;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const c = win.getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return '#ffffff';
}

/** Wait for fonts (max 2 s) and an idle slot, then report the capture box. */
export async function prepare(win: Window): Promise<{ width: number; height: number; backgroundColor: string }> {
  await withTimeout(win.document.fonts?.ready ?? Promise.resolve(), 2000, undefined);
  await idle(win);
  return { width: win.innerWidth, height: win.innerHeight, backgroundColor: pageBackground(win) };
}
