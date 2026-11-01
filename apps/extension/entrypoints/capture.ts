import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { domToWebp } from 'modern-screenshot';
import { CAPTURE_GLOBAL, type CaptureFn } from '@/lib/bridge/capture';
import { prepare } from '@/lib/capture/prepare';

/**
 * Screenshot library, injected on demand into one canvas frame by the
 * background (chrome.scripting.executeScript, isolated world) when the bridge
 * gets its first `capture` request. Never a content script, never web-accessible.
 */
export default defineUnlistedScript(() => {
  const capture: CaptureFn = async (win, scale, quality) => {
    const box = await prepare(win);
    return domToWebp(win.document.documentElement, { scale, quality, ...box, timeout: 8000 });
  };
  (globalThis as unknown as Record<string, CaptureFn>)[CAPTURE_GLOBAL] = capture;
});
