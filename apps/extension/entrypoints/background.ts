import { defineBackground } from 'wxt/utils/define-background';
import { isLocalOrigin } from '@/lib/origin';
import { LOAD_CAPTURE } from '@/lib/messages';

/**
 * Toolbar click opens the canvas bound to the active tab's origin (feature 1).
 * No popup: one click is the whole flow; recent projects are offered in the
 * canvas origin field instead. An existing canvas tab for the origin is focused.
 */
export default defineBackground(() => {
  chrome.action.onClicked.addListener(async (tab) => {
    let origin = '';
    try {
      if (tab.url) origin = new URL(tab.url).origin;
    } catch {
      origin = '';
    }
    const base = chrome.runtime.getURL('/canvas.html');
    const url = isLocalOrigin(origin) ? `${base}?origin=${encodeURIComponent(origin)}` : base;
    const existing = (await chrome.tabs.query({ url: `${base}*` })).find((t) => t.url === url);
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
    await chrome.tabs.create({ url, index: tab.index + 1 });
  });

  /* Screenshots (feature 8): inject the capture library into the asking frame only, on demand. */
  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if ((msg as { type?: string } | null)?.type !== LOAD_CAPTURE) return;
    const tabId = sender.tab?.id;
    if (tabId === undefined || sender.frameId === undefined) {
      reply({ ok: false, error: 'no frame' });
      return;
    }
    chrome.scripting
      .executeScript({ target: { tabId, frameIds: [sender.frameId] }, files: ['/capture.js'] })
      .then(
        () => reply({ ok: true }),
        (e: unknown) => reply({ ok: false, error: String((e as Error)?.message ?? e) }),
      );
    return true;
  });
});
