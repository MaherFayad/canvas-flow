/**
 * The "discover screens" recipe: what Claude does to fill the canvas from the
 * app's code. Served as the `discover_screens` MCP prompt and as the
 * flowcanvas://recipes/discover resource for clients without prompt support.
 */

export const DISCOVER_RECIPE_URI = 'flowcanvas://recipes/discover';
export const DISCOVER_PROMPT = 'discover_screens';

export interface RecipeOptions {
  /** App folder to scan, when it is not the project folder. */
  dir?: string;
  /** Pending canvas request id to complete at the end. */
  requestId?: string;
  /** Extra focus from the user, e.g. "only the checkout flow". */
  focus?: string;
}

export function discoverRecipe(o: RecipeOptions = {}): string {
  const dirArg = o.dir ? `{ dir: ${JSON.stringify(o.dir)} }` : '{}';
  return `# Discover screens with Flow Canvas

Fill the Flow Canvas with the app's real screens, routes and states by reading the code. You are the most accurate discovery source: you can see button navigation, dynamic routes, screens behind login and the states a screen can be in, which a link crawl never finds.
${o.focus ? `\nThe user asked to focus on: ${o.focus}\n` : ''}
## 1. Find the routes

Call \`scan_routes\` ${dirArg}. It reads the router statically (Next.js App and Pages Router, Nuxt, SvelteKit, Remix / React Router v7 file routes and \`app/routes.ts\`, Astro, TanStack Router, and code-defined React Router, Vue Router and TanStack Router configs) and returns candidates \`{ route, file, framework, kind, dynamicParams, sampleHints, samplePath, guards }\`, plus \`skipped\` entries (redirects, not-found catch-alls, parallel and intercepting routes) and \`notes\`.
- In a monorepo, pass \`dir\` with the app folder (the one whose dev server is the canvas origin from \`get_project\`).
- If it finds nothing, open the router setup yourself (search for \`createBrowserRouter\`, \`<Route\`, \`createRouter\`, \`routes\`) and continue by hand.
- Call \`get_project\` too, to see the existing screens and sections (do not duplicate them).

## 2. Read each route's screen and find its states

Open each route file and the components it renders. Look for:
- **loading**: \`isLoading\`, \`isPending\`, \`status === 'loading'\`, skeletons, spinners, \`<Suspense fallback>\`, \`loading.tsx\` files.
- **empty**: \`.length === 0\`, \`!items.length\`, "No … yet" copy, empty-state components.
- **error**: \`error\`, \`isError\`, \`catch\`, error boundaries, \`error.tsx\` files, "Something went wrong" copy, retry buttons.
- **partial**: some data missing or failed (\`unavailable\`, sold out, fallbacks for missing fields).
- **success**: confirmation and "done" screens, toasts after submit.
- Modals, sheets, drawers and wizard steps controlled by state (\`open\`, \`step\`, \`showX\`): add them as named states of their screen (e.g. "filters-open", "step-2") rather than as separate screens, unless they have their own route.
Name states with the built-in names when they fit: \`default\`, \`loading\`, \`empty\`, \`partial\`, \`error\`, \`success\` (they get colored badges). Put \`default\` first, or \`success\` first for a confirmation screen. Use short kebab-case names for anything else. Only list states the code really has.

## 3. Pick real sample values for dynamic routes

For every dynamic param (\`/product/:id\`), choose a value that exists in the repo: \`sampleHints\` lists candidates from fixtures, seed data, mocks and API handlers; check them in the code (the API handler or loader must accept the value). Never invent an id when a real one exists. If there is none, say so in the summary and use the most plausible value. The screen's \`path\` is the concrete sample (\`/product/canele-plate\`); its \`route\` is the pattern (\`/product/:id\`).

## 4. Group screens by user flow

Make sections by what the user is doing, not by folder: e.g. Onboarding, Browse, Checkout, Account, Settings, Admin. Order screens within a section in flow order. Note screens behind auth (\`guards\`, middleware, \`RequireAuth\`): put "needs login" in the summary so the user signs in to the app in the same browser first.

## 5. Add everything in one call

Call \`add_screens\` ONCE with all screens: \`{ screens: [{ id, title, path, route, section, states }], mode: "add" }\`. Use short kebab-case ids and human titles ("Product detail"). Sections that do not exist are created. Leave out \`position\` so the canvas lays the new screens out. Use \`mode: "merge"\` only when the user wants existing screens updated. This is one undo step on the canvas.

## 6. Draw the obvious edges

Only when the target is clear from the code: a \`navigate('/x')\`, \`<Link to="/x">\`, \`router.push('/x')\` or form \`action\` next to a button. Call \`add_edge\` with \`from\` / \`to\` screen states, \`trigger.label\` = the button text, and \`trigger.target\` = a \`[data-fc="…"]\` selector when the element has one, else a stable selector (id, \`data-testid\`, aria-label). Use \`kind: "error"\` for retry / error paths. Skip edges you would have to guess.

## 7. Finish

Leave one short note with \`add_note\` (\`kind: "decision"\`): how many screens and states you found, which sections, sample values you picked and why, screens that need login, and what you skipped. ${o.requestId ? `Then call \`complete_request\` { id: "${o.requestId}", summary } so the canvas shows that you are done.` : 'If `list_requests` shows a pending "discover" request from the canvas, call `complete_request` with its id and a one-line summary.'} Tell the user what you added in two or three lines.
`;
}
