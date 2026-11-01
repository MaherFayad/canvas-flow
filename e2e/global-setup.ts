import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EXT_DIR, ROOT } from './fixtures/paths';

/** Build the unpacked extension once per run (skip with E2E_SKIP_BUILD=1 when CI already built it). */
export default function globalSetup() {
  const built = fs.existsSync(path.join(EXT_DIR, 'manifest.json'));
  if (process.env.E2E_SKIP_BUILD === '1' && built) return;
  execSync('pnpm --filter @flowcanvas/extension build', { cwd: ROOT, stdio: 'inherit' });
}
