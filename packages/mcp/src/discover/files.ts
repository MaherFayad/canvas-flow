/**
 * File walking for route discovery: skips dependencies, build output and
 * VCS folders; flags test files so route scanners can ignore them while
 * sample-value search can still read fixtures.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.astro',
  '.vercel',
  '.netlify',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  '.expo',
  '.wxt',
  '.flowcanvas',
  'coverage',
  'storybook-static',
  '.storybook',
  'vendor',
  'tmp',
  '.idea',
  '.vscode',
]);

const TEST_DIRS = new Set(['__tests__', 'test', 'tests', 'e2e', 'cypress', 'playwright', '__snapshots__']);
const TEST_FILE = /\.(test|spec|stories|story|e2e|cy)\.[cm]?[jt]sx?$/;

export interface WalkedFile {
  /** Posix path relative to the walk root. */
  rel: string;
  abs: string;
  /** Inside a test folder or a test / story file. */
  test: boolean;
  size: number;
}

export interface WalkOptions {
  maxFiles?: number;
  maxDepth?: number;
}

export async function walk(root: string, opts: WalkOptions = {}): Promise<WalkedFile[]> {
  const maxFiles = opts.maxFiles ?? 20_000;
  const maxDepth = opts.maxDepth ?? 14;
  const out: WalkedFile[] = [];
  const visit = async (dir: string, rel: string, depth: number, inTest: boolean): Promise<void> => {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        await visit(abs, r, depth + 1, inTest || TEST_DIRS.has(e.name));
      } else if (e.isFile()) {
        const size = await fs.stat(abs).then(
          (s) => s.size,
          () => -1,
        );
        if (size < 0) continue;
        out.push({ rel: r, abs, test: inTest || TEST_FILE.test(e.name), size });
      }
    }
  };
  await visit(root, '', 0, false);
  return out;
}

const cache = new Map<string, string | null>();

/** Read a text file (≤ 1 MB), null when unreadable. Cached per scan via `clearReadCache`. */
export async function readText(abs: string, max = 1024 * 1024): Promise<string | null> {
  if (cache.has(abs)) return cache.get(abs)!;
  let t: string | null = null;
  try {
    const st = await fs.stat(abs);
    if (st.size <= max) t = await fs.readFile(abs, 'utf8');
  } catch {
    t = null;
  }
  cache.set(abs, t);
  return t;
}

export function clearReadCache(): void {
  cache.clear();
}

/** 1-based line of a character offset. */
export function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
