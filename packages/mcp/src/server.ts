/**
 * Wires the ProjectStore, the canvas link and the MCP server together.
 */
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { FlowCanvasConfig } from '@flowcanvas/config';
import { CanvasLink } from './link.js';
import { CANVAS_WRITE_DEBOUNCE_MS } from './link-protocol.js';
import { ProjectStore, ValidationError, type StoreChange } from './store.js';
import { registerTools } from './tools.js';
import { COMMENTS_FOR_CLAUDE_URI, COMMENTS_URI, NOTES_URI, PROJECT_URI, registerResources } from './resources.js';
import { silentLogger, type Logger } from './log.js';
import type { ServerContext } from './context.js';

export const SERVER_NAME = 'flowcanvas';
export const SERVER_VERSION = '0.1.0';

export interface FlowCanvasServerOptions {
  projectDir: string;
  /** Origin for a new config (default http://localhost:5173). */
  origin?: string;
  /** Pin the accepted extension id. */
  extensionId?: string;
  /** false disables the WebSocket link entirely (tests). */
  link?: boolean;
  /** Port range for the link (default MCP_PORT_MIN..MCP_PORT_MAX). */
  ports?: [number, number];
  /** Watch the config file for outside edits (default true). */
  watch?: boolean;
  canvasDebounceMs?: number;
  requestTimeoutMs?: number;
  log?: Logger;
}

export interface FlowCanvasServer {
  mcp: McpServer;
  store: ProjectStore;
  link: CanvasLink | null;
  tools: string[];
  /** Load the config, start the watcher and the link. Call before connecting a transport. */
  start(): Promise<void>;
  close(): Promise<void>;
}

const INSTRUCTIONS = `Flow Canvas MCP: read and edit the user's Flow Canvas (a live map of their localhost app's screens, states and flows), stored in flowcanvas.config.json in the project.
- Start with get_project. Screens have kebab-case ids and states; edges connect "<screen>:<state>" pairs.
- Feedback for you: list_comments {status:"open", to:"claude"}. Each comment carries the element under the pin (selector, HTML, styles). Make the change, then reply_comment with what changed and the ids in changes.
- Explain non-obvious changes with add_note (kind "decision" or "issue").
- File-backed tools work with no canvas open. get_tokens, set_tokens, check_target, play_flow, focus and get_selection need the Flow Canvas tab open; get_screenshot falls back to cached stills.
- If a write fails with "paused", the user turned on Pause Claude; stop writing and tell them.`;

export function createFlowCanvasServer(opts: FlowCanvasServerOptions): FlowCanvasServer {
  const log = opts.log ?? silentLogger;
  const projectDir = path.resolve(opts.projectDir);
  const store = new ProjectStore({ projectDir, origin: opts.origin, log });

  const link =
    opts.link === false
      ? null
      : new CanvasLink({
          extensionId: opts.extensionId,
          ports: opts.ports,
          log,
          requestTimeoutMs: opts.requestTimeoutMs,
          hello: () => {
            const c = safeConfig(store);
            return {
              project: projectDir,
              origin: c?.project.origin ?? store.defaultOrigin,
              name: c?.project.name ?? path.basename(projectDir),
              serverVersion: SERVER_VERSION,
            };
          },
        });

  const mcp = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { resources: { subscribe: true, listChanged: true }, tools: {} },
      instructions: INSTRUCTIONS,
    },
  );

  const ctx: ServerContext = { store, link, log, version: SERVER_VERSION };
  const tools = registerTools(mcp, ctx);
  registerResources(mcp, ctx);

  /* ---------------------- resource subscriptions ---------------------- */
  const subscribed = new Set<string>();
  mcp.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    subscribed.add(req.params.uri);
    return {};
  });
  mcp.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    subscribed.delete(req.params.uri);
    return {};
  });

  const notify = (uri: string) => {
    if (!mcp.isConnected()) return;
    mcp.server.sendResourceUpdated({ uri }).catch((e: Error) => log.warn(`resource notification failed: ${e.message}`));
  };

  /* --------------------------- store → world -------------------------- */
  store.on('change', (ch: StoreChange) => {
    // Canvas
    if (link && ch.source !== 'canvas') {
      if (ch.source === 'claude') link.sendIfReady({ type: 'patch', label: `Claude: ${ch.label}`, config: ch.config });
      else link.sendIfReady({ type: 'config', config: ch.config });
    }
    // Resources
    if (subscribed.has(PROJECT_URI)) notify(PROJECT_URI);
    if (subscribed.has(NOTES_URI) && JSON.stringify(ch.prev.notes) !== JSON.stringify(ch.config.notes)) notify(NOTES_URI);
    const commentsChanged = JSON.stringify(ch.prev.comments) !== JSON.stringify(ch.config.comments);
    if (commentsChanged) {
      const openForClaude = ch.config.comments.some((x) => x.status === 'open' && x.to === 'claude');
      const uris = new Set<string>([...subscribed].filter((u) => u.startsWith(COMMENTS_URI)));
      if (openForClaude) {
        uris.add(COMMENTS_URI);
        uris.add(COMMENTS_FOR_CLAUDE_URI);
      }
      for (const u of uris) notify(u);
    }
  });

  /* --------------------------- canvas → file -------------------------- */
  let pendingCanvas: unknown = null;
  let canvasTimer: NodeJS.Timeout | null = null;
  const flushCanvas = async () => {
    canvasTimer = null;
    const raw = pendingCanvas;
    pendingCanvas = null;
    try {
      await store.replace(raw, 'canvas', 'canvas edit');
    } catch (e) {
      const errors = e instanceof ValidationError ? e.details : undefined;
      log.warn(`canvas config rejected: ${(e as Error).message}`);
      link?.send({ type: 'error', message: 'The canvas change was not saved: the config is invalid.', ...(errors ? { errors } : {}) });
    }
  };
  link?.on('config', (raw: unknown) => {
    pendingCanvas = raw;
    if (canvasTimer) clearTimeout(canvasTimer);
    canvasTimer = setTimeout(() => void flushCanvas(), opts.canvasDebounceMs ?? CANVAS_WRITE_DEBOUNCE_MS);
  });
  link?.on('allow', (granted: boolean) => {
    if (!granted) return;
    const c = safeConfig(store);
    if (c) link.send({ type: 'config', config: c });
    else link.send({ type: 'error', message: 'flowcanvas.config.json is invalid; fix it to sync the canvas.' });
  });
  link?.on('disconnect', () => {
    if (canvasTimer && pendingCanvas !== null) {
      clearTimeout(canvasTimer);
      void flushCanvas();
    }
  });

  return {
    mcp,
    store,
    link,
    tools,
    async start() {
      await store.load();
      if (opts.watch !== false) await store.watch();
      if (link) {
        try {
          await link.start();
        } catch (e) {
          log.warn(`canvas link disabled: ${(e as Error).message}`);
        }
      }
    },
    async close() {
      if (canvasTimer) {
        clearTimeout(canvasTimer);
        if (pendingCanvas !== null) await flushCanvas();
      }
      await link?.close();
      await store.close();
      await mcp.close().catch(() => undefined);
    },
  };
}

function safeConfig(store: ProjectStore): FlowCanvasConfig | null {
  try {
    return store.get();
  } catch {
    return null;
  }
}
