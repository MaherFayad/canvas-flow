# Changelog

All notable changes to the published packages and the extension. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/). Nothing has been published yet.

## [Unreleased]

### Added

- **Extension** (`apps/extension`, 0.1.0): Chrome MV3 canvas for localhost apps. Live frames at device sizes with the live/still rule (12 live max), Player and Canvas views, crawl and SDK discovery, record mode (click + navigation → edge, one undo step each), edge inspector with transitions and easing, fetch/XHR mock layer per state for apps without the SDK, Tokens panel streaming CSS variables to every live frame, config import and download, working copy per origin. Header stripping (`X-Frame-Options`, `frame-ancestors`) scoped to localhost `sub_frame` requests.
- **`@flowcanvas/sdk`** 0.1.0: `fc.init / active / state / is / ready / target / on`, under 2 KB gzipped. Adapters `/react`, `/next`, `/vue`, `/msw`, and the new `/vite` plugin (`fcTarget` → `data-fc` via the TypeScript parser; no-op SDK in production builds). `./prod` no-op entry.
- **`@flowcanvas/mcp`** 0.1.0: stdio MCP server with 26 tools and 7 resources over `flowcanvas.config.json`, canvas link on `127.0.0.1:47800-47809` with an extension `Origin` check, Pause Claude and Allow / Deny guardrails.
- **`@flowcanvas/protocol/lite`**: zod-free entry (constants, in-page channels, helpers, message types, hand-written validator checked against the zod schema). Content scripts and the SDK use it.
- JSON Schema for `flowcanvas.config.json` at `docs/schema/v1.json`, generated from `ConfigSchema` and kept in sync by a test.
- E2E suite (`e2e/`, Playwright with the unpacked extension), accessibility report (axe) and perf report.
- CI: lint (ESLint flat config), typecheck, unit tests, build, bundle size budget, e2e with uploaded reports.
- Docs: README with demo GIF, getting started, SDK reference, config reference, MCP tools reference, framework recipes, privacy policy, store listing, decisions.

### Changed

- Content scripts no longer bundle zod: `bridge.js` 66.6 KB → 13.2 KB, `mock.js` 60.8 KB → 5.2 KB (raw).
- The SDK imports its constants from `@flowcanvas/protocol/lite` instead of keeping copies.
