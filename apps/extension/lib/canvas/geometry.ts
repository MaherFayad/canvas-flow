/**
 * Canvas geometry. Screen positions in the config are stored in "reference
 * units": pixels for the reference device (iPhone 16 Pro Max slot). Rendering
 * scales them by the current device's slot size, so switching Mobile/Desktop
 * re-lays every frame without overlaps and without rewriting the config.
 */
import { DEVICE_PRESETS, type Device } from '@flowcanvas/config';

export const HEADER_H = 30;
export const GAP_X = 200;
export const GAP_Y = 80;
export const SECTION_PAD = 0;
export const SECTION_TITLE_H = 64;

export const REF_DEVICE: Device = DEVICE_PRESETS[0]!;

export interface Insets {
  top: number;
  bottom: number;
  side: number;
}

/** Space the canvas draws around the iframe for device chrome. */
export function chromeInsets(d: Pick<Device, 'chrome'>): Insets {
  // Light device shell like the reference: status bar above, home bar below, no thick bezel.
  if (d.chrome === 'ios') return { top: 50, bottom: 28, side: 0 };
  if (d.chrome === 'android') return { top: 32, bottom: 24, side: 0 };
  return { top: 0, bottom: 0, side: 0 };
}

/** Outer size of a frame node: header + chrome + iframe at the real CSS size. */
export function frameOuter(d: Device): { w: number; h: number } {
  const i = chromeInsets(d);
  return { w: d.w + 2 * i.side, h: HEADER_H + i.top + d.h + i.bottom + 2 * i.side };
}

export function slot(d: Device): { w: number; h: number } {
  const o = frameOuter(d);
  return { w: o.w + GAP_X, h: o.h + GAP_Y };
}

export const REF_SLOT = slot(REF_DEVICE);

export function toRender(p: { x: number; y: number }, d: Device): { x: number; y: number } {
  const s = slot(d);
  return { x: (p.x * s.w) / REF_SLOT.w, y: (p.y * s.h) / REF_SLOT.h };
}

export function toRef(p: { x: number; y: number }, d: Device): { x: number; y: number } {
  const s = slot(d);
  return { x: Math.round((p.x * REF_SLOT.w) / s.w), y: Math.round((p.y * REF_SLOT.h) / s.h) };
}
