import { execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tmpProject } from './helpers.js';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const BIN = path.join(PKG, 'dist', 'cli.js');

describe('built bin over stdio', () => {
  let dir: string;
  beforeAll(async () => {
    if (!existsSync(BIN)) execFileSync('pnpm', ['exec', 'tsup'], { cwd: PKG, stdio: 'ignore' });
    dir = await tmpProject();
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts flowcanvas-mcp and answers get_project', async () => {
    const head = await fs.readFile(BIN, 'utf8');
    expect(head.startsWith('#!/usr/bin/env node')).toBe(true);
    const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, '--project', dir, '--no-link'], stderr: 'pipe' });
    const client = new Client({ name: 'e2e', version: '1.0.0' });
    await client.connect(transport);
    try {
      const r = await client.callTool({ name: 'get_project', arguments: {} });
      const content = r.content as { type: string; text: string }[];
      const p = JSON.parse(content[0]!.text);
      expect(p.name).toBe('Helka ceramics');
      expect(p.counts.screens).toBe(4);
    } finally {
      await client.close();
    }
  });
});
