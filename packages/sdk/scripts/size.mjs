// Gzipped size of each built entry. Fails if the core is over 2 KB.
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LIMIT = 2048;
const dist = new URL('../dist/', import.meta.url);
let fail = false;
for (const f of readdirSync(dist).filter((f) => /\.(js|cjs)$/.test(f)).sort()) {
  const buf = readFileSync(new URL(f, dist));
  const gz = gzipSync(buf, { level: 9 }).length;
  const core = f === 'index.js' || f === 'index.cjs';
  if (core && gz > LIMIT) fail = true;
  console.log(`${f.padEnd(12)} ${String(buf.length).padStart(6)} B  ${String(gz).padStart(5)} B gzip${core ? `  (limit ${LIMIT})` : ''}`);
}
const bundled = readFileSync(new URL('index.js', dist), 'utf8');
if (/zod|ZodError/.test(bundled)) {
  console.error('zod leaked into the core bundle');
  fail = true;
}
if (fail) {
  console.error('size check failed');
  process.exit(1);
}
