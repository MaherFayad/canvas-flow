#!/usr/bin/env node
/**
 * flowcanvas-mcp --project <dir> [--extension-id <id>] [--origin <url>]
 * stdout carries MCP over stdio; logs go to stderr.
 */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFlowCanvasServer, SERVER_VERSION } from './server.js';
import { stderrLogger } from './log.js';

const HELP = `flowcanvas-mcp ${SERVER_VERSION}
Local MCP server that lets Claude read and edit a Flow Canvas project.

Usage:
  flowcanvas-mcp --project <dir> [--extension-id <id>] [--origin <url>]

Options:
  --project <dir>        Project folder holding flowcanvas.config.json (default: current folder)
  --extension-id <id>    Only accept the canvas from chrome-extension://<id>
  --origin <url>         App origin for a new config (default http://localhost:5173)
  --no-link              Do not open the canvas WebSocket link
  -h, --help             Show this help
  -v, --version          Show the version
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string', short: 'p' },
      'extension-id': { type: 'string' },
      origin: { type: 'string' },
      'no-link': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    strict: true,
  });
  if (values.help) {
    process.stderr.write(HELP);
    return;
  }
  if (values.version) {
    process.stderr.write(`${SERVER_VERSION}\n`);
    return;
  }
  const log = stderrLogger();
  if (values.origin) {
    try {
      new URL(values.origin);
    } catch {
      log.error(`--origin is not a valid URL: ${values.origin}`);
      process.exit(2);
    }
  }
  const projectDir = path.resolve(values.project ?? process.cwd());
  if (!values.project) log.warn(`no --project given; using ${projectDir}`);

  const server = createFlowCanvasServer({
    projectDir,
    origin: values.origin,
    extensionId: values['extension-id'],
    link: !values['no-link'],
    log,
  });
  await server.start();
  const transport = new StdioServerTransport();
  await server.mcp.connect(transport);
  log.info(`ready: ${projectDir}`);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('close', shutdown);
}

main().catch((e) => {
  process.stderr.write(`[flowcanvas-mcp] fatal: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
