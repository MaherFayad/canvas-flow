#!/usr/bin/env node
/**
 * Generate docs/mcp-tools.md from the real MCP server: starts it in memory
 * (no canvas link), lists tools and resources through an MCP client, and
 * writes their names, descriptions, hints and input fields.
 *
 *   pnpm --filter @flowcanvas/mcp build && pnpm docs:mcp
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mcpDir = path.join(root, 'packages/mcp');
const req = createRequire(path.join(mcpDir, 'package.json'));
const imp = (spec) => import(pathToFileURL(req.resolve(spec)).href);

const { createFlowCanvasServer, SERVER_VERSION } = await import(pathToFileURL(path.join(mcpDir, 'dist/index.js')).href);
const { Client } = await imp('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await imp('@modelcontextprotocol/sdk/inMemory.js');

const dir = mkdtempSync(path.join(os.tmpdir(), 'fc-mcp-docs-'));
const server = createFlowCanvasServer({ projectDir: dir, link: false });
await server.start();
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'docs', version: '1.0.0' });
await Promise.all([server.mcp.connect(st), client.connect(ct)]);
const { tools } = await client.listTools();
const { resources } = await client.listResources().catch(() => ({ resources: [] }));
const { resourceTemplates } = await client.listResourceTemplates().catch(() => ({ resourceTemplates: [] }));
await client.close();
await server.stop?.();
rmSync(dir, { recursive: true, force: true });

const CANVAS = new Set(['get_tokens', 'set_tokens', 'get_screenshot', 'check_target', 'play_flow', 'focus', 'get_selection']);
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');

let rootSchema = {};
const deref = (s) => {
  if (!s?.$ref?.startsWith('#/')) return s;
  return s.$ref.slice(2).split('/').reduce((o, k) => o?.[decodeURIComponent(k)], rootSchema);
};
const firstSentence = (d) => esc(d).split(/(?<!e\.g|i\.e)\.\s+(?=[A-Z])/)[0].replace(/\.$/, '');

function typeOf(s) {
  s = deref(s);
  if (!s) return 'any';
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' \\| ');
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.anyOf) return s.anyOf.map(typeOf).join(' \\| ');
  if (s.type === 'array') return `${typeOf(s.items)}[]`;
  if (s.type === 'object') return s.properties ? `{ ${Object.keys(s.properties).join(', ')} }` : 'object';
  return Array.isArray(s.type) ? s.type.join(' \\| ') : (s.type ?? 'any');
}

const out = [
  '# MCP tools reference',
  '',
  `Generated from \`@flowcanvas/mcp\` ${SERVER_VERSION} by \`scripts/gen-mcp-docs.mjs\` (do not edit by hand). Setup: [getting started](./getting-started.md#4-connect-claude-optional).`,
  '',
  `${tools.length} tools. "Canvas" means the Flow Canvas tab must be open and linked; every other tool works on \`flowcanvas.config.json\` alone. While **Pause Claude** is on, write tools fail. \`delete_items\` and \`set_tokens\` with more than 10 variables ask for Allow on the canvas when it is open.`,
  '',
  '| Tool | Needs canvas | Kind | What it does |',
  '| --- | --- | --- | --- |',
];
for (const t of tools) {
  const kind = t.annotations?.readOnlyHint ? 'read' : t.annotations?.destructiveHint ? 'write (destructive)' : 'write';
  out.push(`| [\`${t.name}\`](#${t.name}) | ${CANVAS.has(t.name) ? 'Yes' : 'No'} | ${kind} | ${firstSentence(t.description)} |`);
}
for (const t of tools) {
  out.push('', `## ${t.name}`, '', esc(t.description), '');
  rootSchema = t.inputSchema ?? {};
  const props = t.inputSchema?.properties ?? {};
  const required = new Set(t.inputSchema?.required ?? []);
  if (!Object.keys(props).length) {
    out.push('Input: none.');
    continue;
  }
  out.push('| Field | Type | Required | Notes |', '| --- | --- | --- | --- |');
  for (const [k, raw] of Object.entries(props)) {
    const s = { ...deref(raw), ...(raw.description ? { description: raw.description } : {}) };
    const notes = [s.description, s.default !== undefined ? `default \`${JSON.stringify(s.default)}\`` : ''].filter(Boolean).join('; ');
    out.push(`| \`${k}\` | ${typeOf(s)} | ${required.has(k) ? 'yes' : ''} | ${esc(notes)} |`);
  }
}
out.push('', '## Resources', '');
for (const r of resources) out.push(`- \`${r.uri}\`: ${esc(r.description ?? r.name)}`);
for (const r of resourceTemplates) out.push(`- \`${r.uriTemplate}\`: ${esc(r.description ?? r.name)}`);
out.push('');

writeFileSync(path.join(root, 'docs/mcp-tools.md'), out.join('\n'));
console.log(`docs/mcp-tools.md: ${tools.length} tools, ${resources.length + resourceTemplates.length} resources`);
process.exit(0);
