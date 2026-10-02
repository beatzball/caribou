# caribou-app

The Caribou web app: [Litro](https://github.com/beatzball/litro) with the Lit
adapter. It replaces `apps/caribou-elena`, which stays in the tree, unchanged,
until this app reaches parity and takes over the deploy.

```
pnpm --filter caribou-app dev        # dev server
pnpm --filter caribou-app build      # production build → dist/
pnpm --filter caribou-app test       # vitest: unit + component + SSR
pnpm --filter caribou-app test:e2e   # playwright
```

## Layout

| path | holds |
|---|---|
| `pages/` | One file per route. Nothing else — every `.ts` file here becomes a route. |
| `components/` | Custom elements and their helpers (`_name.ts` = helper, not an element). |
| `server/` | Nitro routes, API handlers and server-only libraries. |
| `tests/` | `unit/`, `integration/` (SSR output), `e2e/` (Playwright). Component tests sit in `components/__tests__/`. |

## Conventions

**Components are `LitElement`s with decorators.** `@customElement('caribou-x')`,
`@property()` for public inputs, `@state()` for private reactive fields.
`tsconfig.json` sets `experimentalDecorators` and turns `useDefineForClassFields`
off; both are required for Lit's decorators.

**A page's tag comes from its file path**, not from the class: `pages/about.ts`
must register `page-about`, `pages/@[handle]/[statusId].ts` must register
`page-handle-statusid`. The build prints the tag for each route in
`routes.generated.ts`. `pages/index.ts` is `page-index` — a patch on
`@beatzball/litro` renames it from `page-home`, which `pages/home.ts` owns.

**Every element has a shadow root, so styles live in the element.** A rule in
the document stylesheet does not reach inside one. Write `static styles` with
`css`, and use the design tokens (`var(--space-4)`, `var(--fg-1)` …), which do
inherit through shadow roots. There are no utility classes. Pages compose
`pageReset` from `@beatzball/litro/runtime`; components that need
`box-sizing: border-box` compose `boxReset` from `components/_shared-styles.ts`.

**Pass data down with bindings.** `attr=${value}` for strings, `.prop=${value}`
for objects and arrays, `?attr=${bool}` for booleans, `@event=${handler}` for
listeners. Property bindings work during server rendering, so a page hands its
`serverData` to a child with `.status=${status}` and the child renders it on
the server.

**The first client render must equal the server render.** Lit hydrates by
walking the server HTML against the first client render; a difference throws.
The server never runs `connectedCallback`, `firstUpdated` or `updated`, and has
no `window`. So `render()` must not read `window`, `location`, `localStorage`,
the clock, or any state the server did not have. Read those in `firstUpdated()`
(or later) into a `@state()` field and let the element render again.

**Test for the server with `typeof window === 'undefined'`, not `isServer`.**
Vitest loads `lit` under Node's `node` export condition, so Lit's `isServer`
is `true` in a happy-dom component test even though a DOM exists. A guard on
`isServer` would switch the code off in the tests that cover it. `typeof
window` is right in all three places: the server, the browser and happy-dom.

**A page mounts twice on a full page load.** The router hydrates the
server-rendered element, builds a second one off-screen, then swaps them and
sets `data-litro-settled` on `<litro-outlet>`. Both run their lifecycle, so
clean up in `disconnectedCallback`, and wait for
`litro-outlet[data-litro-settled]` in an e2e test before interacting.

**Links.** `<litro-link href="/x">text</litro-link>` is the default. It renders
a real anchor in its own shadow root, so style the `litro-link` element (color
and text decoration inherit into the anchor). When the anchor itself must carry
state — `aria-current`, a class — write a plain `<a href>` and bind
`@click=${spaClick}` from `components/_spa-link.ts`.

**Server-only code stays out of the client bundle.** A page's `pageData`
fetcher runs only on the server; reach heavy server modules (the jsdom-backed
sanitizer) through a dynamic `import()` inside it.

## Tests

- Component: happy-dom. Create the element, append it, `await el.updateComplete`,
  query `el.shadowRoot`.
- SSR: put `// @vitest-environment node` on the first line and use `ssr()` from
  `tests/integration/_ssr.ts`.
- A test that sends a `Cookie` header to a spawned server also needs the node
  environment — happy-dom strips that header from `fetch`.
