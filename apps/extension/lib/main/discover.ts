/**
 * Discovery helper, MAIN world. Injected by the background into one canvas
 * frame when its bridge gets the first discovery probe (links, routes,
 * clickables, click-probe); answers them over the in-page channel. Installs
 * once per page; passive outside canvas frames; never writes to the app.
 */
import { BRIDGE_TO_MAIN_EVENT, MAIN_EVENT, emitInPage, onInPage, type BridgeToMain, type MainToBridge } from '@flowcanvas/protocol/lite';
import { frameIdentity } from '../frame';
import { isDiscoveryFrame } from './guard';
import { handleProbe } from './probe';

const FLAG = '__fcDiscover';

export function startDiscover(win: Window): boolean {
  const id = frameIdentity(win);
  const w = win as unknown as Record<string, unknown>;
  if (!id || w[FLAG]) return false;
  try {
    Object.defineProperty(w, FLAG, { value: true });
  } catch {
    return false;
  }
  const discovery = isDiscoveryFrame(id.frame);
  onInPage<BridgeToMain>(
    BRIDGE_TO_MAIN_EVENT,
    (m) => {
      if (m.type === 'probe') handleProbe(win, m.m, discovery, (r) => emitInPage(MAIN_EVENT, { type: 'probe-result', m: r } satisfies MainToBridge, win));
    },
    win,
  );
  return true;
}
