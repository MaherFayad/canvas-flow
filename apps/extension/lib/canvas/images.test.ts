import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, MAX_LONG_SIDE, assetFileFor, canvasSize, downscaleSize, extForMime, fromBase64, lockRatio, newImage, toBase64 } from './images';

describe('image downscale math (> 5 MB → 2560 px long side, WebP)', () => {
  it('leaves images at or under 5 MB alone, whatever their size', () => {
    expect(downscaleSize(8000, 6000, MAX_IMAGE_BYTES)).toEqual({ w: 8000, h: 6000, scale: 1, reencode: false });
  });
  it('scales the long side to 2560 and keeps the ratio (landscape and portrait)', () => {
    expect(downscaleSize(5120, 2880, MAX_IMAGE_BYTES + 1)).toEqual({ w: 2560, h: 1440, scale: 0.5, reencode: true });
    const p = downscaleSize(1320, 2868, 9e6);
    expect(p.h).toBe(MAX_LONG_SIDE);
    expect(p.w).toBe(Math.round(1320 * (2560 / 2868)));
    expect(p.reencode).toBe(true);
  });
  it('a heavy image that already fits is re-encoded to WebP without upscaling', () => {
    expect(downscaleSize(2000, 1000, 6e6)).toEqual({ w: 2000, h: 1000, scale: 1, reencode: true });
  });
  it('never rasterises SVG and never returns 0 px', () => {
    expect(downscaleSize(100000, 10, 9e6, 'image/svg+xml').reencode).toBe(false);
    expect(downscaleSize(100000, 10, 9e6).h).toBe(1);
  });
  it('canvas size caps the long side; ratio lock follows the side that changed most', () => {
    expect(canvasSize(1320, 2868)).toEqual({ w: 442, h: 960 });
    expect(canvasSize(300, 200)).toEqual({ w: 300, h: 200 });
    expect(lockRatio({ w: 400, h: 200 }, { w: 600, h: 200 })).toEqual({ w: 600, h: 300 });
    expect(lockRatio({ w: 400, h: 200 }, { w: 400, h: 100 })).toEqual({ w: 200, h: 100 });
  });
});

describe('asset names match the MCP server', () => {
  it('.flowcanvas/assets/<sha256 first 12>.<ext>', async () => {
    const bytes = new TextEncoder().encode('fake image bytes');
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    expect(await assetFileFor(bytes, 'image/webp')).toBe(`.flowcanvas/assets/${hash}.webp`);
    expect(await assetFileFor(bytes, 'image/jpeg')).toBe(`.flowcanvas/assets/${hash}.jpg`);
    expect(extForMime('image/svg+xml')).toBe('svg');
    expect(extForMime('application/pdf')).toBeNull();
  });
  it('base64 round-trips large buffers', () => {
    const a = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(fromBase64(toBase64(a))).toEqual(a);
  });
  it('new images are unscaled, opaque, not overlaid', () => {
    expect(newImage({ file: 'f', at: { x: 1.4, y: 2.6 }, size: { w: 10, h: 20 } })).toMatchObject({ file: 'f', rect: { x: 1, y: 3, w: 10, h: 20 }, crop: null, opacity: 1, overlay: null, section: null });
  });
});
