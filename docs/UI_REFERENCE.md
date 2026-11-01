# UI reference: look, behaviour, motion

Source: the 70 s reference recording supplied by the product owner. Key frames are in `docs/reference/`. **Match these.** Where this file and `BUILD_PLAN.md` disagree on look or behaviour, this file wins. (The red record/pause pill on the left edge of the recording is the screen recorder, not our UI. The product name in the recording, "Floow", is someone else's product; we use "Flow Canvas".)

| Frame | Shows |
| --- | --- |
| `frame_1.jpg` | Player (overview) mode, mobile, Onboarding active step 1/3 |
| `frame_9.jpg`, `frame_15.jpg` | Player mode scrolled to Checkout / Book a class, LOADING and SUCCESS badges |
| `frame_38.jpg` | Tokens panel open on the right, live edit of the display type size |
| `frame_62.jpg` | Canvas mode: selected edge, edge inspector with cubic-bezier editor |
| `frame_64.jpg` | Canvas mode overview, minimap, bottom status bar |

## Overall feel

- Calm, neutral, Figma-grade tool chrome. The app's screens are the only colourful thing on screen.
- Canvas background: flat light grey `#EDEDED` (no dot grid in Player mode; very faint dot grid allowed in Canvas mode).
- Chrome surfaces: white `#FFFFFF`, 1px hairlines `#E6E6E6`. Text `#1A1A1A`, secondary `#8A8A8A`, tertiary `#B5B5B5`.
- Type: Inter (or system UI), **small and dense**: 11 px for most chrome, 12 px for labels, 10 px uppercase for section labels and badges (letter-spacing 0.04em), 15–16 px semibold for section titles on the canvas ("Onboarding" + muted "3 steps").
- Accent: blue `#3B82F6` only for selection (selected frame ring, selected edge, handles, slider fills, the "Add to change set" button). Black `#111` filled pill = primary / active segment (Save edges, active segmented options, "Play edge").
- Corners: 6 px controls, 8 px panels. Shadows only on device frames.
- No emoji, no gradients, no big headers. Everything feels like one quiet toolbar.

## Layout

### Top bar (single row, ~36 px tall, white, hairline bottom)
Left → right:
1. Wordmark "Flow Canvas" (bold 12 px).
2. Project name with caret ("Helka ceramics ▾").
3. Segmented control **Player | Canvas** (active = white pill on light grey track, inactive = grey text).
4. Segmented control **Mobile | Desktop**.
5. Device select: "iPhone 16 Pro Max · 440×956 ▾" (hidden or shows "Desktop · 1440×900" in desktop).
6. Spacer.
7. Origin field: monospace muted "http://localhost:5173".
8. Undo / redo icon buttons (Canvas mode).
9. "1 unsaved edge" in orange text when dirty, "Discard" text button, **Save edges** black pill (only when dirty).
10. "Tokens" button; when tokens have unsaved changes it shows an orange count badge ("Tokens ①").

### Player mode (the default, `frame_1`)
Not a free canvas: a **vertically scrolling board** of sections.
- Left sidebar (≈190 px, white): "Flows" label, then a tree: section (caret, icon, name, count right-aligned) → screen rows (drag-handle icon "⠿", screen name, muted state name e.g. "Saved to wi…", coloured status dot at right: amber = loading/processing, green = success, none = default). Active screen row has a light grey fill.
- Sub-header row under the top bar: breadcrumb "Onboarding · Welcome · default [DEFAULT]" and second line muted "Next: Get started (tap · push · 240ms)". Right side: zoom control "– 65% +", scale chips "1× 0.5× 0.25×", reload icon, "← 1 / 3 →" step counter.
- Each section = a row: title "Onboarding" + muted "3 steps · Welcome → Catalog", then the section's screens laid out **horizontally** left→right.
- Each frame: small header above it: "Welcome" (+ muted state name and screen-state count) on the left, the state badge right-aligned ("DEFAULT", "LOADING", "EMPTY", "PARTIAL", "ERROR", "SUCCESS"). Badges are tiny uppercase text with a pale tinted background (grey, amber, blue, purple, red, green).
- Between consecutive frames: the trigger in muted 10 px, two lines centred in the gap: `Tap "Get started"` / `→` (or `Submit "Continue"`, `Payment accepted`).
- A screen that has extra states shows them as a **stack**: 2–3 offset card edges peeking behind the frame (see Catalog in `frame_1`). In Desktop mode the states of one screen are spread out horizontally in the row instead (Catalog default / loading / no results / some images failed / can't load).
- The **current step** frame has a 2 px blue ring. Clicking a frame, the arrows, or ←/→ keys moves the step; the board scrolls/pans smoothly to centre it (see Motion). Only the active frame and its neighbours are live iframes; others are stills.
- Device frame: rounded 44 px corners (mobile), iOS status bar "9:41", Dynamic Island pill, signal/wifi/battery glyphs, home indicator bar; soft shadow `0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08)`. Desktop frames: 8 px corners, no chrome.

### Canvas mode (`frame_62`, `frame_64`)
- Free React Flow canvas, no sidebar (sidebar collapses), zoom/pan.
- Section title floats above its frames: "Onboarding" 16 px semibold + muted "3 steps".
- Frame header: "**Welcome** · default" left, green live dot + "DEFAULT" badge right.
- Extra states placed **below** their screen as separate frames (e.g. "Pick interests · missing  SUCCESS"). An empty/unknown state renders as a **dashed-outline placeholder** with a "+" and copy "No success state" / hint text.
- Edges: thin 1.5 px grey lines, orthogonal (smoothstep) with an arrow head; **label pill centred on the edge**: white, hairline border, 6 px radius, two lines: bold "Get started" and muted "tap · push · 240ms". Error edges are red (and dash-dot, with "error" in the pill). Selected edge turns blue and its pill gets a blue border; the arrow head becomes a solid blue triangle. Unselected-unsaved edges are dashed.
- Bottom-left: vertical zoom buttons (+ / – / fit). Bottom-right: minimap (small, white, hairline).
- Bottom-centre status bar (pill, white, 10 px text): `zoom: near · live: 4/4 · Capturing screenshots… 28/31 · Recapture all · Reset layout`.

### Edge inspector (right panel, ~250 px, `frame_62`)
- Header: edge id (mono) + orange "edited" tag, close ×; muted "Welcome · default → Pick interests · default".
- **TRIGGER** (10 px caps label): Label input, Hint input (placeholder "Shown on the player's arrow"), Gesture select, Target input (mono) with green helper "Found in the app on this state" (red when not found).
- **TRANSITION**: 3×2 segmented grid push / pop / sheet-up / sheet-down / fade / none (active = black pill). Duration slider + numeric field + "ms". Easing chips row 1: ease-out, ease-in, ease-in-out, linear; row 2: Snappy, Emphasized, Sheet, Overshoot (active black pill).
- **Cubic-bezier editor**: square SVG graph, black curve, two blue ring handles draggable, faint diagonal, "time →" axis label; below it a mono field `cubic-bezier(0.2, 0.8, 0.2, 1)` and a **preview dot** that animates along a track with the current easing and duration (loops while the panel is open).
- **KIND**: segmented happy / error / alternate.
- Footer: black full-width-ish "▶ Play edge" button + red "Delete" text button.

### Tokens panel (right panel, `frame_38`)
- Header "Tokens 23" + orange "1 unsaved" tag, close ×; muted "Found in tokens.json" / "Found in :root".
- Groups with 10 px caps labels: **Colour** (row: name muted, swatch square, hex mono field), **Font family** (display / sans text fields), **Type scale** (display / title / body / caption: blue slider + number + "px", changed rows get a dot marker on the left and a reset ↺ on the right), **Spacing** (gutter, section), **Radius** (card, control, sheet).
- Footer: blue "Add to change set" primary + "Discard all" text.
- Edits apply **live to every frame** while dragging the slider (no apply button needed to preview).

## Motion and smoothness (must match)

The recording feels smooth because nothing jumps. Rules:

1. **Camera moves are animated**, never instant: step/fly-to = 450 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)` (Snappy). Use React Flow `setCenter/fitBounds({ duration })` in Canvas mode; in Player mode animate `scrollTo` with a rAF tween on the same curve (not CSS `scroll-behavior`, which can't be tuned). Interrupting a move starts the new one from the current position (no snap).
2. **Pan/zoom is 60 fps**: one transform on the viewport, frames promoted with `will-change: transform` only while moving; wheel = trackpad-style smooth pan, pinch/⌘-wheel = zoom around the cursor. Inertia on drag-pan release (decay ~ 325 ms time constant).
3. **Live/still swap is invisible**: when a frame becomes live, keep the still on top and cross-fade it out (150 ms) only after the iframe sends `ready`; when it goes still, fade the still in before unloading the iframe. Never show a white flash.
4. **Panels** (edge inspector, tokens) slide in from the right: 220 ms, translateX(16px)+opacity → 0, Snappy curve; the canvas does not reflow while they animate (overlay, then resize after).
5. **Selection**: ring and pill border colour transitions 120 ms. Hover on frame: shadow deepens 150 ms.
6. **Segmented controls**: the active pill slides between options (180 ms), not a hard swap.
7. **Edge drawing**: while dragging a new edge the line follows the cursor with no lag; on drop the label pill fades/scales in (160 ms, scale .96 → 1).
8. **Token edits**: slider drags stream `fc:tokens` throttled to one per animation frame; frames update the same frame (target < 16 ms per frame batch, < 200 ms to 20 frames).
9. **Player transitions** (edge play): Web Animations API; push = current slides to −30 % with slight dim, next slides in from 100 %; sheet-up = next rises from 100 % Y over a 40 % black dim; fade = cross-fade. Durations/easings from the edge.
10. **Counters and status text** (unsaved count, "Capturing screenshots n/N") update in place without layout shift (tabular numerals).
11. `prefers-reduced-motion`: camera jumps, panels fade only, Player uses a 120 ms fade.
