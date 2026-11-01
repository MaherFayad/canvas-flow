/**
 * MCP resources: read-only views Claude can attach.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UriTemplate, type Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { mimeForFile } from './assets.js';
import { getScreenshot, type ServerContext } from './context.js';
import { ToolError } from './log.js';
import { filterComments, withFrameInfo } from './tools.js';
import { DISCOVER_RECIPE_URI, discoverRecipe } from './discover/recipe.js';

export const PROJECT_URI = 'flowcanvas://project';
export const COMMENTS_URI = 'flowcanvas://comments';
export const COMMENTS_FOR_CLAUDE_URI = 'flowcanvas://comments?status=open&to=claude';
export const NOTES_URI = 'flowcanvas://notes';
export const REQUESTS_URI = 'flowcanvas://requests';
export { DISCOVER_RECIPE_URI };

/** Matches flowcanvas://comments with any combination of ?status= and &to= (the SDK's {?a,b} needs all of them). */
class CommentsTemplate extends UriTemplate {
  constructor() {
    super('flowcanvas://comments{?status,to}');
  }
  override match(uri: string): Variables | null {
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      return null;
    }
    if (`${u.protocol}//${u.host}${u.pathname}` !== COMMENTS_URI) return null;
    const vars: Variables = {};
    for (const k of ['status', 'to']) {
      const v = u.searchParams.get(k);
      if (v) vars[k] = v;
    }
    return vars;
  }
}

const json = (uri: string, v: unknown): ReadResourceResult => ({
  contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(v, null, 2) }],
});

export function registerResources(mcp: McpServer, ctx: ServerContext): void {
  mcp.registerResource(
    'project',
    PROJECT_URI,
    {
      title: 'Flow Canvas project',
      description: 'The whole flowcanvas.config.json: sections, screens, states, edges, mocks, tokens, images, notes and comments.',
      mimeType: 'application/json',
    },
    async (uri) => json(uri.href, ctx.store.get()),
  );

  const readComments = (href: string, status?: string, to?: string): ReadResourceResult => {
    if (status && status !== 'open' && status !== 'resolved') throw new ToolError(`status must be open or resolved`);
    if (to && to !== 'claude' && to !== 'team') throw new ToolError(`to must be claude or team`);
    const c = ctx.store.get();
    const list = filterComments(c, { status: status as 'open' | 'resolved' | undefined, to: to as 'claude' | 'team' | undefined }).map((x) => withFrameInfo(c, x));
    return json(href, { comments: list });
  };

  mcp.registerResource(
    'comments',
    COMMENTS_URI,
    {
      title: 'Canvas comments',
      description: 'All comment threads with element context. Filter with ?status=open|resolved&to=claude|team.',
      mimeType: 'application/json',
    },
    async (uri) => readComments(uri.href),
  );

  mcp.registerResource(
    'comments-filtered',
    new ResourceTemplate(new CommentsTemplate(), {
      list: async () => ({
        resources: [{ uri: COMMENTS_FOR_CLAUDE_URI, name: 'Open comments for Claude', mimeType: 'application/json' }],
      }),
    }),
    {
      title: 'Canvas comments (filtered)',
      description: 'Comment threads filtered by status (open, resolved) and to (claude, team). flowcanvas://comments?status=open&to=claude lists the feedback waiting for Claude.',
      mimeType: 'application/json',
    },
    async (uri, vars) => readComments(uri.href, str(vars.status), str(vars.to)),
  );

  mcp.registerResource(
    'notes',
    NOTES_URI,
    { title: 'Sticky notes', description: 'All sticky notes with kind, text, author and attachment.', mimeType: 'application/json' },
    async (uri) => json(uri.href, { notes: ctx.store.get().notes }),
  );

  mcp.registerResource(
    'requests',
    REQUESTS_URI,
    {
      title: 'Canvas requests',
      description:
        'Pending requests the user made from the canvas for Claude (e.g. "Discover with Claude"). Updated (notifications/resources/updated) when the user makes one. Handle each, then call complete_request.',
      mimeType: 'application/json',
    },
    async (uri) => json(uri.href, { requests: ctx.requests.list('pending') }),
  );

  mcp.registerResource(
    'recipe-discover',
    DISCOVER_RECIPE_URI,
    {
      title: 'Recipe: discover screens',
      description: "Step-by-step recipe to fill the canvas with the app's screens, routes and states from the code (same text as the discover_screens prompt, for clients without prompts).",
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: discoverRecipe() }] }),
  );

  mcp.registerResource(
    'screenshot',
    new ResourceTemplate('flowcanvas://screens/{id}/{state}/screenshot', {
      list: async () => {
        let screens: { id: string; title: string; states: string[] }[] = [];
        try {
          screens = ctx.store.get().screens;
        } catch {
          /* invalid file: list nothing */
        }
        return {
          resources: screens.flatMap((s) =>
            s.states.map((st) => ({ uri: `flowcanvas://screens/${s.id}/${st}/screenshot`, name: `${s.title} / ${st}`, mimeType: 'image/webp' })),
          ),
        };
      },
    }),
    { title: 'Frame screenshot', description: 'WebP screenshot of a screen state: live from the canvas, or the last cached still.', mimeType: 'image/webp' },
    async (uri, vars) => {
      const shot = await getScreenshot(ctx, decodeURIComponent(str(vars.id) ?? ''), decodeURIComponent(str(vars.state) ?? 'default'));
      return { contents: [{ uri: uri.href, mimeType: shot.mimeType, blob: shot.data }] };
    },
  );

  mcp.registerResource(
    'image',
    new ResourceTemplate('flowcanvas://images/{id}', {
      list: async () => {
        let images: { id: string; caption?: string; file?: string }[] = [];
        try {
          images = ctx.store.get().images;
        } catch {
          /* ignore */
        }
        return {
          resources: images.map((i) => ({
            uri: `flowcanvas://images/${i.id}`,
            name: i.caption ?? i.id,
            mimeType: i.file ? mimeForFile(i.file) : 'text/plain',
          })),
        };
      },
    }),
    { title: 'Canvas image', description: 'An image placed on the canvas (file from .flowcanvas/assets/).' },
    async (uri, vars) => {
      const iid = decodeURIComponent(str(vars.id) ?? '');
      const img = ctx.store.get().images.find((i) => i.id === iid);
      if (!img) throw new ToolError(`Unknown image "${iid}".`);
      if (!img.file) return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: img.url ?? '(no file)' }] };
      const abs = path.resolve(ctx.store.dir, img.file);
      if (!abs.startsWith(ctx.store.dir + path.sep)) throw new ToolError('Image path is outside the project.');
      const buf = await fs.readFile(abs).catch(() => {
        throw new ToolError(`Image file ${img.file} is missing.`);
      });
      return { contents: [{ uri: uri.href, mimeType: mimeForFile(img.file), blob: buf.toString('base64') }] };
    },
  );
}

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
