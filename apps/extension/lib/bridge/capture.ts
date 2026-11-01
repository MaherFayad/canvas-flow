/**
 * Screenshot capture inside a frame (feature 8). The heavy library
 * (modern-screenshot) and the page preparation (fonts, idle, background
 * colour) live in `capture.js`, which the background injects into this frame
 * on first use (chrome.scripting). It defines `globalThis.__fcCapture`.
 * This file stays tiny because it is bundled into the bridge content script.
 */
export type CaptureFn = (win: Window, scale: number, quality: number) => Promise<string>;

/** Global the injected capture script defines (isolated world, shared with the bridge). */
export const CAPTURE_GLOBAL = '__fcCapture';

export function createCapturer(win: Window, load: () => Promise<CaptureFn | null>) {
  let fn: Promise<CaptureFn | null> | null = null;
  return async (scale: number, quality: number): Promise<string> => {
    fn ??= load().catch(() => null);
    const cap = await fn;
    if (!cap) {
      fn = null;
      throw new Error('capture library unavailable');
    }
    return cap(win, scale, quality);
  };
}
