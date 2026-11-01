import { defineContentScript } from 'wxt/utils/define-content-script';
import { startBridge } from '@/lib/bridge/bridge';
import { CAPTURE_GLOBAL, type CaptureFn } from '@/lib/bridge/capture';
import { LOAD_CAPTURE } from '@/lib/messages';

/**
 * Asks the background to inject the screenshot library (capture.js) into this
 * frame, on first use only. It runs in this same isolated world and defines
 * globalThis.__fcCapture. Keeps modern-screenshot out of the content script.
 */
async function loadCapturer(): Promise<CaptureFn | null> {
  const g = globalThis as unknown as Record<string, CaptureFn | undefined>;
  if (!g[CAPTURE_GLOBAL]) {
    const r = (await chrome.runtime.sendMessage({ type: LOAD_CAPTURE })) as { ok: boolean; error?: string } | undefined;
    if (!r?.ok) throw new Error(r?.error ?? 'capture script not injected');
  }
  return g[CAPTURE_GLOBAL] ?? null;
}

/** Isolated world. Inert unless this is a canvas frame (fc-frame + inside an iframe). */
export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*', 'http://*.localhost/*'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    startBridge({ win: window, extensionOrigin: `chrome-extension://${chrome.runtime.id}`, loadCapturer });
  },
});
