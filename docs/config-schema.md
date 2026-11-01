# `flowcanvas.config.json` reference (v1)

One JSON file per project, in the repo root, so flows are reviewed in pull requests like code. The source of truth is `ConfigSchema` in `@flowcanvas/config` (zod); [schema/v1.json](./schema/v1.json) is the JSON Schema generated from it (a test keeps the two in sync; regenerate with `UPDATE_SCHEMA=1 pnpm --filter @flowcanvas/config test`).

Point your editor at it for completion and checks:

```json
{ "$schema": "https://flowcanvas.dev/schema/v1.json", "version": 1, "project": { "name": "Helka ceramics", "origin": "http://localhost:5173" } }
```

Only `version` and `project` are required; every other field has a default. Unknown keys are ignored. Older files are migrated on load (`groups` → `sections`, `screens[].group` → `screens[].section`). Besides the schema, loading checks references: screen ids are unique, `screens[].section` and `sections[].parent` exist, sections nest at most 3 levels, and both ends of every edge are known screens.

## Top level

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `$schema` | string | | Optional; editors use it. |
| `version` | `1` | required | |
| `project` | `{ name, origin }` | required | `origin` is a URL such as `http://localhost:3000`. |
| `devices` | Device[] | 4 presets | iPhone 16 Pro Max, iPhone 16, Pixel 9, Desktop. |
| `sections` | Section[] | `[]` | Titled areas that hold screens, images and notes. |
| `screens` | Screen[] | `[]` | |
| `edges` | Edge[] | `[]` | |
| `mocks` | `{ "<screenId>:<state>": MockRule[] }` | `{}` | For apps without the SDK: answers `fetch` / XHR in that frame. |
| `tokens` | `{ "--name": "value" }` | `{}` | Overrides only; base values are read live from the app. |
| `images` | Image[] | `[]` | |
| `notes` | Note[] | `[]` | Sticky notes. |
| `comments` | Comment[] | `[]` | Pinned comment threads. |

## Device

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | | |
| `label` | string | | |
| `w`, `h` | positive integer | | CSS pixels; the frame's iframe gets exactly this viewport. |
| `dpr` | positive number | `2` | |
| `chrome` | `"ios"` \| `"android"` \| `"none"` | `"none"` | Device frame drawn around the screen. `none` = desktop. |

## Section

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id`, `title` | string | | |
| `parent` | string \| null | `null` | Section id; nesting up to 3 levels. |
| `color` | `grey` `blue` `green` `amber` `red` `purple` | `grey` | |
| `rect` | `{ x, y, w, h }` | | Free layout only. |
| `layout` | `free` \| `row` \| `grid` | `free` | |
| `collapsed`, `locked` | boolean | `false` | A collapsed section unloads its frames. |
| `order` | number | `0` | Row order in the Player and Canvas. |

## Screen

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | kebab-case string | | Unique and stable: edges point at it. |
| `title` | string | | |
| `section` | string \| null | `null` | |
| `path` | string starting with `/` | | App route; may carry a query. |
| `states` | string[] (min 1) | `["default"]` | First is the default. Free text; `default`, `loading`, `empty`, `partial`, `error`, `success` get coloured badges. |
| `position` | `{ x, y }` | | Canvas position; omit to auto-layout. |

## Edge

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | | |
| `from`, `to` | `{ screen, state }` | `state: "default"` | |
| `trigger.label` | string | `""` | Text on the control. |
| `trigger.hint` | string | | Shown on the Player arrow. |
| `trigger.gesture` | `tap` `long-press` `swipe-left` `swipe-right` `swipe-up` `swipe-down` `submit` `auto-after-ms` | `tap` | |
| `trigger.target` | CSS selector | | Prefer `[data-fc="…"]`: it survives refactors. |
| `trigger.afterMs` | number | | For `auto-after-ms`. |
| `transition.type` | `push` `pop` `sheet-up` `sheet-down` `fade` `none` | `push` | |
| `transition.duration` | number ≥ 0 (ms) | `240` | |
| `transition.easing` | CSS easing | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Presets: linear, ease, ease-in-out, ease-out, snappy, emphasized `cubic-bezier(0.3, 0, 0, 1)`, sheet `cubic-bezier(0.32, 0.72, 0, 1)`, overshoot `cubic-bezier(0.34, 1.56, 0.64, 1)`. |
| `kind` | `happy` \| `error` \| `alternate` | `happy` | Drawn solid, red dash-dot with "error", dashed. |

## MockRule

```json
{ "match": { "method": "GET", "url": "/api/products*" }, "status": 200, "body": { "items": [] }, "headers": { "x-a": "1" }, "delay": 300 }
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `match.method` | string | `GET` | Case-insensitive. |
| `match.url` | glob | | `*` matches any run of characters; matched against the full URL, path + query, or path. |
| `status` | integer 100 to 599 | `200` | |
| `body` | any JSON | | Sent as JSON. |
| `headers` | `{ name: value }` | | |
| `delay` | ms \| `"forever"` | | `"forever"` never answers (loading state). |

The first matching rule for the frame's `<screenId>:<state>` wins; unmatched requests go to the network.

## Image

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | | |
| `file` | string | | Path relative to the project, under `.flowcanvas/assets/` (content-hash names). |
| `url` | string | | When not stored as a file. |
| `caption` | string | | |
| `rect` | `{ x, y, w, h }` | | |
| `crop` | rect \| null | `null` | |
| `opacity` | 0 to 1 | `1` | |
| `overlay` | `{ frame, opacity }` \| null | `null` | Lay the image over a frame (`"<screenId>:<state>"`) to compare with a design. |
| `section` | string \| null | `null` | |

## Note

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id`, `text` | string | | Markdown text. |
| `kind` | `note` `question` `issue` `decision` `idea` | `note` | |
| `attachTo` | `{ type: frame \| edge \| section \| image, id }` \| null | `null` | |
| `rect` | `{ x, y, w, h }` | | |
| `section` | string \| null | `null` | |
| `author` | string | `me` | `claude` for notes left through MCP. |
| `createdAt` | ISO date string | | |

## Comment

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | | |
| `status` | `open` \| `resolved` | `open` | |
| `to` | `claude` \| `team` \| null | `null` | `claude` marks it "For Claude". |
| `anchor.frame` | string | | `"<screenId>:<state>"`. |
| `anchor.device` | string | | |
| `anchor.x`, `anchor.y` | 0 to 1 | | Pin position within the frame. |
| `anchor.element` | element context \| null | `null` | `selector`, `tag`, `text`, `rect`, `html` (max 2 KB; input values and `[data-fc-private]` are skipped), `styles`. |
| `thread` | `{ author, text, at, changes? }[]` (min 1) | | |
