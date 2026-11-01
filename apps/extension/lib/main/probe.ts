/**
 * Discovery probes answered in the MAIN world (the bridge only relays them,
 * which keeps bridge.js small): links, router sniff, clickables, and one safe
 * click per request in hidden discovery frames.
 */
import type { ProbeRequest, ProbeResult } from '@flowcanvas/protocol/lite';
import { cleanPath, collectLinks } from '../url';
import { unsafeReason } from '../routes/safety';
import { candidates, clickInfo, labelOf, listClickables } from './clickables';
import { sniffRoutes } from './sniff';

/** How long to wait for the URL to change after a probe click. */
export const CLICK_SETTLE_MS = 900;

export function handleProbe(win: Window, m: ProbeRequest, discovery: boolean, reply: (r: ProbeResult) => void, settleMs = CLICK_SETTLE_MS): void {
  const doc = win.document;
  const here = () => cleanPath(win.location.href);
  try {
    switch (m.fc) {
      case 'links':
        reply({ fc: 'links-result', id: m.id, links: collectLinks(doc) });
        return;
      case 'routes': {
        const r = sniffRoutes(win);
        reply({ fc: 'routes-result', id: m.id, framework: r.framework, routes: r.routes, ...(r.meta ? { meta: r.meta } : {}) });
        return;
      }
      case 'clickables':
        reply({ fc: 'clickables-result', id: m.id, items: listClickables(doc) });
        return;
      case 'click-probe': {
        const el = discovery ? candidates(doc)[m.index] : undefined;
        // Re-check here: the canvas asks, but the page decides nothing unsafe is clicked.
        if (!el || labelOf(el) !== m.label || unsafeReason(clickInfo(el))) {
          reply({ fc: 'click-probe-result', id: m.id, ok: false, url: here() });
          return;
        }
        const before = win.location.href;
        try {
          (el as HTMLElement).click();
        } catch {
          /* the app threw in its handler: still report where we are */
        }
        const start = Date.now();
        const tick = () => {
          if (win.location.href !== before || Date.now() - start >= settleMs) reply({ fc: 'click-probe-result', id: m.id, ok: true, url: here() });
          else setTimeout(tick, 50);
        };
        setTimeout(tick, 50);
        return;
      }
      default:
        return;
    }
  } catch {
    /* never break the page */
  }
}
