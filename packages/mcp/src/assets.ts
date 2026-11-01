/**
 * Image assets: copy a local file or download a URL into
 * <project>/.flowcanvas/assets/<sha256-prefix>.<ext> (hash name, stored once).
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ASSETS_DIR } from '@flowcanvas/config';
import { ToolError } from './log.js';

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const HASH_LEN = 12;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export function mimeForFile(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  return MIME_BY_EXT[ext === 'jpeg' ? 'jpg' : ext] ?? 'application/octet-stream';
}

/** Sniff the image type from its bytes. */
export function sniffExt(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const head = buf.subarray(0, 1024).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

/** Pixel size of a PNG, GIF, JPEG, WebP or SVG (from width/height or viewBox). */
export function imageSize(buf: Buffer, ext: string): { w: number; h: number } | null {
  try {
    switch (ext) {
      case 'png':
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      case 'gif':
        return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
      case 'webp': {
        const chunk = buf.subarray(12, 16).toString('latin1');
        if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
        if (chunk === 'VP8L') {
          const b = buf.readUInt32LE(21);
          return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
        }
        if (chunk === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
        return null;
      }
      case 'jpg': {
        let i = 2;
        while (i + 9 < buf.length) {
          if (buf[i] !== 0xff) return null;
          const marker = buf[i + 1]!;
          const len = buf.readUInt16BE(i + 2);
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
          }
          i += 2 + len;
        }
        return null;
      }
      case 'svg': {
        const tag = /<svg[^>]*>/i.exec(buf.toString('utf8'))?.[0] ?? '';
        const num = (name: string) => {
          const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag);
          return m ? Number(m[1]) : null;
        };
        const w = num('width');
        const h = num('height');
        if (w && h) return { w, h };
        const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
        if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface StoredAsset {
  /** Path relative to the project root, POSIX separators. */
  file: string;
  ext: string;
  bytes: number;
  size: { w: number; h: number } | null;
  /** False when an identical file was already stored. */
  created: boolean;
}

export async function storeAsset(projectDir: string, buf: Buffer): Promise<StoredAsset> {
  if (buf.length === 0) throw new ToolError('The image is empty.');
  if (buf.length > MAX_IMAGE_BYTES) throw new ToolError(`The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  const ext = sniffExt(buf);
  if (!ext) throw new ToolError('Not a supported image. Use PNG, JPG, WebP, GIF or SVG.');
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, HASH_LEN);
  const rel = `${ASSETS_DIR}/${hash}.${ext}`;
  const abs = path.join(projectDir, ...rel.split('/'));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  let created = false;
  try {
    await fs.writeFile(abs, buf, { flag: 'wx' });
    created = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  return { file: rel, ext, bytes: buf.length, size: imageSize(buf, ext), created };
}

export async function readLocalImage(projectDir: string, p: string): Promise<Buffer> {
  const abs = path.resolve(projectDir, p);
  const st = await fs.stat(abs).catch(() => null);
  if (!st || !st.isFile()) throw new ToolError(`No file at ${abs}.`);
  if (st.size > MAX_IMAGE_BYTES) throw new ToolError(`The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  return fs.readFile(abs);
}

export async function downloadImage(url: string, timeoutMs = 20_000): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ToolError(`Not a valid URL: ${url}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ToolError('Only http and https image URLs are supported.');
  const res = await fetch(u, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' }).catch((e: Error) => {
    throw new ToolError(`Could not download ${url}: ${e.message}`);
  });
  if (!res.ok) throw new ToolError(`Could not download ${url}: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_IMAGE_BYTES) throw new ToolError(`The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

/**
 * Read a stored asset for the canvas. Only files directly under .flowcanvas/assets/
 * (no traversal, no other folders) can be read.
 */
export async function readAsset(projectDir: string, file: string): Promise<{ data: Buffer; mime: string }> {
  const rel = file.replace(/\\/g, '/');
  if (!rel.startsWith(`${ASSETS_DIR}/`) || rel.slice(ASSETS_DIR.length + 1).includes('/') || rel.includes('..')) {
    throw new ToolError(`Only files in ${ASSETS_DIR}/ can be read.`);
  }
  const abs = path.join(projectDir, ...rel.split('/'));
  const st = await fs.stat(abs).catch(() => null);
  if (!st || !st.isFile()) throw new ToolError(`No asset at ${rel}.`);
  if (st.size > MAX_IMAGE_BYTES) throw new ToolError(`The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  return { data: await fs.readFile(abs), mime: mimeForFile(rel) };
}
