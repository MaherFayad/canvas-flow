import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startDiscover } from '@/lib/main/discover';

/**
 * Discovery helper (router sniffing, link-like clickables, safe probe clicks),
 * injected on demand into one canvas frame's MAIN world by the background
 * (chrome.scripting.executeScript) when its bridge gets the first discovery
 * probe. Never a content script, never web-accessible, never in normal tabs.
 */
export default defineUnlistedScript(() => {
  startDiscover(window);
});
