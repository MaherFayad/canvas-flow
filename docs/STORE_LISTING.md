# Chrome Web Store listing

Copy for the Chrome Web Store (and Edge Add-ons) submission. Keep in sync with `apps/extension/wxt.config.ts` (manifest) and [PRIVACY.md](./PRIVACY.md).

## Name

Flow Canvas

## Short description (≤ 132 characters)

> See every screen and state of your localhost app on one live canvas. Record flows, play them, and tweak design tokens.

(118 characters.)

## Category and language

- Category: Developer Tools
- Language: English

## Long description

Flow Canvas turns any app running on localhost into a live map of its screens, states and flows.

Open it on your dev server and every route appears as a live frame on a canvas, at real device sizes (iPhone, Pixel, desktop or your own). No code change needed.

- **Discover screens.** Flow Canvas crawls your app's links and lays out what it finds.
- **Force any state.** Show loading, empty, partial and error side by side. Add the tiny optional SDK (`@flowcanvas/sdk`, under 2 KB) for full control, or mock API responses per state with no SDK at all.
- **Record flows by clicking.** Click through the real app; each tap that navigates becomes an edge with its label and a stable selector.
- **Play flows.** Step through a flow on a phone frame with push, sheet, fade and spring transitions, custom easing and durations.
- **Tweak tokens live.** Edit the CSS variables of your app (colours, type, radius, spacing) and see every frame update at once. Overrides are saved with the project.
- **Keep it in your repo.** Everything saves to `flowcanvas.config.json`, so flows are reviewed in pull requests like code.
- **Works with Claude.** An optional local MCP server (`@flowcanvas/mcp`) lets Claude read and edit the canvas: add states, draw edges, answer comments.

Flow Canvas works only on `localhost`, `127.0.0.1` and `*.localhost`. It collects no data and makes no network calls of its own. Open source (MIT).

## Single purpose

Flow Canvas has one purpose: to display a web app that the user is developing on their own computer (localhost) as a canvas of live screens, states and flows, so they can review, record and play the app's user flows and adjust its design tokens.

## Permission justifications

| Permission | Why it is needed |
| --- | --- |
| `storage` | Saves the user's canvas project (screens, flows, token overrides, notes) and recent projects in `chrome.storage.local`, so closing the tab loses nothing. |
| `unlimitedStorage` | Screenshots of screens (WebP stills, 60 to 150 KB each) are stored locally for zoomed-out views; a project with 50+ screen states exceeds the default 10 MB quota. |
| `declarativeNetRequest` | One static rule (`rules.json`) removes `X-Frame-Options` and `Content-Security-Policy` (for `frame-ancestors`) from responses **only** for `sub_frame` requests to `localhost`, `127.0.0.1` and `*.localhost`. Dev servers often send these headers, which would stop the canvas from showing the app in frames. Top-level pages and every other site keep their headers. |
| `scripting` | Fallback path to register the MAIN-world helper script with `chrome.scripting.registerContentScripts` if static MAIN-world content scripts change behaviour; used only on the localhost hosts below. |
| `tabs` | The toolbar button reads the active tab's URL to open the canvas for that app's origin, and focuses an existing canvas tab for the same origin instead of opening a duplicate. |

| Host permission | Why it is needed |
| --- | --- |
| `http://localhost/*`, `http://127.0.0.1/*`, `http://*.localhost/*` | The canvas frames the user's local dev server, and two content scripts run there: the bridge (isolated world) that talks to the canvas, and a passive MAIN-world helper (navigation events, optional fetch/XHR mock responses for forced states). Both do nothing unless the page is a frame created by the canvas (`fc-frame` in the URL and framed by the extension). Chrome matches these patterns on any port. |
| Optional: `http://*/*`, `https://*/*` | Requested at runtime, per host, only when the user adds a staging or LAN URL as a project. Not granted at install. |

Remote code: none. All code ships in the package; nothing is fetched and evaluated.

## Data use disclosures (Privacy practices tab)

- Does the extension collect or use any of: personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity, website content? **No.** (Website content of the user's own localhost app is rendered and, for screenshots, stored locally only; it is never collected or transmitted.)
- Certifications:
  - I do not sell or transfer user data to third parties, outside of the approved use cases. **Yes**
  - I do not use or transfer user data for purposes that are unrelated to my item's single purpose. **Yes**
  - I do not use or transfer user data to determine creditworthiness or for lending purposes. **Yes**
- Privacy policy URL: `https://github.com/MaherFayad/canvas-flow/blob/main/docs/PRIVACY.md`

## Assets

- Icon: 128×128 PNG at `apps/extension/public/icon/128.png` (source: `icon.svg`; 16, 32, 48 also generated).
- Screenshots (1280×800): from `docs/screenshots/` (Player, Canvas with edge inspector, Tokens), re-shot at 1280×800.
- Promo video: 60-second demo (see M7); `docs/media/flow-canvas.gif` is the short version.

## Reviewer notes

To test: install, run any local dev server (for example `npx serve` on a folder with an `index.html` that links to a second page), open it in a tab, click the toolbar button. The canvas opens and discovers the pages. The header-stripping rule can be checked by loading a localhost page that sends `X-Frame-Options: DENY`: it shows on the canvas, while opening it in a normal tab still returns the header.
