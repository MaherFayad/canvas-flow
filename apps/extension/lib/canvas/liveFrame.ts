import { frameKey } from '@flowcanvas/config';
import { useUi } from '@/store/ui';
import type { FrameHost, FrameInfo } from './frameHost';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a frame stays forced live after a request needed it. */
const RELEASE_MS = 4000;

/**
 * A connected (nonce'd) frame for screen:state. If none is live, the frame is
 * forced live (Canvas mode keeps forced frames live) until it hands-shakes.
 */
export async function liveFrame(host: FrameHost, screen: string, state: string, timeoutMs = 8000, needReady = true): Promise<FrameInfo | null> {
  const pick = () => host.framesFor(screen, state).find((f) => f.nonce && f.iframe && (!needReady || f.ready)) ?? null;
  const hit = pick();
  if (hit) return hit;
  const key = frameKey(screen, state);
  const wasForced = useUi.getState().forced.has(key);
  if (!wasForced) useUi.getState().force(key, true);
  try {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const f = pick();
      if (f) return f;
      await sleep(120);
    }
    return null;
  } finally {
    if (!wasForced) setTimeout(() => useUi.getState().force(key, false), RELEASE_MS);
  }
}
