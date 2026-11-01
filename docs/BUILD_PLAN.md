# Flow Canvas: Build Plan (Option B)

Nov 1, 2026 · @maher fayad

## Summary

We build a Chrome extension (working name **Flow Canvas**) that turns any app running on localhost into a live map of its screens, states and flows. A small optional npm package (`@flowcanvas/sdk`) lets the app show itself in a chosen state and mark its tap targets. Without the SDK the extension still works: live frames, viewports, recorded flows, tokens. With it, every state (loading, empty, partial, error) is one click away. A third piece, a local MCP server (`@flowcanvas/mcp`), lets Claude read and edit the whole canvas, including sections, images, sticky notes and comments.

The plan runs in 8 milestones (M0 to M7) over about 13 weeks for one developer working with Claude Code. Milestone 1 ships a usable canvas in week 2.

**v1 is done when:**

- A designer opens any localhost app and sees all its screens laid out in under 60 seconds, with no code change.
- With the SDK added (under 10 lines), each screen shows 5 states side by side.
- Flows are recorded by clicking through the real app, then saved as `flowcanvas.config.json` in the repo.
- Player mode steps through a flow with the set transitions on a phone frame.
- A token change (color, radius, font) shows in every frame in under 200 ms.
- 30 frames on the canvas stay above 50 fps when panning, on a 2021 MacBook Air (M1, 8 GB).

## Scope

v1 covers the full loop shown in the reference video: see every screen, force states, draw flows, play them, tweak tokens. Editing the app's code from the canvas is out of v1.

| Area | v1 (ship) | Later (v1.x / v2) | Out |
| --- | --- | --- | --- |
| Canvas | Pan, zoom, snap grid, minimap, fit view, multi-select | Align and distribute tools | Freeform drawing |
| Sections | Named sections holding frames, notes, images; nesting to 3 levels; collapse; auto-layout row / grid | Section templates | None |
| Images | Drop, paste, URL; crop, resize, opacity; overlay on a frame; saved to repo when MCP is linked | Video and Lottie | None |
| Notes and comments | Sticky notes (5 kinds), pinned comment threads with element context, "For Claude" flag | Mentions of teammates, email digest | Real-time multiplayer |
| MCP | `@flowcanvas/mcp` with 25+ tools, resources, change notice, Allow / Deny guard, Pause Claude | Claude runs record mode on its own | Remote (hosted) MCP |
| Frames | Live iframes, screenshot fallback when zoomed out, 4 device presets + custom | Side-by-side compare of two branches (two ports) | Real device mirroring |
| States | `?fc-state=` via SDK, fetch/XHR mock fallback, state badges (DEFAULT, LOADING, EMPTY, PARTIAL, ERROR, SUCCESS) | Full state editor UI for mock bodies, MSW handler import | Backend seeding |
| Flows | Record by clicking, manual edges, trigger label, gesture, target selector | Branching conditions, flow coverage report | Full prototyping logic (variables) |
| Transitions | push, pop, sheet-up, sheet-down, fade, none; duration; 4 easings + custom cubic-bezier; spring presets | Shared-element transitions | Code export of transitions |
| Player | One device frame, step through edges, back, restart, keyboard arrows | Shareable recording (GIF / MP4) | Hosted share links |
| Tokens | Read CSS variables from `:root`, edit color / type / radius / spacing, export JSON and CSS | Two-way sync with Figma variables via Figma MCP | Writing tokens back to source files |
| Save | `flowcanvas.config.json` (written live by MCP, or downloaded) + `chrome.storage.local` | Git diff view of canvas changes | Cloud sync |
| Hosts | `localhost`, `127.0.0.1`, `*.localhost`, any port | LAN IPs, `*.local`, staging URLs (opt-in) | Public sites |
| Browsers | Chrome, Edge, Arc, Brave (all Chromium MV3) | Firefox | Safari |

## Architecture

Five parts: the canvas page and a background worker inside the extension, two content scripts in every localhost frame, the optional SDK inside the app, and a local MCP server that connects Claude to the canvas. The canvas never touches a frame's page directly; every request goes through the bridge as a checked message.

&#91;embedded content: Architecture: extension, frames, SDK, dev server\]

The canvas loads each frame with `?fc-state=` in the URL, then talks to it only by `postMessage`. The app's fetch calls pass through `mock.js`, which answers from the mock list only when there is no SDK.

### Message protocol

All messages are `{ fc: <type>, v: 1, nonce, frame, ...payload }`, with types and zod schemas in `packages/protocol`.

| Type | From → To | Payload | Purpose |
| --- | --- | --- | --- |
| `fc:hello` | frame → canvas | `{ frame, hasSdk }` | Frame says it is up |
| `fc:welcome` | canvas → frame | `{ nonce, state, device }` | Canvas accepts it and hands the nonce |
| `fc:screens` | frame → canvas | `[{ id, path, group, states }]` | SDK screen list for discovery |
| `fc:ready` | frame → canvas | `{ url }` | Screen settled; safe to capture or animate |
| `fc:nav` | frame → canvas | `{ from, to }` | URL changed (pushState, popstate) |
| `fc:click` | frame → canvas | `{ target, text, rect }` | Click seen in record mode |
| `fc:query` | canvas → frame | `{ selector }` | Is this target on the page? |
| `fc:query-result` | frame → canvas | `{ found, rect }` | Answer for the Found / Not found check |
| `fc:tokens-read` | frame → canvas | `[{ name, value, type }]` | CSS variables found on `:root` |
| `fc:tokens` | canvas → frame | `{ vars }` | Apply token overrides |
| `fc:capture` | canvas → frame | `{ scale, quality }` | Take a screenshot |
| `fc:capture-result` | frame → canvas | `{ webp }` | Screenshot as a data URL |
| `fc:mocks` | canvas → frame | `{ rules }` | Mock rules for this screen and state |

### What happens when a frame opens

1. Canvas sets `iframe.src = origin + path + ?fc-frame=<id>&fc-state=<state>`.
2. Chrome loads it; the DNR rule removes `X-Frame-Options` and `frame-ancestors` from the response.
3. `mock.js` (MAIN world) and `bridge.js` (isolated world) start at `document_start`.
4. Bridge sends `fc:hello`; canvas answers `fc:welcome` with the nonce and, when there is no SDK, `fc:mocks`.
5. App renders; SDK (or a 1.5 s timer) sends `fc:ready`.
6. Canvas asks for `fc:tokens-read` once per project and `fc:capture` when the frame is due for a new still.

## Data model

One JSON file per project, `flowcanvas.config.json`, holds everything. It lives in the repo root so flows are reviewed in pull requests like code. The extension keeps a working copy in `chrome.storage.local` keyed by origin (`http://localhost:3000`), and marks it "unsaved" until exported.

```json
{
  "$schema": "https://flowcanvas.dev/schema/v1.json",
  "version": 1,
  "project": { "name": "Helka ceramics", "origin": "http://localhost:3000" },
  "devices": [
    { "id": "iphone-16-pro-max", "label": "iPhone 16 Pro Max", "w": 440, "h": 956, "dpr": 3, "chrome": "ios" },
    { "id": "desktop", "label": "Desktop", "w": 1440, "h": 900, "dpr": 2, "chrome": "none" }
  ],
  "groups": [
    { "id": "onboarding", "title": "Onboarding", "order": 0 },
    { "id": "checkout", "title": "Checkout", "order": 2 }
  ],
  "screens": [
    {
      "id": "catalog",
      "title": "Catalog",
      "group": "onboarding",
      "path": "/catalog",
      "states": ["default", "loading", "empty", "partial", "error"],
      "position": { "x": 960, "y": 120 }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": { "screen": "welcome", "state": "default" },
      "to": { "screen": "pick-interests", "state": "default" },
      "trigger": { "label": "Get started", "gesture": "tap", "target": "[data-fc=\"get-started\"]" },
      "transition": { "type": "push", "duration": 240, "easing": "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      "kind": "happy"
    }
  ],
  "mocks": {
    "catalog:empty": [
      { "match": { "method": "GET", "url": "/api/products*" }, "status": 200, "body": { "items": [] } }
    ],
    "catalog:error": [
      { "match": { "method": "GET", "url": "/api/products*" }, "status": 500, "body": { "error": "server" } }
    ],
    "catalog:loading": [
      { "match": { "method": "GET", "url": "/api/products*" }, "delay": "forever" }
    ]
  },
  "tokens": { "--color-bg": "#F4F1EA", "--radius-md": "12px" }
}
```

| Field | Rule |
| --- | --- |
| `screens[].id` | kebab-case, unique, stable (edges point at it) |
| `screens[].states` | first item is the default; names are free text, the 6 built-in names get colored badges |
| `edges[].kind` | `happy`, `error`, `alternate`; draws as solid, red, dashed |
| `edges[].trigger.target` | any CSS selector; `[data-fc="…"]` is preferred because it survives refactors |
| `mocks` key | `<screenId>:<state>`; used only when the app has no SDK |
| `tokens` | overrides only; the base values are read live from the app |

Storage limits: `chrome.storage.local` gives 10 MB by default; add the `unlimitedStorage` permission because screenshots are stored there too (about 60 to 150 KB each as WebP).

### Sections, images, notes and comments

These sit in the same file so Claude Code can read them straight from the repo. `groups` from the first version becomes `sections`; the config migration (`packages/config`) renames it and keeps the ids.

```json
{
  "sections": [
    { "id": "onboarding", "title": "Onboarding", "parent": null, "color": "blue",
      "rect": { "x": 0, "y": 0, "w": 2400, "h": 1100 }, "layout": "row", "collapsed": false, "locked": false }
  ],
  "images": [
    { "id": "img-7f2a", "file": ".flowcanvas/assets/7f2a91.webp", "caption": "Figma: Catalog v3",
      "rect": { "x": 980, "y": 1200, "w": 440, "h": 956 }, "crop": null, "opacity": 1,
      "overlay": { "frame": "catalog:default", "opacity": 0.5 }, "section": "onboarding" }
  ],
  "notes": [
    { "id": "n-12", "kind": "decision", "text": "Skip button goes to Catalog, not Login.",
      "attachTo": { "type": "edge", "id": "e1" }, "rect": { "x": 520, "y": 410, "w": 220, "h": 120 },
      "author": "maher", "createdAt": "2026-11-01T10:12:00Z" }
  ],
  "comments": [
    {
      "id": "c-3", "status": "open", "to": "claude",
      "anchor": {
        "frame": "catalog:empty", "device": "iphone-16-pro-max", "x": 0.5, "y": 0.62,
        "element": {
          "selector": "[data-fc=\"clear-filters\"]", "tag": "button", "text": "Clear filters",
          "rect": { "x": 180, "y": 590, "w": 82, "h": 28 },
          "html": "<button data-fc=\"clear-filters\" class=\"btn-ghost\">Clear filters</button>",
          "styles": { "color": "#1A1A1A", "font": "500 13px Inter", "padding": "6px 12px", "radius": "14px" }
        }
      },
      "thread": [
        { "author": "maher", "text": "@claude make this a 44 px target and add an edge back to Catalog default.", "at": "2026-11-01T10:20:00Z" },
        { "author": "claude", "text": "Done: padding is now 12px 16px (44 px tall). Added edge c-3-e.", "at": "2026-11-01T10:21:30Z", "changes": ["e9"] }
      ]
    }
  ]
}
```

Images live as files under `.flowcanvas/assets/`, never inline in the JSON, so the config stays small and readable in diffs.

## Feature specs

Eleven features, each with how it works in Chrome and when it counts as done.

### 1. Open the canvas

- Click the toolbar icon on any localhost tab. The extension opens `canvas.html` in a new tab, bound to that tab's origin.
- First run with no config: run **Discover** (feature 2) and lay out the found screens in a grid, 3 per row.
- With a saved config: restore positions, groups, edges and zoom.
- Top bar, matching the video: project name, Player / Canvas toggle, Mobile / Desktop toggle, device picker, origin field (`http://localhost:3000`), undo / redo, unsaved count, Discard, Save edges, Tokens.
- Left sidebar: Flows tree (group > screen > state) with a count per group and a status dot per state. Click to fly the camera to that frame.
- **Done when:** a fresh install opens a canvas for a Vite React app in under 5 seconds.

### 2. Discover screens

Three sources, merged and de-duplicated by path:

1. **SDK registry** (best): the app calls `fc.screens([...])` and the bridge sends the list up.
2. **Router sniff**: read routes from known globals when present (Next.js `__NEXT_DATA__` and `/_next/static/*/_buildManifest.js`, React Router via the SDK adapter, Vue Router `$router.getRoutes()` via the SDK adapter).
3. **Crawl**: a hidden iframe loads `/`, collects same-origin `<a href>` links, follows them 2 levels deep, max 50 pages, skips paths with `logout`, `signout`, `delete`.

- Each found path becomes a screen in the "Unsorted" group. The user drags it into a group.
- Dynamic routes (`/product/:id`) ask for a sample value once.
- **Done when:** crawl finds 90% or more of linked routes on 3 test apps (Next.js, Vite React, Nuxt).

### 3. Frames and viewports

- Each frame is `<iframe src="origin + path + ?fc-state=<state>&fc-frame=<id>">` sized to the device's CSS width and height. The iframe width is the page's real viewport, so media queries and container queries work.
- Zoom uses one CSS `transform: scale()` on the canvas layer, never on each frame, so text stays sharp.
- Device chrome (iOS status bar 9:41, Dynamic Island, home bar) is drawn by the canvas around the iframe, not inside it.
- `sandbox` is not set, so the app runs as normal (cookies, storage, auth all shared with the user's normal tab because it is the same origin).
- Frame header: screen name, state name, state badge, menu (reload, open in tab, copy link, duplicate as new state, delete).
- **Live vs still:** a frame is live only when it is on screen AND zoom is 50% or more AND fewer than 12 frames are live. All other frames show their last screenshot. Hover on a still frame for 400 ms makes it live.
- **Done when:** switching Mobile to Desktop re-lays all frames in under 1 second, and a page with `@media (min-width: 768px)` shows the right layout in each.

### 4. States

Two paths. The canvas tries path A first and falls back to path B.

**Path A, SDK.** The app reads `fc.state()` and returns the matching data. The SDK sends `fc:ready` when the screen has settled, so screenshots wait for real content.

**Path B, mock layer.** A script injected in the page's MAIN world at `document_start` wraps `window.fetch` and `XMLHttpRequest`. If the URL has `fc-state`, it looks up `mocks["<screen>:<state>"]` and returns the mock body, status and delay. `"delay": "forever"` returns a promise that never settles, which shows the loading state.

- Badges and colors: DEFAULT (grey), LOADING (amber), EMPTY (blue), PARTIAL (purple), ERROR (red), SUCCESS (green). Custom names get grey.
- "Duplicate as new state" copies a frame and asks for a state name. This is how the user adds "Pick interests: missing" from the video.
- Mock editor (v1 is basic): a JSON panel per state with match, status, body, delay. Record button: capture the real responses on the default state and use them as the starting body.
- **Done when:** the 5 states of the Catalog screen in the demo app render correctly via both path A and path B.

### 5. Flows and edges

- **Record mode** (R key): click inside any live frame as normal. The bridge catches the click, finds the closest `[data-fc]` (or builds a short CSS path if none), and waits for the next URL change. When the URL changes, it creates an edge from the old screen to the new one with label = the button's text.
- **Manual mode:** drag from a frame's right handle to another frame. A side panel opens to set the trigger.
- Edge side panel (matches the video): Label, Hint (shown on the Player arrow), Gesture (tap, long-press, swipe-left, swipe-right, swipe-up, swipe-down, submit, auto-after-ms), Target selector with a "Found in the app on this state" check, Transition, Duration, Easing, Kind (happy, error, alternate), Play edge, Delete.
- Edge drawing: orthogonal lines with rounded corners routed in the gaps between frames; label pill in the middle showing `Label` and `gesture · transition · duration`.
- Selector check: on select, the canvas asks the frame's bridge `querySelector(target)`; green "Found" or red "Not found on this state".
- **Done when:** clicking through 4 screens of the demo in record mode makes 3 correct edges with labels, and they survive a page reload.

### 6. Player mode

- One device frame in the center. Start = the first screen of the chosen group.
- Shows the outgoing edges of the current screen as hint arrows ("Tap 'Get started'").
- When the user taps the real target inside the frame, or presses the arrow key, the transition plays.
- **How transitions play:** two stacked iframes, A (current) and B (next). B loads the next URL hidden. On `fc:ready` (or `load` + 300 ms without SDK), the canvas animates both with the Web Animations API: push = A slides to -30% while B slides in from 100%; sheet-up = B rises from 100% Y with a dim layer over A; fade = opacity cross-fade. Then A is swapped out and becomes the spare.
- Back (Esc or swipe) plays the reverse.
- The custom cubic-bezier editor from the video: a 2-handle curve with presets Snappy, Emphasized, Sheet, Overshoot, and a time slider preview.
- **Done when:** a push at 240 ms runs at 60 fps on the test machine with both frames live.

### 7. Tokens

- On open, the bridge reads all custom properties on `:root` and `html` from `document.styleSheets` (same-origin sheets only) and sends `{name, value, type}`. Type is guessed: color if it parses as a color, length if it ends in px/rem/em, number otherwise.
- Panel groups: Colors (swatch + hex + picker), Type (font family, sizes), Radius, Spacing, Other. Each row shows a reset dot when changed.
- Change = the canvas sends `fc:tokens` to every frame; each bridge sets `document.documentElement.style.setProperty(name, value)`. Live and still frames both update; still frames re-capture after 1 second idle.
- Tailwind v3 apps (no CSS variables for colors) show a note: "This app uses compiled Tailwind classes. Token edits need Tailwind v4 or CSS variables."
- Export: JSON (W3C design tokens format), CSS (`:root { ... }`), copy to clipboard.
- **Done when:** changing `--color-bg` updates 20 frames in under 200 ms.

### 8. Screenshots

- Taken inside each frame by the bridge with `modern-screenshot` (`domToWebp`, scale 0.5, quality 0.8) after `fc:ready` or 1.5 s idle.
- Queue: max 3 at once, the status pill reads "Capturing screenshots 12/31" as in the video. "Recapture all" button.
- Stored per `screen:state:device` in storage with a hash of the URL; stale after a hot reload (the bridge watches for Vite / webpack HMR events and marks the frame dirty).
- Fallback when `modern-screenshot` fails (cross-origin images, canvas taint): open the URL in a hidden window and use `chrome.tabs.captureVisibleTab`.
- **Done when:** 31 screens capture in under 20 seconds.

### 9. Sections, groups and images

- **Sections** are named areas on the canvas that hold anything: frames, sticky notes, images, other sections (nesting up to 3 levels). They replace the fixed "groups" from the data model and keep the same id, so the sidebar Flows tree still reads Group > Screen > State.
- Make one: select items and press Cmd/Ctrl + G, or draw with the Section tool (S). Ungroup: Cmd/Ctrl + Shift + G.
- Section header: name, item count, color (with a word label, never color alone), collapse toggle, lock toggle, menu (fit to content, auto-layout as row, auto-layout as grid, play this flow).
- Collapsed section = a header bar with the count; all its live frames unload. This is the main tool for keeping big projects fast.
- Auto-layout: "Row" puts the states of one screen side by side, as in the video; "Grid" packs frames 3 per row with 64 px gaps.
- Moving a section moves everything inside; edges stay attached.
- **Images:** drop or paste any image (PNG, JPG, WebP, SVG, GIF) on the canvas, or add by URL. Uses: Figma exports to compare with the build, reference shots, competitor screens, whiteboard photos.
- Image tools: resize with ratio lock, crop, opacity slider, "Overlay on frame" (pins the image over a frame at 50% opacity to spot pixel gaps between design and build), caption, link to a frame.
- Storage: images go to IndexedDB in the canvas (blobs, up to a few hundred MB). When the MCP server is connected, they are also written to `.flowcanvas/assets/` in the repo with a hash name, so Claude can read them and teammates get them through git. Images over 5 MB are scaled down to 2560 px on the long side, WebP.
- **Done when:** a Figma PNG dropped on the canvas overlays the matching frame, and a collapsed section with 20 frames frees their memory.

### 10. Comments and sticky notes

- **Sticky notes** (N key): free text in markdown on the canvas, resizable, 5 kinds with a color and a word label: Note, Question, Issue, Decision, Idea. A note can be attached to a frame, edge, section or image and then moves with it.
- **Comments** (C key): click a spot on a frame to drop a numbered pin. The bridge saves what is under the pin: CSS selector, tag, visible text, size and position, trimmed `outerHTML` (max 2 KB), and key computed styles (color, background, font, padding, margin, radius). This is what makes a comment useful to Claude: it knows the exact element, not just a spot on a picture.
- Comments are threads: reply, resolve, reopen, edit, delete. Sidebar tab "Comments" with filters: Open, Resolved, Mine, For Claude.
- **For Claude:** a toggle on the comment or `@claude` in the text marks it `to: "claude"`. Claude finds these through MCP (feature 11) and replies in the same thread with a Claude badge. When Claude changes something, its reply links the change ("Added edge Catalog to Product detail").
- **Readable by Claude 3 ways:** (1) MCP tools, live; (2) the `notes` and `comments` arrays in `flowcanvas.config.json`, so Claude Code can read them from the repo even with no MCP; (3) "Copy as prompt" on any thread or section, which copies clean markdown with the element context.
- Pins stay on their element: when the layout shifts, the pin follows the selector; if the selector no longer matches, the pin turns grey with "Element moved or removed".
- **Done when:** a comment pinned on a button in Catalog / empty reaches Claude with the selector and element HTML, and Claude's reply shows in the thread within 2 seconds.

### 11. MCP server for Claude

A Chrome extension cannot open a port or talk over stdio, so the MCP server is a small Node package that Claude starts. The canvas tab connects to it over a local WebSocket. With this, Claude can read and change everything on the canvas: screens, states, edges, transitions, tokens, sections, images, notes and comments.

**Setup**

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

**How the link works**

1. Claude starts the server over stdio. The server opens a WebSocket on `127.0.0.1`, first free port from 47800 to 47809.
2. The open canvas tab scans those ports every 5 s and connects.
3. The server only accepts a socket whose `Origin` header is `chrome-extension://<our extension id>`. Web pages cannot fake this header, so no random site can drive the canvas.
4. First time per project, the canvas asks: "Claude wants to connect to Helka ceramics. Allow?" The answer is saved.
5. Once linked, `flowcanvas.config.json` becomes the single source of truth: the server reads and writes it, the canvas merges each change live, and canvas edits flow back to the file (debounced 500 ms). The manual Save button is hidden while linked.

**Tools**

| Tool | Input | Returns | Canvas must be open |
| --- | --- | --- | --- |
| `get_project` | none | Sections, screens, states, devices, counts | No |
| `list_screens` | `section?` | Screens with path, states, position | No |
| `add_screen` / `update_screen` | `id, title, path, section, states?` | Screen | No |
| `add_state` | `screenId, name, mocks?` | State | No |
| `list_edges` | `screenId?` | Edges | No |
| `add_edge` / `update_edge` | `from, to, trigger, transition?, kind?` | Edge | No |
| `delete_items` | `ids[]` | Deleted count | No (asks on canvas when open) |
| `create_section` / `update_section` | `name, itemIds[], layout?, color?` | Section | No |
| `add_image` | `path or url, x, y, attachTo?, caption?` | Image | No |
| `list_images` | `section?` | Images with captions and file paths | No |
| `add_note` / `update_note` | `text, kind, attachTo?` | Note | No |
| `list_notes` | `section?, kind?` | Notes with what they are attached to | No |
| `list_comments` | `status?, to?` | Threads with element context | No |
| `reply_comment` / `resolve_comment` | `threadId, text?` | Thread | No |
| `get_tokens` / `set_tokens` | `vars?` | Base values + overrides | Yes |
| `get_screenshot` | `screenId, state, device?` | WebP image | Yes, or last cached still |
| `check_target` | `screenId, state, selector` | Found, size, position | Yes |
| `play_flow` | `sectionId or edgeIds` | Pass, plus steps that failed | Yes |
| `focus` | `itemId` | Camera moves to it | Yes |
| `get_selection` | none | What the user has selected now | Yes |

**Resources** (read-only views Claude can attach): `flowcanvas://project`, `flowcanvas://comments?status=open&to=claude`, `flowcanvas://notes`, `flowcanvas://screens/{id}/{state}/screenshot`, `flowcanvas://images/{id}`.

**Telling Claude something changed:** when someone posts a "For Claude" comment, the server sends `notifications/resources/updated` for the comments resource. Clients that subscribe can react. Not every client acts on this today, so the plain path still works: "check my canvas comments".

**Guardrails**

- Every Claude change is one undo step labeled "Claude: …" in the canvas history.
- An Activity panel lists each tool call with time and result.
- Deletes, and token changes to more than 10 variables, show an Allow / Deny toast when the canvas is open.
- A "Pause Claude" switch in the top bar blocks all write tools until it is turned back on.
- **Done when:** in Claude Code, "add an error state to Checkout, draw the retry edge, and leave a note on why" shows up on the canvas and in the file, and can be undone in one step.

## SDK spec

The SDK is one tiny package, under 2 KB gzipped, with zero dependencies. It does nothing when the page is not inside the canvas, so it is safe to leave in dev builds. It is stripped from production by a `process.env.NODE_ENV` check.

### Install

```bash
npm i -D @flowcanvas/sdk
```

```ts
// main.tsx (any framework)
import { fc } from '@flowcanvas/sdk';

fc.init({
  screens: [
    { id: 'welcome', path: '/', group: 'onboarding' },
    { id: 'catalog', path: '/catalog', group: 'onboarding',
      states: ['default', 'loading', 'empty', 'partial', 'error'] },
  ],
});
```

### API

| Call | Returns | What it does |
| --- | --- | --- |
| `fc.init(opts)` | `void` | Sends the screen list to the canvas; starts the bridge handshake |
| `fc.active` | `boolean` | `true` only inside a canvas frame (`?fc-frame=` in the URL and a parent that answered the handshake) |
| `fc.state()` | `string` | Current forced state, or `'default'` |
| `fc.is(name)` | `boolean` | Short form: `fc.is('empty')` |
| `fc.ready()` | `void` | Tells the canvas the screen has settled (data loaded, fonts in). Screenshots and player transitions wait for it. Auto-called 1.5 s after load if never called |
| `fc.target(id)` | `{ 'data-fc': id }` | Spread on any element to mark a trigger: `<button {...fc.target('get-started')}>` |
| `fc.on('tokens', fn)` | unsubscribe fn | For apps that keep tokens in JS (styled-components, Tamagui) |

### Using states in app code

```ts
// React Query example
const { data, isLoading, error } = useQuery({
  queryKey: ['products'],
  queryFn: () => fc.active ? fixtures.products[fc.state()] : api.products(),
});
```

```ts
// Or the simplest form, at the top of a screen
if (fc.is('loading')) return <CatalogSkeleton />;
if (fc.is('error')) return <ErrorState onRetry={noop} />;
```

### Adapters (thin wrappers, separate entry points)

| Entry | Adds |
| --- | --- |
| `@flowcanvas/sdk/react` | `useFcState()`, `<FcTarget id>`, React Router route list auto-read |
| `@flowcanvas/sdk/next` | App Router and Pages Router route list from the build manifest |
| `@flowcanvas/sdk/vue` | `useFcState()`, Vue Router `getRoutes()` auto-read |
| `@flowcanvas/sdk/msw` | `fcHandlers(map)`: picks MSW handlers by state, for apps already on MSW |
| `@flowcanvas/sdk/vite` | Vite plugin: adds `data-fc` from JSX `fcTarget="id"` props, strips SDK in build |

### Handshake

1. Page loads with `?fc-frame=<frameId>&fc-state=<state>`.
2. SDK posts `{ fc: 'hello', v: 1, frame }` to `parent`.
3. Canvas answers `{ fc: 'welcome', v: 1, nonce }`; all later messages carry that nonce.
4. No answer in 500 ms: SDK stays off (`fc.active = false`). This stops a random page that embeds the app from driving it.

## Tech stack and repo layout

TypeScript everywhere, one pnpm monorepo, WXT to build the extension. WXT handles MV3 manifest, hot reload and multi-browser builds with less setup than CRXJS or plain Vite.

| Layer | Pick | Why | Alternative |
| --- | --- | --- | --- |
| Extension build | WXT | MV3 manifest from code, HMR for extension pages, Chrome + Firefox output | CRXJS Vite plugin |
| Canvas UI | React 19 + `@xyflow/react` (React Flow 12) | Nodes = frames, edges = flows, pan/zoom, minimap, handles all built in | tldraw (better drawing, heavier, license terms for commercial use) |
| State | Zustand + `zundo` | Small store, undo/redo in a few lines | Jotai |
| Styling | Tailwind v4 + Radix primitives | Fast panels, accessible popovers and sliders | shadcn/ui on Radix |
| Animation | Web Animations API | Native, no library, runs on the compositor | Motion (Framer) |
| Easing editor | Hand-built SVG, 2 handles | Small, matches the video exactly | `bezier-easing` for the math |
| Screenshots | `modern-screenshot` | Faster and more accurate than html2canvas, WebP out | `html-to-image` |
| Schema | Zod | One schema for config validation and types | Valibot |
| SDK build | tsup | ESM + CJS + types, tiny output | Vite library mode |
| Tests | Vitest + Playwright (persistent context with the unpacked extension) | Playwright can load MV3 extensions in Chromium | Puppeteer |

```
flow-canvas/
├─ apps/
│  ├─ extension/            # WXT project
│  │  ├─ entrypoints/
│  │  │  ├─ background.ts    # service worker: open canvas, DNR rules, tab routing
│  │  │  ├─ bridge.content.ts # isolated world, all_frames, localhost only
│  │  │  ├─ mock.content.ts   # MAIN world, document_start, fetch/XHR wrap
│  │  │  ├─ canvas/           # canvas.html + React app
│  │  │  └─ popup/            # small popup: open canvas, recent projects
│  │  ├─ components/          # Frame, EdgePill, Sidebar, TokensPanel, Player
│  │  ├─ store/               # zustand slices: project, camera, ui, capture
│  │  └─ public/rules.json    # declarativeNetRequest unframe rule
│  └─ demo/                 # Helka ceramics demo app (Vite React), 12 screens, all states
├─ packages/
│  ├─ sdk/                  # @flowcanvas/sdk + adapters
│  ├─ protocol/             # message types + zod schemas shared by all
│  └─ config/               # flowcanvas.config.json schema + migrations
└─ e2e/                     # Playwright tests against apps/demo
```

Add one package for Claude: `packages/mcp` (`@flowcanvas/mcp`), built on the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`) with `ws` for the WebSocket link and `chokidar` to watch the config file for edits made outside the canvas (for example by Claude Code editing the JSON directly). Images on the canvas use IndexedDB through `idb-keyval`.

### Manifest (generated by WXT, shown for review)

```json
{
  "manifest_version": 3,
  "name": "Flow Canvas",
  "permissions": ["storage", "unlimitedStorage", "declarativeNetRequest", "scripting", "tabs"],
  "host_permissions": ["http://localhost/*", "http://127.0.0.1/*", "http://*.localhost/*"],
  "optional_host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    { "matches": ["http://localhost/*", "http://127.0.0.1/*", "http://*.localhost/*"],
      "js": ["bridge.js"], "all_frames": true, "run_at": "document_start" },
    { "matches": ["http://localhost/*", "http://127.0.0.1/*", "http://*.localhost/*"],
      "js": ["mock.js"], "all_frames": true, "run_at": "document_start", "world": "MAIN" }
  ],
  "declarative_net_request": {
    "rule_resources": [{ "id": "unframe", "enabled": true, "path": "rules.json" }]
  },
  "action": { "default_popup": "popup.html" }
}
```

Note: Chrome matches `localhost` host patterns on any port, so `http://localhost/*` covers `:3000`, `:5173` and the rest. Staging hosts go through `optional_host_permissions`, asked for at runtime only when the user adds one.

## Milestones

Eight milestones (M0 to M7), about 13 weeks for one developer with Claude Code. Each one ends with something you can use, so you can stop after any of them and still have a working tool.

&#91;embedded content: Build roadmap · 7 milestones over 11 weeks\]

M1 is the first point where the tool is useful on its own; every milestone after it adds one capability on top.

### M0. Setup (week 1, 3 days)

- [ ] pnpm monorepo, WXT extension, tsup SDK package, shared `protocol` package
- [ ] Demo app `apps/demo`: Vite React, 12 screens in 4 groups (Onboarding, Browse & save, Checkout, Book a class), each screen with hard-coded fixtures for 5 states
- [ ] Playwright harness that launches Chromium with the unpacked extension
- [ ] CI: lint, typecheck, unit tests, e2e on push (GitHub Actions)

* **Gate:** `pnpm dev` opens Chrome with the extension loaded and the demo running on `:5173`

### M1. Live canvas (weeks 1 to 2)

- [ ] Background worker: toolbar click opens `canvas.html?origin=<tab origin>`
- [ ] DNR rule that strips `X-Frame-Options` and `frame-ancestors` for localhost `sub_frame` only
- [ ] React Flow canvas, custom `FrameNode` with device chrome, group nodes as titled bands
- [ ] Hand-written config import (paste or drop a JSON file)
- [ ] Mobile / Desktop toggle and device picker; zoom presets (25, 50, 100%), fit view
- [ ] Live / still switching rule (on screen, zoom 50% or more, max 12 live)
- [ ] Sidebar Flows tree with fly-to

* **Gate:** the 12 demo screens show live on the canvas at 50 fps panning

### M2. Bridge, discovery, recording (weeks 3 to 4)

- [ ] `bridge.content.ts`: handshake, nonce, message router
- [ ] Crawl discovery + Next.js manifest read
- [ ] Record mode: click capture, `data-fc` lookup, short CSS path fallback, edge on URL change (watch `popstate`, `pushState`, `replaceState` patches from MAIN world)
- [ ] Manual edge drawing with handles; edge side panel (label, hint, gesture, target, kind)
- [ ] Selector "Found / Not found" check
- [ ] Undo / redo; unsaved counter; Discard; Save (download `flowcanvas.config.json`)

* **Gate:** record the whole Onboarding flow in under 1 minute with correct labels

### M3. States: SDK and mocks (weeks 5 to 6)

- [ ] `@flowcanvas/sdk` core: `init`, `active`, `state`, `is`, `ready`, `target`
- [ ] React and Next adapters
- [ ] `mock.content.ts` in MAIN world: fetch + XHR wrap, match by method + URL glob, status, body, delay, `forever`
- [ ] Mock record button (save real responses as the starting body)
- [ ] State badges, "Duplicate as new state", state row layout (states of one screen sit in a row, as in the video)
- [ ] Basic JSON mock editor panel

* **Gate:** all 5 Catalog states render via SDK and via mocks; demo has 50+ screen-state frames

### M4. Player and transitions (weeks 7 to 8)

- [ ] Player view with one device frame and two stacked iframes
- [ ] Transition engine: push, pop, sheet-up, sheet-down, fade, none
- [ ] Easing presets + custom cubic-bezier SVG editor with preview
- [ ] Hint arrows for outgoing edges; keyboard arrows; Esc back; restart
- [ ] "Play edge" from the canvas side panel (plays that one edge in a popover)

* **Gate:** play the Checkout flow end to end with no blank flash between screens

### M5. Tokens and screenshots (weeks 9 to 10)

- [ ] Token read from `:root`, type guess, grouped panel, pickers, reset dots
- [ ] Broadcast to all frames; re-capture stills after idle
- [ ] Export JSON (W3C format) and CSS
- [ ] `modern-screenshot` capture queue, "Capturing screenshots n/N", Recapture all
- [ ] HMR watch marks frames dirty

* **Gate:** token change reaches 20 frames in under 200 ms; 31 screens capture in under 20 s

### M6. Sections, images, notes, comments, MCP (weeks 11 to 12)

- [ ] Sections: create from selection, draw tool, nesting, collapse (unloads frames), lock, auto-layout row / grid; config migration `groups` to `sections`
- [ ] Images: drop, paste, URL; crop, resize, opacity, caption; overlay on frame; IndexedDB store
- [ ] Sticky notes: 5 kinds, markdown, attach to frame / edge / section / image
- [ ] Comments: pin on frame, element context capture in bridge, threads, resolve, filters, "For Claude" flag, pins that follow their selector
- [ ] "Copy as prompt" for a thread or a section
- [ ] `packages/mcp`: stdio server on the official MCP TypeScript SDK, WebSocket link with `Origin` check, port scan in canvas, first-connect Allow prompt
- [ ] All tools and resources from feature 11; file as source of truth with live merge; assets written to `.flowcanvas/assets/`
- [ ] Guardrails: one undo step per Claude change, Activity panel, Allow / Deny toast, Pause Claude

* **Gate:** from Claude Code, read all open "For Claude" comments, fix one, reply, and add a note, with every change visible on the canvas and in the file

### M7. Polish and launch (week 13)

- [ ] Onboarding: empty state on first open, 3-step coach marks, sample config
- [ ] Accessibility pass on extension UI (see below)
- [ ] Store listing, privacy policy, screenshots, 60-second demo video
- [ ] SDK on npm, docs site, README with GIF

* **Gate:** Chrome Web Store approval; 5 outside designers test it on their own apps

## Performance, security, accessibility

### Performance budget

| Measure | Budget | How we hold it |
| --- | --- | --- |
| Live frames at once | 12 max | Live / still rule; least recently seen frame goes still first |
| Pan / zoom | 50 fps or more with 30 frames | One transform on the canvas layer; stills are `<img>` with `decoding="async"`; live frames get `content-visibility: auto` |
| Memory | Under 1.5 GB for the canvas tab | Unload iframes that are still (set `src="about:blank"`), keep the screenshot |
| Token broadcast | Under 200 ms to 20 frames | One `postMessage` per frame, batched with `requestAnimationFrame` |
| Screenshot queue | 3 at once, idle-time only | `requestIdleCallback` in each frame |
| Extension size | Under 1.5 MB | No big libraries in content scripts; bridge under 15 KB |

### Security and privacy

- **Header stripping is scoped.** The DNR rule only touches `sub_frame` requests to localhost hosts. Top-level pages and all other sites keep their headers.
- **Message checks.** The canvas only accepts messages whose `event.origin` equals the project origin AND that carry the session nonce. The bridge only accepts messages from `chrome-extension://<our id>`.
- **No network.** The extension makes no calls out. No analytics in v1. Store listing says "Does not collect user data".
- **MAIN world script is passive.** `mock.js` does nothing unless the URL has `fc-frame` AND the parent is our canvas. A normal localhost tab is never changed.
- **Clicks in record mode are real.** A recorded click on "Delete account" really deletes it in the dev database. Show a warning on first record, and skip auto-crawl on links matching `delete|logout|signout|remove`.
- **PDPL note.** Screenshots may hold real user data from a dev database. They stay in local storage only, never leave the machine, and "Clear all screenshots" is one click in settings. This keeps the tool in line with Saudi PDPL data minimization when teams use real-looking data.

* **MCP link is local and checked.** The server binds to `127.0.0.1` only, accepts only the extension's `Origin`, and asks once per project before Claude can write. Pause Claude blocks every write tool.
* **Comments carry page HTML.** Element context is cut to 2 KB and skips `input` values and anything inside `[data-fc-private]`, so passwords and personal data typed in dev forms never reach Claude.

### Accessibility of the extension UI (WCAG 2.2 AA)

- Every canvas action has a keyboard path: Tab moves between frames in reading order (group, then position), Enter opens the frame menu, E starts an edge from the focused frame, arrow keys nudge by 8 px. This covers SC 2.1.1 Keyboard and SC 2.5.7 Dragging Movements (every drag has a non-drag option).
- Focus ring 2 px with 3:1 contrast against the canvas (SC 2.4.11 Focus Not Obscured, SC 1.4.11 Non-text Contrast). Side panels never cover the focused frame.
- Edge kind is not shown by color alone: happy = solid, error = red + dashed-dot + "error" in the pill, alternate = dashed (SC 1.4.1 Use of Color).
- Targets at least 24 by 24 px for all toolbar and panel controls (SC 2.5.8 Target Size Minimum).
- `prefers-reduced-motion`: Player swaps screens with a 120 ms fade instead of slides, and camera fly-to jumps instead of animating (SC 2.3.3, a AAA rule, but cheap to meet).
- Screen readers: the canvas has `role="application"` with a live region that announces "Catalog, empty state, 3 of 12" on focus change.
- Arabic / RTL: all panel text through `i18n` messages; layout uses logical CSS properties so an Arabic UI flips cleanly. Frames themselves show the app as it is (RTL apps render RTL).

## Testing and QA

The demo app is the test bed: every feature is checked against it in CI, then by hand on 3 real apps before each milestone gate.

| Layer | Tool | What it covers | Runs |
| --- | --- | --- | --- |
| Unit | Vitest | Config schema + migrations, edge routing math, easing math, mock URL matching, token type guess | Every push |
| Protocol | Vitest | Every message type round-trips through zod; bad nonce and wrong origin are dropped | Every push |
| SDK | Vitest + jsdom | `active` is false outside canvas; handshake timeout; production strip | Every push |
| E2E | Playwright, Chromium with unpacked extension | Open canvas, discover, record 3 edges, force 5 states, play a flow, change a token, export config | Every push (headed in CI via `xvfb`) |
| Visual | Playwright screenshots | Frame chrome, edge pills, panels, light and dark | Nightly |
| Perf | Playwright + `performance.measure` | Pan fps with 30 frames, token broadcast time, capture time | Nightly, fails if over budget |
| Real apps | Manual | Next.js App Router app, Vite React + React Router, Nuxt 3, an Arabic RTL app | Each milestone gate |
| Accessibility | axe-core in Playwright + manual keyboard and VoiceOver pass | Extension UI only | Each milestone gate |

MCP tests: Vitest runs every tool against a fixture config through the MCP SDK's in-memory client and server pair; one Playwright test starts the server over stdio, opens the canvas, and checks that `add_edge`, `reply_comment` and `add_image` show up on screen within 2 seconds.

### Manual test script (per gate)

1. Fresh Chrome profile, load unpacked, open demo.
2. Discover: count found screens against the real route list.
3. Record Onboarding; check labels and selectors.
4. Force all states on Catalog via SDK, then remove the SDK and repeat via mocks.
5. Player: run each group's flow; watch for blank flashes.
6. Tokens: change bg, radius, font; export CSS; paste into the app; reload; compare.
7. Close the tab, reopen: everything restored.
8. Repeat 1 to 7 on one outside app with no SDK.

## Risks and mitigations

The two biggest risks are memory with many live frames and apps whose data is not reachable by our fetch wrap. Both have a planned fallback, and both are tested from M1 and M3.

| Risk | Likely | Impact | Mitigation | Fallback |
| --- | --- | --- | --- | --- |
| Too many live iframes crash or slow the tab | High | High | Live / still rule, max 12 live, unload stills | Lower max to 6 on low-memory machines (`navigator.deviceMemory`) |
| Data fetched in ways the mock layer cannot see (GraphQL over WebSocket, server components, Service Workers) | Medium | High | SDK path is the main path; MSW adapter | Document: "no SDK = default state only" for these apps |
| Next.js server components render data on the server | High (Next apps) | Medium | SDK reads `fc-state` from search params in server code too (`searchParams['fc-state']`) | Mock at the API route level via MSW node |
| Auth: frames show the login page | Medium | Medium | Frames share cookies with the user's tab; log in once in a normal tab | "Login first" banner when 3+ frames land on the same URL |
| App blocks framing in JS (`if (top !== self) top.location = ...`) | Low | High | MAIN world script pins `window.top` checks in canvas frames only | Open in a separate small window per frame (slow) |
| Store review rejects header stripping | Low | High | Localhost-only scope, clear purpose in listing, no remote code | Ship as unpacked + Edge Add-ons; ask for review appeal |
| `modern-screenshot` misses webfonts, canvas, video | Medium | Low | Wait for `document.fonts.ready`; inline fonts | `captureVisibleTab` in a hidden window |
| HMR reloads frames and loses forced state | Medium | Low | State is in the URL, so a reload keeps it | None needed |
| Chrome changes MV3 rules for MAIN world scripts | Low | Medium | Use `chrome.scripting.registerContentScripts` as a second path | Inject via the SDK only |
| Scope creep into a full prototyping tool | High | Medium | Out list in Scope is a contract; v1.x list for the rest | Cut M5 tokens to v1.1 if late |

Added with MCP, sections and images:

- **Claude and the user edit the same item at once.** Last write wins per field, and the canvas shows "Changed by Claude" for 3 seconds on that item.
- **Repo bloat from images.** WebP at 2560 px max, hash names so the same image is stored once, and a `.flowcanvas/assets` size warning at 50 MB.
- **The client ignores change notices.** Keep the pull path ("check my canvas comments") as the main path; the notice is a bonus.

## Distribution and launch

Ship the extension free on the Chrome Web Store and the SDK as MIT on npm. Decide on a paid tier only after 500 weekly users.

| Channel | What ships | When |
| --- | --- | --- |
| Chrome Web Store | Extension, unlisted first, then public | Unlisted at M4, public at M7 |
| Edge Add-ons | Same build | M7 |
| npm | `@flowcanvas/sdk` + adapters | SDK beta at M3; SDK and @flowcanvas/mcp 1.0 at M7 |
| GitHub | Monorepo, MIT, demo app, issue templates | Public at M7 |
| Docs site | Getting started, SDK API, config schema, recipes per framework | M7 |
| Launch posts | 60 s video, X / LinkedIn thread, Product Hunt, r/webdev, Designer News | Week after M7 |

Possible paid tier later (v2): shared canvases for a team, hosted Player links for stakeholders, Figma variables sync, flow coverage reports in CI.

## Open decisions

- [ ] **Name.** "Flow Canvas" is a working name; "Floow" in the reference video is taken by that product. Check store and npm before M6.
- [ ] **Canvas library.** React Flow (my pick: nodes and edges are the core shape here) or tldraw (better freeform, license terms to check for commercial use).
- [ ] **First target app.** Which of your real projects is the first outside test: Almosafer eSIM funnel, Eyvar Rider, or maherfayad.com?
- [ ] **Merge with Mock Lab and Redline.** Build the mock layer once and share it with Mock Lab; add Redline's "click an element, send it to Claude" as a canvas layer in v1.x. Yes or keep them separate?
- [ ] **Open source or closed.** MIT for all (fast trust, more contributors) or MIT SDK + closed extension (keeps a paid path).

* [ ] **MCP scope.** Should Claude be allowed to edit the app's source code from a comment (Redline style), or only the canvas and config? My pick for v1: canvas and config only; Claude Code already edits source on its own.
* [ ] **Image storage.** Commit `.flowcanvas/assets/` to git (team sees everything) or gitignore it (repo stays light).
