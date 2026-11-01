# Decisions taken as defaults

The build plan ([BUILD_PLAN.md](./BUILD_PLAN.md), "Open decisions") leaves some questions to the owner. Where one blocked docs, packaging or launch material, the default below was used. Each is reversible; overturning one means editing the files listed.

| # | Question | Default taken | Why | To overturn, change |
| --- | --- | --- | --- | --- |
| 1 | **Name** ("Flow Canvas" is a working name) | Keep **Flow Canvas**; npm scope `@flowcanvas`. | Store and npm checks are the owner's call before M6/M7; docs needed a name now. | `README.md`, `docs/*`, `apps/extension/wxt.config.ts` (`manifest.name`), package names. |
| 2 | **Open source or closed** | **MIT for everything**: extension, SDK, MCP server, demo. `LICENSE` holder "Maher Fayad", 2026. | Fast trust and contributions; the plan's paid ideas (team canvases, hosted Player links) are services, not this code. | `LICENSE`, `packages/*/LICENSE`, `license` fields, `docs/STORE_LISTING.md`. |
| 3 | **Image storage** (`.flowcanvas/assets/`) | **Commit it to git**, with a size warning at 50 MB. `.flowcanvas/cache/` (screenshot stills) stays gitignored. | The team sees the same canvas; images are WebP at 2560 px max with content-hash names, so each is stored once. | `.gitignore` template in docs, MCP `add_image` docs, `docs/config-schema.md`. |
| 4 | **MCP scope** | **Canvas and config only.** Claude cannot edit the app's source from a comment. | The plan's own pick for v1; Claude Code already edits source. | `docs/mcp-tools.md` intro, store listing. |
| 5 | **Canvas library** | **React Flow** (already built on it). | Nodes and edges are the core shape; MIT. | n/a (architecture). |
| 6 | **Bundle budget reading** | "bridge under 15 KB" is enforced on the **raw** size of `bridge.js` (and `mock.js`); SDK core on **gzip** (under 2 KB); extension on the **zip** size (under 1.5 MB). | Raw is the stricter reading for content scripts that run in every localhost frame. | `scripts/size-check.mjs` (`BUDGETS`). |
| 7 | **Token broadcast budget** ("under 200 ms to 20 frames") | Measured to every **live** frame, which the live/still rule caps at 12. Stills get tokens on their next capture. | The plan's own live-frame cap; 20 live frames would break the memory budget. | `e2e/specs/perf.spec.ts`. |
| 8 | **Perf tests in CI** | Run on every push but **tolerant** (catch order-of-magnitude regressions); the plan's exact budget is asserted with `PERF_STRICT=1` on real hardware. | Headless Chromium in CI uses software rendering; a hard 50 fps gate there would be noise. | `e2e/specs/perf.spec.ts`. |
| 9 | **Accessibility gate** | axe runs in e2e and writes `e2e/a11y-report.md`; it **does not fail CI** yet. | The current violations belong to UI work in progress; make it blocking once the list is cleared. | `e2e/specs/a11y.spec.ts` (add `expect(rows).toEqual([])`). |
| 10 | **Schema URL** | `$schema` stays `https://flowcanvas.dev/schema/v1.json` (`SCHEMA_URL`); the file is `docs/schema/v1.json` until the docs site serves it. | Configs already carry this URL. | Host `docs/schema/v1.json` at that URL when the docs site ships. |

Still open (no default needed yet): the first outside test app, and whether to merge with Mock Lab and Redline.
