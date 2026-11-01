# Privacy policy: Flow Canvas

Last updated: 1 November 2026. Applies to the Flow Canvas browser extension, the `@flowcanvas/sdk` npm package and the `@flowcanvas/mcp` npm package. Maintainer: Maher Fayad.

## Summary

Flow Canvas collects no data. It has no accounts, no analytics, no telemetry, no crash reporting and no servers. Everything it creates stays on your computer or in your own repository.

## What the extension does with your data

| Data | Where it lives | Leaves your machine? |
| --- | --- | --- |
| Your project (`flowcanvas.config.json` working copy: screens, states, flows, tokens, notes, comments) | `chrome.storage.local` in your browser profile, keyed by app origin (for example `http://localhost:3000`) | No. You can download it as a file and commit it to your repo; that is your choice. |
| Screenshots of your app's screens (WebP stills used when frames are zoomed out) | `chrome.storage.local` in your browser profile | No |
| Images you drop on the canvas | IndexedDB in your browser profile; when the MCP server is linked, also files in your project's `.flowcanvas/assets/` folder | No |
| Your app's pages | Loaded live from your local dev server into frames on the canvas | No: they come from `localhost` and stay in the tab |

## Network

The extension makes no network calls of its own. The only connections it opens are:

1. **Your app**, in frames on the canvas: requests to the localhost origin you opened (`localhost`, `127.0.0.1`, `*.localhost`), exactly as a normal tab would make them.
2. **The local MCP WebSocket**, only if you run `@flowcanvas/mcp`: the canvas connects to `ws://127.0.0.1` on ports 47800 to 47809. The server binds to `127.0.0.1` only and accepts only the Flow Canvas extension's origin. Nothing is relayed to the internet by Flow Canvas; what Claude does with the canvas data you let it read is governed by your Claude client and its provider's terms.

Staging or LAN hosts are reached only after you add one and grant the optional host permission for it.

## What the content scripts do

Two small scripts run on localhost pages. They do nothing on a normal tab: they act only inside a frame the canvas created (the URL carries `fc-frame` and the page is framed by the canvas). There they answer the canvas (screen ready, links for discovery, CSS variables on `:root`, element under a comment pin) and, for apps without the SDK, answer `fetch` / XHR calls with the mock responses from your config.

Comment pins capture element context (selector, tag, text, a trimmed piece of HTML up to 2 KB, a few styles). They skip `input` values and anything inside `[data-fc-private]`, so passwords and personal data typed into dev forms are not captured.

## Screenshots and personal data (PDPL)

Screenshots can show real-looking or real personal data when your dev database holds it. In line with data minimisation under Saudi Arabia's Personal Data Protection Law (PDPL):

- screenshots are taken only of your own localhost app, only while it is on the canvas, and only to show stills of frames;
- they stay in your browser's local storage and never leave the machine;
- **Settings → Clear all screenshots** deletes every stored screenshot in one click, and removing the extension deletes all of its storage;
- we recommend seeded or fake data in dev databases you put on the canvas.

## The SDK and the MCP server

- `@flowcanvas/sdk` runs in your app, only inside canvas frames in development. It sends nothing over the network; it talks to the extension through in-page events.
- `@flowcanvas/mcp` runs on your computer, started by your Claude client. It reads and writes `flowcanvas.config.json` and `.flowcanvas/` in the project folder you point it at, and listens on `127.0.0.1` only. `add_image` with a URL downloads that one image because you (or Claude on your behalf) asked for it.

## Changes and contact

Changes to this policy are made in this file in the public repository, with the date above updated. Questions: open an issue at https://github.com/MaherFayad/canvas-flow/issues.
