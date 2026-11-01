/**
 * Images on the canvas (feature 9): drop, paste, URL. Blobs live in
 * IndexedDB (idb-keyval), keyed by their project file name
 * `.flowcanvas/assets/<sha256-12>.<ext>` — the same name the MCP server
 * writes, so a linked canvas and the repo agree. Images over 5 MB are scaled
 * to 2560 px on the long side, WebP.
 */
import { ASSETS_DIR, id as newId, type CanvasImage } from '@flowcanvas/config';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_LONG_SIDE = 2560;
/** Default on-canvas size: long side at most this many canvas px. */
export const DEFAULT_LONG_SIDE = 960;
export const OVERLAY_OPACITY = 0.5;

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export function extForMime(mime: string): string | null {
  return EXT[mime.toLowerCase().split(';')[0]!.trim()] ?? null;
}

export function isImageMime(mime: string): boolean {
  return extForMime(mime) !== null;
}

/**
 * Target pixel size: unchanged unless the file is over 5 MB, then the long
 * side becomes at most 2560 px (aspect kept). SVG is never rasterised.
 */
export function downscaleSize(w: number, h: number, bytes: number, mime = 'image/png'): { w: number; h: number; scale: number; reencode: boolean } {
  const svg = extForMime(mime) === 'svg';
  if (svg || bytes <= MAX_IMAGE_BYTES || w <= 0 || h <= 0) return { w, h, scale: 1, reencode: false };
  const long = Math.max(w, h);
  const scale = Math.min(1, MAX_LONG_SIDE / long);
  // Over 5 MB always re-encodes to WebP, even when the long side already fits.
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), scale, reencode: true };
}

/** Size on the canvas: natural size, long side capped. */
export function canvasSize(w: number, h: number, cap = DEFAULT_LONG_SIDE): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 400, h: 300 };
  const k = Math.min(1, cap / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** Keep the aspect ratio when one side changes. */
export function lockRatio(prev: { w: number; h: number }, next: { w: number; h: number }): { w: number; h: number } {
  if (prev.w <= 0 || prev.h <= 0) return next;
  const r = prev.w / prev.h;
  const dw = Math.abs(next.w - prev.w) / prev.w;
  const dh = Math.abs(next.h - prev.h) / prev.h;
  return dw >= dh ? { w: Math.round(next.w), h: Math.round(next.w / r) } : { w: Math.round(next.h * r), h: Math.round(next.h) };
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `.flowcanvas/assets/<sha256-12>.<ext>` — same rule as the MCP server's storeAsset. */
export async function assetFileFor(bytes: ArrayBuffer | Uint8Array, mime: string): Promise<string> {
  const ext = extForMime(mime) ?? 'png';
  return `${ASSETS_DIR}/${(await sha256Hex(bytes)).slice(0, 12)}.${ext}`;
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function newImage(input: { file?: string; url?: string; at: { x: number; y: number }; size: { w: number; h: number }; caption?: string; section?: string | null }): CanvasImage {
  return {
    id: newId('img'),
    ...(input.file ? { file: input.file } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.caption ? { caption: input.caption } : {}),
    rect: { x: Math.round(input.at.x), y: Math.round(input.at.y), ...input.size },
    crop: null,
    opacity: 1,
    overlay: null,
    section: input.section ?? null,
  };
}

/* ---------------------- browser-only helpers ---------------------- */

export interface PreparedImage {
  blob: Blob;
  mime: string;
  w: number;
  h: number;
  file: string;
}

async function naturalSize(blob: Blob): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const s = { w: bmp.width, h: bmp.height };
    bmp.close();
    return s;
  } catch {
    // SVG (and some others) cannot be bitmapped from a blob: use an <img>.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { w: img.naturalWidth || 400, h: img.naturalHeight || 300 };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Read, measure and (over 5 MB) downscale to WebP. */
export async function prepareImage(input: Blob): Promise<PreparedImage> {
  const mime = input.type || 'image/png';
  if (!isImageMime(mime)) throw new Error('Not a supported image. Use PNG, JPG, WebP, GIF or SVG.');
  const nat = await naturalSize(input);
  const t = downscaleSize(nat.w, nat.h, input.size, mime);
  let blob = input;
  let outMime = mime;
  if (t.reencode) {
    const bmp = await createImageBitmap(input, { resizeWidth: t.w, resizeHeight: t.h, resizeQuality: 'high' });
    const canvas = new OffscreenCanvas(t.w, t.h);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
    outMime = 'image/webp';
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob, mime: outMime, w: t.w, h: t.h, file: await assetFileFor(bytes, outMime) };
}

let storePromise: Promise<typeof import('idb-keyval')> | null = null;
const idb = () => (storePromise ??= import('idb-keyval'));
let customStore: ReturnType<(typeof import('idb-keyval'))['createStore']> | null = null;
async function store() {
  const m = await idb();
  customStore ??= m.createStore('flowcanvas-images', 'blobs');
  return { m, s: customStore };
}

export async function putBlob(file: string, blob: Blob): Promise<void> {
  const { m, s } = await store();
  await m.set(file, blob, s);
}

export async function getBlob(file: string): Promise<Blob | undefined> {
  const { m, s } = await store();
  return (await m.get(file, s)) as Blob | undefined;
}

/** Object URLs per file, shared by every node showing that file. */
const urls = new Map<string, string>();
export function cachedUrl(file: string): string | undefined {
  return urls.get(file);
}
export function rememberUrl(file: string, blob: Blob): string {
  const u = urls.get(file) ?? URL.createObjectURL(blob);
  urls.set(file, u);
  return u;
}
