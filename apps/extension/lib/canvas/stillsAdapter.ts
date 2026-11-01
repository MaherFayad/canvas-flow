/**
 * Stills for `get_screenshot` requests from Claude.
 *
 * Order: the cached still from the capture engine, then a fresh capture
 * (`captureNow` jumps the queue), then a direct `capture` request to the live
 * frame's bridge. `stillFor` normalises the result to a data URL.
 */
import type { MessageOf } from '@flowcanvas/protocol';
import type { FrameHost } from './frameHost';
import { liveFrame } from './liveFrame';
import { captureNow, getStill as cachedStill } from './capture';

let host: FrameHost | null = null;
export function setStillsHost(h: FrameHost | null): void {
  host = h;
}

export async function fallbackGetStill(screenId: string, state: string, _deviceId?: string): Promise<string> {
  if (!host) throw new Error('No canvas frames are available.');
  const f = await liveFrame(host, screenId, state);
  if (!f) throw new Error(`The ${screenId} · ${state} frame is not live. Scroll to it in Canvas mode, or open its section.`);
  const r = await host.request<MessageOf<'capture-result'>>(f.frameId, { fc: 'capture', id: '', scale: 0.5, quality: 0.8 }, 15_000);
  if (!r) throw new Error(`The ${screenId} · ${state} frame did not answer the capture.`);
  if (!r.webp) throw new Error(r.error ?? 'The frame could not take a screenshot.');
  return r.webp;
}

async function getStill(screenId: string, state: string, deviceId: string): Promise<unknown> {
  const cached = await cachedStill(screenId, state, deviceId).catch(() => null);
  if (cached) return cached;
  const fresh = await captureNow(screenId, state, deviceId).catch(() => null);
  if (fresh) return fresh;
  return fallbackGetStill(screenId, state, deviceId);
}

async function blobToDataUrl(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${b.type || 'image/webp'};base64,${btoa(s)}`;
}

/** WebP still (data URL) for screen:state on device. */
export async function stillFor(screenId: string, state: string, deviceId: string): Promise<{ webp: string; device: string }> {
  const r = await getStill(screenId, state, deviceId);
  let webp: string | null = null;
  if (typeof r === 'string') webp = r;
  else if (r instanceof Blob) webp = await blobToDataUrl(r);
  else if (r && typeof r === 'object') {
    const o = r as { webp?: unknown; dataUrl?: unknown; blob?: unknown };
    if (typeof o.webp === 'string') webp = o.webp;
    else if (typeof o.dataUrl === 'string') webp = o.dataUrl;
    else if (o.blob instanceof Blob) webp = await blobToDataUrl(o.blob);
  }
  if (!webp) throw new Error(`No still for ${screenId} · ${state} yet.`);
  return { webp, device: deviceId };
}
