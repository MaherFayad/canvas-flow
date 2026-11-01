#!/usr/bin/env node
/**
 * Bundle budget check (docs/BUILD_PLAN.md "Performance budget").
 *
 *   pnpm -r build && pnpm size
 *
 * Reads built output only (no build here):
 *   - apps/extension/.output/chrome-mv3/content-scripts/{bridge,mock}.js
 *   - apps/extension/.output/chrome-mv3/discover.js (MAIN-world discovery helper, injected on demand)
 *   - packages/sdk/dist/index.js (core, ESM)
 *   - the whole unpacked extension, zipped in memory (deflate, level 9) the
 *     way the store upload is built, so the number is the real zip size.
 *
 * Exits 1 when any measure is over budget or zod leaked into a content
 * script or the SDK core. `--json` prints machine-readable results.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'apps/extension/.output/chrome-mv3');
const sdkCore = path.join(root, 'packages/sdk/dist/index.js');

const KB = 1024;
/** Budgets. `gzip` budgets apply to the gzipped size, `raw` to bytes on disk. */
const BUDGETS = [
  { name: 'bridge.js', file: path.join(ext, 'content-scripts/bridge.js'), raw: 15 * KB, noZod: true },
  { name: 'mock.js', file: path.join(ext, 'content-scripts/mock.js'), raw: 15 * KB, noZod: true },
  { name: 'discover.js', file: path.join(ext, 'discover.js'), raw: 20 * KB, noZod: true },
  { name: 'sdk core (index.js)', file: sdkCore, gzip: 2 * KB, noZod: true },
];
const ZIP_BUDGET = 1.5 * KB * KB;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Exact size of a zip archive holding `files` with raw deflate (level 9), no zip64, no extras. */
function zipSize(dir) {
  let size = 22; // end of central directory
  let raw = 0;
  for (const f of walk(dir)) {
    const name = Buffer.byteLength(path.relative(dir, f).split(path.sep).join('/'));
    const buf = readFileSync(f);
    raw += buf.length;
    const data = Math.min(deflateRawSync(buf, { level: 9 }).length, buf.length); // stored if deflate does not help
    size += 30 + name + data; // local header + data
    size += 46 + name; // central directory entry
  }
  return { zip: size, raw };
}

const fmt = (n) => (n >= KB * KB ? `${(n / KB / KB).toFixed(2)} MB` : `${(n / KB).toFixed(2)} KB`);
const rows = [];
let fail = false;

for (const b of BUDGETS) {
  if (!existsSync(b.file)) {
    console.error(`missing ${path.relative(root, b.file)}: build first (pnpm -r build)`);
    process.exit(2);
  }
  const buf = readFileSync(b.file);
  const gz = gzipSync(buf, { level: 9 }).length;
  const over = (b.raw && buf.length > b.raw) || (b.gzip && gz > b.gzip);
  const zod = b.noZod && /ZodError|ZodType|zod\b/.test(buf.toString('utf8'));
  if (over || zod) fail = true;
  rows.push({
    name: b.name,
    raw: buf.length,
    gzip: gz,
    budget: b.raw ? `${fmt(b.raw)} raw` : `${fmt(b.gzip)} gzip`,
    ok: !over && !zod,
    note: zod ? 'zod leaked in' : '',
  });
}

if (!existsSync(path.join(ext, 'manifest.json'))) {
  console.error('missing apps/extension/.output/chrome-mv3: build first');
  process.exit(2);
}
const z = zipSize(ext);
const zipOver = z.zip > ZIP_BUDGET;
if (zipOver) fail = true;
rows.push({ name: 'extension (zip)', raw: z.raw, gzip: z.zip, budget: `${fmt(ZIP_BUDGET)} zip`, ok: !zipOver, note: '' });

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log('measure                   raw         gzip/zip    budget          ');
  for (const r of rows) {
    console.log(
      `${r.ok ? 'ok  ' : 'OVER'} ${r.name.padEnd(20)} ${fmt(r.raw).padStart(10)}  ${fmt(r.gzip).padStart(10)}   ${r.budget}${r.note ? '  ' + r.note : ''}`,
    );
  }
}
if (fail) {
  console.error('size check failed: over budget');
  process.exit(1);
}
