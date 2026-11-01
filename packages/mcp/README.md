# @flowcanvas/mcp

Local MCP server that lets Claude read and edit a Flow Canvas project: screens, states, edges, transitions, tokens, sections, images, sticky notes and comments. The project's `flowcanvas.config.json` is the single source of truth; the open Flow Canvas tab links to the server over a local WebSocket and merges every change live.

## Setup

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

Options:

| Flag | Meaning |
| --- | --- |
| `--project <dir>` | Folder holding `flowcanvas.config.json` (default: current folder). The file is created on the first write. |
| `--extension-id <id>` | Accept the canvas only from `chrome-extension://<id>`. Without it any `chrome-extension://` origin is accepted, with a warning. |
| `--origin <url>` | App origin for a new config (default `http://localhost:5173`). |
| `--no-link` | Do not open the canvas WebSocket (file-backed tools only). |

stdout is the MCP stdio channel; all logs go to stderr.

## Tools

File-backed (work with no canvas open): `get_project`, `list_screens`, `add_screen`, `update_screen`, `add_state`, `list_edges`, `add_edge`, `update_edge`, `delete_items`, `create_section`, `update_section`, `add_image`, `list_images`, `add_note`, `update_note`, `list_notes`, `list_comments`, `reply_comment`, `resolve_comment`.

Canvas tab required: `get_tokens`, `set_tokens`, `check_target`, `play_flow`, `focus`, `get_selection`. `get_screenshot` falls back to the cached still at `.flowcanvas/cache/<screen>-<state>-<device>.webp`.

Every write is validated with `parseConfig` from `@flowcanvas/config` and written atomically (temp file + rename); an invalid change is rejected with the reasons and the file is left untouched. `add_image` copies the file (or downloads the URL) to `.flowcanvas/assets/<sha256-prefix>.<ext>`, so the same image is stored once.

Guardrails: while **Pause Claude** is on, every write tool fails with a clear message. `delete_items`, and `set_tokens` with more than 10 variables, ask the user to Allow on the canvas when it is open.

## Resources

- `flowcanvas://project` — the whole config
- `flowcanvas://comments`, `flowcanvas://comments?status=open&to=claude` (any mix of `status` / `to`)
- `flowcanvas://notes`
- `flowcanvas://screens/{id}/{state}/screenshot`
- `flowcanvas://images/{id}`

When the comments change (from Claude, the canvas or an outside edit of the file) and there are open "For Claude" comments, the server sends `notifications/resources/updated` for `flowcanvas://comments` and `flowcanvas://comments?status=open&to=claude` (plus any other subscribed comments URI).

## Canvas link protocol

The server listens on `ws://127.0.0.1:<port>`, first free port from 47800 to 47809 (`MCP_PORT_MIN..MCP_PORT_MAX` in `@flowcanvas/protocol`). The upgrade is refused (403) unless `Origin` is `chrome-extension://<id>`; a second canvas gets 409 while one is linked. Messages are JSON objects with a `type`; zod schemas and types are exported from this package (and, without the Node server, from the `@flowcanvas/mcp/link-protocol` subpath) (`ServerToCanvasSchema`, `CanvasToServerSchema`, `CanvasParamsSchemas`, `CanvasResultSchemas`, `parseServerMessage`).

| Direction | `type` | Fields | Notes |
| --- | --- | --- | --- |
| server → canvas | `hello` | `v`, `project` (abs dir), `origin`, `name`, `serverVersion` | First message. The canvas closes the socket if `origin` is not its project. |
| canvas → server | `hello` | `extensionVersion`, `v?` | |
| canvas → server | `allow` | `granted` | Answer to "Claude wants to connect to …". Canvas-only tools and canvas sync start only after `granted: true`. |
| canvas → server | `pause` | `paused` | Pause Claude switch. Send on connect and on change. Stays on after a disconnect. |
| server → canvas | `config` | `config` | Full sync: after `allow`, and when the file changed outside. |
| server → canvas | `patch` | `label`, `config` | One Claude change = one undo step, labelled `Claude: <summary>`. |
| canvas → server | `config` | `config` | Canvas edits. Debounced 500 ms, validated, written. Not echoed back. |
| server → canvas | `error` | `message`, `errors?` | e.g. an invalid canvas config was not saved. |
| server → canvas | `request` | `id`, `method`, `params` | `get_tokens`, `set_tokens`, `get_screenshot`, `check_target`, `play_flow`, `focus`, `get_selection`, `confirm`. |
| canvas → server | `response` | `id`, `ok`, `result?`, `error?` | `result` must match `CanvasResultSchemas[method]`. |
| server → canvas | `activity` | `tool`, `ok`, `summary`, `at` | One row per tool call, for the Activity panel. |
| canvas → server | `asset-put` | `id`, `data` (base64) | Store an image dropped on the canvas as `.flowcanvas/assets/<hash>.<ext>`. After Allow only. |
| canvas → server | `asset-get` | `id`, `file` | Read an image under `.flowcanvas/assets/` (e.g. one added with `add_image`). After Allow only. |
| server → canvas | `asset-result` | `id`, `ok`, `file?`, `mime?`, `data?`, `error?` | Answer to `asset-put` (`file`) or `asset-get` (`file`, `mime`, base64 `data`). |

Request methods:

| Method | Params | Result |
| --- | --- | --- |
| `get_tokens` | `{}` | `{ base: Token[], overrides }` |
| `set_tokens` | `{ vars: Record<name, value \| null> }` | `{ applied: string[], unknown: string[] }` (live preview; the saved overrides arrive as a `patch`) |
| `get_screenshot` | `{ screenId, state, device? }` | `{ webp: dataURL or base64, device? }` |
| `check_target` | `{ screenId, state, selector, device? }` | `{ found, rect \| null, count? }` |
| `play_flow` | `{ sectionId? , edgeIds? }` | `{ pass, steps: [{ edgeId, ok, error? }] }` |
| `focus` | `{ itemId }` | `{ ok }` |
| `get_selection` | `{}` | `{ ids, items? }` |
| `confirm` | `{ action: 'delete' \| 'set_tokens', message, ids?, count? }` | `{ allowed }` |

## Development

```bash
pnpm --filter @flowcanvas/mcp build typecheck test
```
