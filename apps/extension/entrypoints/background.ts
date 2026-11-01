import { defineBackground } from 'wxt/utils/define-background';
import { isLocalOrigin } from '@/lib/origin';

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
});
