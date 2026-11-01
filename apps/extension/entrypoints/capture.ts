import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { domToWebp } from 'modern-screenshot';
import { CAPTURE_GLOBAL, type CaptureFn } from '@/lib/bridge/capture';

/**
 * Screenshot library, injected on demand into one canvas frame by the
 * background (chrome.scripting.executeScript, isolated world) when the bridge
 * gets its first `capture` request. Never a content script, never web-accessible.
 */
export default defineUnlistedScript(() => {
  const capture: CaptureFn = (node, o) =>
    domToWebp(node, {
      scale: o.scale,
      quality: o.quality,
      width: o.width,
      height: o.height,
      backgroundColor: o.backgroundColor ?? '#ffffff',
      timeout: 8000,
    });
  (globalThis as unknown as Record<string, CaptureFn>)[CAPTURE_GLOBAL] = capture;
});
