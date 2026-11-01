import { readFrameParams } from '@flowcanvas/protocol';

/** window.name prefix: keeps the frame id across full-page navigations inside the iframe. */
export const WINDOW_NAME_PREFIX = 'fc-frame:';

export interface FrameIdentity {
  frame: string;
  state: string;
}

/** Active only inside an iframe whose URL has fc-frame (or whose window.name carries it after an MPA navigation). */
export function frameIdentity(win: Window): FrameIdentity | null {
  let inFrame: boolean;
  try {
    inFrame = win.top !== win;
  } catch {
    inFrame = true;
  }
  if (!inFrame) return null;
  const p = readFrameParams(win.location.search);
  if (p.frame) return { frame: p.frame, state: p.state };
  if (win.name.startsWith(WINDOW_NAME_PREFIX)) {
    return { frame: win.name.slice(WINDOW_NAME_PREFIX.length), state: 'default' };
  }
  return null;
}

