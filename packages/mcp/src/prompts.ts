/**
 * MCP prompts: ready-made recipes the user (or the client) can run.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from './context.js';
import { DISCOVER_PROMPT, discoverRecipe } from './discover/recipe.js';

export function registerPrompts(mcp: McpServer, ctx: ServerContext): string[] {
  mcp.registerPrompt(
    DISCOVER_PROMPT,
    {
      title: 'Discover screens',
      description:
        "Fill the Flow Canvas from the app's code: scan the routes, read each screen for its states, pick real sample values for dynamic routes, group by user flow, add everything in one step, draw the obvious edges and leave a summary note.",
      argsSchema: {
        dir: z.string().optional().describe('App folder to scan when it is not the project folder (monorepos)'),
        focus: z.string().optional().describe('Limit to part of the app, e.g. "checkout flow"'),
      },
    },
    ({ dir, focus }) => {
      const pending = ctx.requests.list('pending').find((r) => r.kind === 'discover');
      return {
        description: 'Discover screens with Flow Canvas',
        messages: [{ role: 'user', content: { type: 'text', text: discoverRecipe({ dir, focus, requestId: pending?.id }) } }],
      };
    },
  );
  return [DISCOVER_PROMPT];
}
