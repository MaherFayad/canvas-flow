# Getting started

Flow Canvas has three parts: the Chrome extension (the canvas), an optional SDK you add to your app, and an optional MCP server for Claude. You can stop after step 2 and still have a working tool.

## 1. Install the extension

Until the Chrome Web Store listing is public, load it unpacked:

```bash
git clone https://github.com/MaherFayad/canvas-flow.git flow-canvas && cd flow-canvas
pnpm install
pnpm --filter @flowcanvas/extension build
```

1. Open `chrome://extensions` (Edge: `edge://extensions`; Arc and Brave use the Chrome page).
2. Turn on **Developer mode** and click **Load unpacked**.
3. Pick `apps/extension/.output/chrome-mv3`.
4. Pin **Flow Canvas** to the toolbar.

For development, `pnpm --filter @flowcanvas/extension dev` opens a Chrome with the extension loaded and reloads it on change.

## 2. Open the canvas on your app

1. Start your app's dev server (any port on `localhost`, `127.0.0.1` or `*.localhost`).
2. On a tab showing the app, click the Flow Canvas toolbar button. The canvas opens next to it, bound to that origin. You can also type an origin in the field at the top right.
3. On a new project the canvas **discovers screens**: it crawls same-origin links two levels deep from `/` (skipping anything that looks like logout or delete) and, if the app uses the SDK, adds the screens the SDK declares, with their states. Found screens land in an "Unsorted" section.
4. Already have a `flowcanvas.config.json`? Project menu (top left) → **Import config…**, then paste it or drop the file.

The two views:

- **Player**: one row per section, the active step large in the middle, its neighbours live on each side. **→ / ←** step along the row; the Flows sidebar jumps between sections.
- **Canvas**: every screen and every state as a frame, with edges between them. Pan and zoom; frames are live when on screen at 50% zoom or more (12 at most) and still otherwise.

Frames load your app inside iframes with `?fc-frame=<id>&fc-state=<state>`. The extension removes `X-Frame-Options` and `frame-ancestors` from those localhost sub-frame responses only; your normal tabs keep their headers. Frames share cookies with your tabs, so log in once in a normal tab if the app needs it.

### Record flows

In Canvas mode press **R** (or the Record button), then click through the app inside any frame. Each click followed by a navigation becomes an edge from the frame's screen and state to the screen at the new URL; unknown URLs become new screens. The trigger label is the clicked text and the target is `[data-fc="…"]` when the element has one, else a short CSS path. Press **R** again to stop. **Ctrl/Cmd+Z** undoes one recorded edge.

Clicks are real: recording "Delete account" deletes it in your dev database.

Select an edge to edit it in the inspector: trigger label, gesture, target selector (with a live Found / Not found check), transition type, duration and easing, and kind (happy, error, alternate).

### States

A screen's `states` list (the first is the default) puts one frame per state in a row. Each frame loads with `fc-state=<state>`. Two ways to make the app honour it:

- **With the SDK** (best): the app reads `fc.state()` and renders that state. See [sdk.md](./sdk.md).
- **Without the SDK**: add `mocks` to the config. The MAIN-world script answers matching `fetch` / XHR calls in that frame with the mocked status, body and delay (`"delay": "forever"` keeps it loading). Normal tabs are never mocked.

```json
"mocks": {
  "catalog:empty": [{ "match": { "method": "GET", "url": "/api/products*" }, "status": 200, "body": { "items": [] } }],
  "catalog:error": [{ "match": { "method": "GET", "url": "/api/products*" }, "status": 500 }],
  "catalog:loading": [{ "match": { "method": "GET", "url": "/api/products*" }, "delay": "forever" }]
}
```

### Tokens

**Tokens** reads the CSS custom properties on `:root` of your app, groups them (colour, type, radius, spacing) and lets you edit them with pickers and sliders. Changes stream to every live frame. Overrides are saved in `tokens` in the config; the base values always come from the app.

### Save

The top bar counts unsaved changes. **Save** (or project menu → **Download flowcanvas.config.json**) downloads the file; put it in your repo root. The canvas also keeps a working copy per origin in the browser, so closing the tab loses nothing.

## 3. Add the SDK (optional)

```bash
npm i -D @flowcanvas/sdk
```

```ts
import { fc } from '@flowcanvas/sdk';
fc.init({ screens: [{ id: 'catalog', path: '/catalog', states: ['default', 'loading', 'empty', 'partial', 'error'] }] });
```

Then branch on `fc.state()` / `fc.is()` where the screen loads its data. Framework recipes: [Vite + React](./recipes/vite-react.md), [Next.js App Router](./recipes/nextjs.md), [Nuxt / Vue](./recipes/nuxt-vue.md), [MSW](./recipes/msw.md). Full API: [sdk.md](./sdk.md).

## 4. Connect Claude (optional)

```bash
# Claude Code, from the project folder
claude mcp add flowcanvas -- npx -y @flowcanvas/mcp --project .
```

```json
// Claude Desktop: claude_desktop_config.json
{
  "mcpServers": {
    "flowcanvas": {
      "command": "npx",
      "args": ["-y", "@flowcanvas/mcp", "--project", "/Users/maher/dev/helka"]
    }
  }
}
```

Claude starts the server over stdio. It reads and writes `flowcanvas.config.json` in the project folder (created on the first write), and opens a WebSocket on `127.0.0.1` (first free port from 47800 to 47809) that accepts only a `chrome-extension://` origin; pass `--extension-id <id>` to accept only yours. The first time a canvas links to a project it asks "Claude wants to connect … Allow?". **Pause Claude** blocks every write tool.

Tools and resources: [mcp-tools.md](./mcp-tools.md).

## Finding your screens: three sources

The canvas can learn your app's screens three ways. They add to each other; a screen already on the canvas (same id, route or path) is not added twice.

| Source | How | Finds | Misses |
| --- | --- | --- | --- |
| **SDK** | `fc.init({ screens })` in your app (step 3) | exactly the screens and states you declare | nothing you declared; needs code in the app |
| **Crawl** | automatic on a new project, or Project menu → **Discover screens again** | pages reachable through `<a href>` links from `/`, two levels deep | button / `navigate()` navigation, dynamic routes, screens behind login, modals, sheets, steps and every state |
| **Claude** | Project menu → **Discover with Claude…**, or the button on the empty canvas | every route in the router, real sample ids for dynamic routes, the states each screen's code can show, screens behind auth (flagged), sections by user flow | routes built entirely at runtime (Claude says so in its note) |

**Discover with Claude** needs the MCP server (step 4) running in Claude Code in your app's folder and the canvas linked (top bar shows "Claude linked"):

1. Click **Discover with Claude**. The canvas queues a request on the MCP server and shows: "Asked Claude to discover screens. In Claude Code, say: discover my screens" with a Copy button.
2. Say that to Claude Code. An MCP server cannot wake Claude on its own, so nothing happens until you next message it; Claude then sees the pending request in `get_project` / `list_requests`.
3. Claude follows the `discover_screens` prompt (also readable as `flowcanvas://recipes/discover`): `scan_routes` reads your router statically (Next.js App and Pages Router, Nuxt, SvelteKit, Remix / React Router v7, Astro, TanStack Router, and React Router, Vue Router or TanStack Router configs in code), then Claude opens each screen's components to find its loading, empty, error, success and modal states, picks real ids from your fixtures, seeds or mocks for dynamic routes, and adds everything with one `add_screens` call. The screens appear at once as **one undo step** ("Claude: discovered N screens"), grouped into sections by flow, laid out automatically.
4. Claude draws the edges it can read from the code (a `navigate('/x')` or `<Link to>` next to a button), leaves a summary note, and marks the request done; the canvas shows its summary.

Without a link, the button copies the `claude mcp add` command and a ready prompt instead. You can also skip the button entirely and tell Claude "discover my screens" (in Claude Code, the prompt is also offered as the server's `discover_screens` slash command). Screens behind login load in the canvas once you are signed in to the app in a normal tab.

## The config file

`flowcanvas.config.json` holds everything: project, devices, sections, screens and their states, edges with triggers and transitions, mocks, token overrides, images, notes and comments. Reference: [config-schema.md](./config-schema.md). Editors that read `$schema` validate it against [schema/v1.json](./schema/v1.json).
