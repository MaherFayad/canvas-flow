# MCP tools reference

Generated from `@flowcanvas/mcp` 0.1.0 by `scripts/gen-mcp-docs.mjs` (do not edit by hand). Setup: [getting started](./getting-started.md#4-connect-claude-optional).

26 tools. "Canvas" means the Flow Canvas tab must be open and linked; every other tool works on `flowcanvas.config.json` alone. While **Pause Claude** is on, write tools fail. `delete_items` and `set_tokens` with more than 10 variables ask for Allow on the canvas when it is open.

| Tool | Needs canvas | Kind | What it does |
| --- | --- | --- | --- |
| [`get_project`](#get_project) | No | read | Overview of the Flow Canvas project: name, origin, devices, sections (with item counts), screens with their states, and counts of edges, images, notes and comments (open, and open "For Claude") |
| [`list_screens`](#list_screens) | No | read | List screens with path, section, states (first is the default) and canvas position |
| [`add_screen`](#add_screen) | No | write | Add a screen (one route of the app) to the canvas. id is kebab-case and stable because edges point at it; it defaults to the kebab-case title. path is the app route starting with "/". states lists the states to show side by side; the first is the default |
| [`update_screen`](#update_screen) | No | write | Change a screen's title, path, section, states (full list, first = default) or position |
| [`add_state`](#add_state) | No | write | Add a state (e.g. "error", "empty", "missing-email") to a screen |
| [`list_edges`](#list_edges) | No | read | List flow edges (screen state → screen state) with trigger, transition and kind |
| [`add_edge`](#add_edge) | No | write | Draw a flow edge from one screen state to another. trigger: label (button text), gesture (tap, long-press, swipe-*, submit, auto-after-ms), target (CSS selector, prefer [data-fc="…"]), hint. transition: type (push, pop, sheet-up, sheet-down, fade, none), duration ms, easing (CSS or preset). kind: happy (solid), error (red), alternate (dashed) |
| [`update_edge`](#update_edge) | No | write | Change an edge. trigger and transition fields are merged into the existing ones (pass only what changes) |
| [`delete_items`](#delete_items) | No | write (destructive) | Delete screens, edges, sections, images, notes or comments by id |
| [`create_section`](#create_section) | No | write | Create a named section (a titled area that holds screens, images, notes and other sections; nesting up to 3 levels). itemIds are moved into it: screen, image and note ids get section = this id, section ids get parent = this id |
| [`update_section`](#update_section) | No | write | Rename a section, change its layout, color, parent, rect, collapsed or locked flag, move items into it (itemIds) or out of it to its parent (removeItemIds) |
| [`add_image`](#add_image) | No | write | Put an image on the canvas from a local file path (absolute or relative to the project) or an http(s) URL |
| [`list_images`](#list_images) | No | read | List images on the canvas with captions, file paths (relative to the project; read them to see the image), rect, overlay and section |
| [`add_note`](#add_note) | No | write | Leave a sticky note on the canvas (markdown text). kind: note, question, issue, decision or idea. attachTo pins it to a frame (screen id or "<screenId>:<state>"), edge, section or image so it moves with it |
| [`update_note`](#update_note) | No | write | Edit a sticky note: text, kind, attachTo (null to detach), rect or section |
| [`list_notes`](#list_notes) | No | read | List sticky notes with kind, text, author and what each is attached to (with the item's title) |
| [`list_comments`](#list_comments) | No | read | List comment threads pinned on frames, with the element under the pin (CSS selector, tag, text, trimmed HTML, key styles) so you know exactly what the user means |
| [`reply_comment`](#reply_comment) | No | write | Reply in a comment thread as Claude |
| [`resolve_comment`](#resolve_comment) | No | write | Mark a comment thread resolved, with an optional closing reply from Claude |
| [`get_tokens`](#get_tokens) | Yes | read | Design tokens (CSS custom properties on :root) read live from the app: base values with type (color, length, number, font, other) plus the overrides saved in the project |
| [`set_tokens`](#set_tokens) | Yes | write | Override design tokens, e.g. {"--color-bg":"#FFF8F0","--radius-md":"16px"}; null removes an override |
| [`get_screenshot`](#get_screenshot) | Yes | read | Screenshot of one screen in one state (WebP image) |
| [`check_target`](#check_target) | Yes | read | Check whether a CSS selector (an edge trigger target) exists on a screen in a given state, inside the live app |
| [`play_flow`](#play_flow) | Yes | read | Play a flow in the canvas Player: all edges of a section (sectionId) or a list of edges (edgeIds), tapping each trigger target in the live app |
| [`focus`](#focus) | Yes | read | Move the canvas camera to an item so the user sees it: a screen id, a frame "<screenId>:<state>", or an edge, section, image, note or comment id |
| [`get_selection`](#get_selection) | Yes | read | What the user has selected on the canvas right now (ids and types), with the full items from the config |

## get_project

Overview of the Flow Canvas project: name, origin, devices, sections (with item counts), screens with their states, and counts of edges, images, notes and comments (open, and open "For Claude"). Also says whether the canvas tab is linked and whether Claude is paused. Start here. Works without the canvas.

Input: none.

## list_screens

List screens with path, section, states (first is the default) and canvas position. Filter by section id (includes nested sections). Works without the canvas.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `section` | string |  | Section id; omit for all screens |

## add_screen

Add a screen (one route of the app) to the canvas. id is kebab-case and stable because edges point at it; it defaults to the kebab-case title. path is the app route starting with "/". states lists the states to show side by side; the first is the default. Returns the screen.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | yes |  |
| `path` | string | yes | App route, e.g. /catalog |
| `id` | string |  | kebab-case id; default from title |
| `section` | string \| null |  | Section id to put it in |
| `states` | string[] |  | Default ["default"] |
| `position` | { x, y } |  | Canvas position; omit to let the canvas lay it out |

## update_screen

Change a screen's title, path, section, states (full list, first = default) or position. Removing a state that edges use is rejected; delete those edges first. Returns the screen.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `title` | string |  |  |
| `path` | string |  |  |
| `section` | string \| null |  | Section id, or null for none |
| `states` | string[] |  |  |
| `position` | { x, y } |  |  |

## add_state

Add a state (e.g. "error", "empty", "missing-email") to a screen. Optional mocks are fetch/XHR mock rules used when the app has no SDK: [{match:{method,url},status,body,delay}] where url is a glob and delay "forever" means never answer (loading). If the state already exists, only its mocks are replaced. Returns the state and its frame key "<screenId>:<state>".

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `screenId` | string | yes |  |
| `name` | string | yes |  |
| `mocks` | { match, status, body, headers, delay }[] |  |  |

## list_edges

List flow edges (screen state → screen state) with trigger, transition and kind. Filter by a screen id to get its incoming and outgoing edges. Works without the canvas.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `screenId` | string |  |  |

## add_edge

Draw a flow edge from one screen state to another. trigger: label (button text), gesture (tap, long-press, swipe-*, submit, auto-after-ms), target (CSS selector, prefer [data-fc="…"]), hint. transition: type (push, pop, sheet-up, sheet-down, fade, none), duration ms, easing (CSS or preset). kind: happy (solid), error (red), alternate (dashed). Both ends must be existing screens and states. Returns the edge and its id.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | { screen, state } | yes |  |
| `to` | { screen, state } | yes |  |
| `trigger` | { label, hint, gesture, target, afterMs } |  |  |
| `transition` | { type, duration, easing } |  |  |
| `kind` | "happy" \| "error" \| "alternate" |  |  |
| `id` | string |  | Optional id; generated when omitted |

## update_edge

Change an edge. trigger and transition fields are merged into the existing ones (pass only what changes). Returns the edge.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `from` | { screen, state } |  |  |
| `to` | { screen, state } |  |  |
| `trigger` | { label, hint, gesture, target, afterMs } |  |  |
| `transition` | { type, duration, easing } |  |  |
| `kind` | "happy" \| "error" \| "alternate" |  |  |

## delete_items

Delete screens, edges, sections, images, notes or comments by id. Deleting a screen also deletes its edges and mocks; deleting a section moves its contents to the parent section (nothing inside is deleted); notes attached to deleted items are detached. When the canvas is open the user must Allow the delete; if they deny, nothing changes. Returns the deleted count and ids.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ids` | string[] | yes |  |

## create_section

Create a named section (a titled area that holds screens, images, notes and other sections; nesting up to 3 levels). itemIds are moved into it: screen, image and note ids get section = this id, section ids get parent = this id. Returns the section and its id.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `itemIds` | string[] |  |  |
| `id` | string |  | Optional id; default kebab-case name |
| `collapsed` | boolean |  |  |
| `layout` | "free" \| "row" \| "grid" |  | row = states side by side; grid = 3 per row |
| `color` | "grey" \| "blue" \| "green" \| "amber" \| "red" \| "purple" |  |  |
| `parent` | string \| null |  | Parent section id (nesting up to 3 levels) |
| `rect` | { x, y, w, h } |  |  |

## update_section

Rename a section, change its layout, color, parent, rect, collapsed or locked flag, move items into it (itemIds) or out of it to its parent (removeItemIds). Returns the section.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `name` | string |  |  |
| `itemIds` | string[] |  | Items to move into this section |
| `removeItemIds` | string[] |  | Items to move out to the parent section |
| `collapsed` | boolean |  |  |
| `locked` | boolean |  |  |
| `layout` | "free" \| "row" \| "grid" |  | row = states side by side; grid = 3 per row |
| `color` | "grey" \| "blue" \| "green" \| "amber" \| "red" \| "purple" |  |  |
| `parent` | string \| null |  | Parent section id (nesting up to 3 levels) |
| `rect` | { x, y, w, h } |  |  |

## add_image

Put an image on the canvas from a local file path (absolute or relative to the project) or an http(s) URL. The file is copied to .flowcanvas/assets/<hash>.<ext> in the project (same image stored once) and the relative path is saved. Use for Figma exports, reference shots or competitor screens. overlayOn pins it over a frame ("<screenId>:<state>") at 50% opacity to compare design and build. Size defaults to the image's pixel size. Returns the image and its id.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string |  | Local image file |
| `url` | string |  | http(s) image URL to download |
| `x` | number | yes |  |
| `y` | number | yes |  |
| `w` | number |  |  |
| `h` | number |  |  |
| `caption` | string |  |  |
| `section` | string \| null |  |  |
| `overlayOn` | string |  | Frame key "<screenId>:<state>" to overlay |
| `overlayOpacity` | number |  |  |

## list_images

List images on the canvas with captions, file paths (relative to the project; read them to see the image), rect, overlay and section. Filter by section id. Works without the canvas.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `section` | string |  |  |

## add_note

Leave a sticky note on the canvas (markdown text). kind: note, question, issue, decision or idea. attachTo pins it to a frame (screen id or "<screenId>:<state>"), edge, section or image so it moves with it. Use it to explain a change or a decision. Returns the note and its id.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `text` | string | yes |  |
| `kind` | "note" \| "question" \| "issue" \| "decision" \| "idea" |  |  |
| `attachTo` | { type, id } |  |  |
| `rect` | { x, y, w, h } |  | Default 220×120 near the attached item |
| `section` | string \| null |  |  |

## update_note

Edit a sticky note: text, kind, attachTo (null to detach), rect or section. Returns the note.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `text` | string |  |  |
| `kind` | "note" \| "question" \| "issue" \| "decision" \| "idea" |  |  |
| `attachTo` | { type, id } \| null |  |  |
| `rect` | { x, y, w, h } |  |  |
| `section` | string \| null |  |  |

## list_notes

List sticky notes with kind, text, author and what each is attached to (with the item's title). Filter by section id and/or kind. Works without the canvas.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `section` | string |  |  |
| `kind` | "note" \| "question" \| "issue" \| "decision" \| "idea" |  |  |

## list_comments

List comment threads pinned on frames, with the element under the pin (CSS selector, tag, text, trimmed HTML, key styles) so you know exactly what the user means. Filter by status (open, resolved) and to ("claude" = flagged "For Claude", "team"). To work through feedback: list_comments {status:"open", to:"claude"}, make the change, then reply_comment with what changed. Works without the canvas.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | "open" \| "resolved" |  |  |
| `to` | "claude" \| "team" |  |  |
| `screenId` | string |  |  |

## reply_comment

Reply in a comment thread as Claude. Say what you changed; list the ids of items you added or changed in changes (e.g. ["e9"]) so the canvas links them. Set resolve true to also resolve the thread. Returns the thread.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `threadId` | string | yes |  |
| `text` | string | yes |  |
| `changes` | string[] |  |  |
| `resolve` | boolean |  |  |

## resolve_comment

Mark a comment thread resolved, with an optional closing reply from Claude. Set reopen true to reopen it instead. Returns the thread.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `threadId` | string | yes |  |
| `text` | string |  |  |
| `reopen` | boolean |  |  |

## get_tokens

Design tokens (CSS custom properties on :root) read live from the app: base values with type (color, length, number, font, other) plus the overrides saved in the project. Needs the Flow Canvas tab open.

Input: none.

## set_tokens

Override design tokens, e.g. {"--color-bg":"#FFF8F0","--radius-md":"16px"}; null removes an override. Every frame updates live and the overrides are saved to tokens in the config. Changing more than 10 variables asks the user to Allow on the canvas. Needs the Flow Canvas tab open. Returns all overrides.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `vars` | object | yes | CSS variable name (starting with --) → value, or null to reset |

## get_screenshot

Screenshot of one screen in one state (WebP image). Uses the live canvas when it is open, otherwise the last cached still in .flowcanvas/cache/. device is a device id from get_project (default: the canvas's current device).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `screenId` | string | yes |  |
| `state` | string |  | default `"default"` |
| `device` | string |  |  |

## check_target

Check whether a CSS selector (an edge trigger target) exists on a screen in a given state, inside the live app. Returns found, how many match, and its size and position. Needs the Flow Canvas tab open.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `screenId` | string | yes |  |
| `state` | string |  | default `"default"` |
| `selector` | string | yes |  |
| `device` | string |  |  |

## play_flow

Play a flow in the canvas Player: all edges of a section (sectionId) or a list of edges (edgeIds), tapping each trigger target in the live app. Returns pass plus the steps that failed and why. Needs the Flow Canvas tab open.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `sectionId` | string |  |  |
| `edgeIds` | string[] |  |  |

## focus

Move the canvas camera to an item so the user sees it: a screen id, a frame "<screenId>:<state>", or an edge, section, image, note or comment id. Needs the Flow Canvas tab open.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `itemId` | string | yes |  |

## get_selection

What the user has selected on the canvas right now (ids and types), with the full items from the config. Use when the user says "this" or "these". Needs the Flow Canvas tab open.

Input: none.

## Resources

- `flowcanvas://project`: The whole flowcanvas.config.json: sections, screens, states, edges, mocks, tokens, images, notes and comments.
- `flowcanvas://comments`: All comment threads with element context. Filter with ?status=open\|resolved&to=claude\|team.
- `flowcanvas://notes`: All sticky notes with kind, text, author and attachment.
- `flowcanvas://comments?status=open&to=claude`: Comment threads filtered by status (open, resolved) and to (claude, team). flowcanvas://comments?status=open&to=claude lists the feedback waiting for Claude.
- `flowcanvas://comments{?status,to}`: Comment threads filtered by status (open, resolved) and to (claude, team). flowcanvas://comments?status=open&to=claude lists the feedback waiting for Claude.
- `flowcanvas://screens/{id}/{state}/screenshot`: WebP screenshot of a screen state: live from the canvas, or the last cached still.
- `flowcanvas://images/{id}`: An image placed on the canvas (file from .flowcanvas/assets/).
