# caribou-app

The Caribou web app: [Litro](https://github.com/beatzball/litro) with the Lit
adapter.

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
`routes.generated.ts`. A bracket may follow a prefix, so `pages/@[handle].ts`
is the route `/@:handle`. One rule comes from a patch on `@beatzball/litro`
(`patches/`), until Litro has it upstream: `pages/index.ts` is `page-index`,
not `page-home`, which `pages/home.ts` owns.

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

**`app.ts` stays a two-line bootstrap.** LitElement looks for Lit's hydration
support once, when its own module runs. Importing the support on the first
line is not enough: the bundler moves LitElement into a shared chunk, the
entry imports that chunk statically, and a static import runs before the body
of the module that imports it. LitElement then runs first, is never patched,
and every server-rendered element renders a second copy of itself beside the
server's markup instead of hydrating it — with no error. So `app.ts` imports
only the support and loads the rest (`app-main.ts`) with a dynamic `import()`.
Put new client start-up code in `app-main.ts`, never in `app.ts`.
`tests/e2e/hydration-bootstrap.spec.ts` guards this.

**A deploy must not strand a browser on the old build.** Vite names every
chunk under `/_litro/assets/` by its hash, and those are cached for a year;
the entry `/_litro/app.js` keeps its name and is served `no-cache`. The page
loads it as `app.js?v=<hash of app.js>` (`server/lib/app-entry.ts`, through
the `appScriptUrl` option the litro patch adds), so a browser that kept an
old entry never meets it again. That only works while no chunk imports
`app.js`: `vite.config.ts` keeps lit-html and Vite's preload helper out of it.
A tab that stays open across a deploy loads the target URL in full when a
page chunk fails to load (`components/_stale-build.ts`).
During a rolling deploy the HTML of one build can reach the other for its
entry; any query other than none or exactly this build's `?v=` is answered
`no-store` (`server/plugins/app-entry-cache.ts`), so no browser keeps the
wrong app under that URL.
`tests/e2e/stale-build.spec.ts` covers all four.

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

**Links inside a post body** are the author's server HTML; never rewrite them.
`<caribou-status-card>` has one delegated click on `.status-content`: a plain
click on a mention that matches `status.mentions` opens `/@acct@host` in
Caribou. Hashtags and other links go to their real `href`. Every module that
calls DOMPurify installs `installPurifyHooks` from
`@beatzball/caribou-mastodon-client/sanitize-opts`, so the server and the client
output stay the same string.

**Bookmarks page by a cursor, not a status id.** Mastodon orders
`/api/v1/bookmarks` by bookmark id and names the next page only in the Link
header. The client returns it as the page's `nextMaxId`, and the timeline
store keeps it and sends it back as `maxId`. It lives in the store, not the
client: `activeClient` is a new client whenever `users` changes. The browser can
read the header because Mastodon sends `Access-Control-Expose-Headers: Link`;
an e2e mock must send it too (`tests/e2e/bookmarks.spec.ts`).

**Server-only code stays out of the client bundle.** A page's `pageData`
fetcher runs only on the server; reach heavy server modules (the jsdom-backed
sanitizer) through a dynamic `import()` inside it.

## Shared controls

Use these instead of a hand-styled `<button>`. Each one wraps a real
`<button>` in its shadow root, so keyboard use and accessibility come from
the browser. Focus is delegated to that button, so the control is one tab
stop. Import the module from the component that renders it; the import
registers the element on the server and the client alike.

| element | attributes | parts | custom properties |
|---|---|---|---|
| `<caribou-icon>` | `name` (a key of `ICONS` in `_icons.ts`), `filled` | — | `--caribou-icon-fill` |
| `<caribou-icon-button>` | `icon`, `label` (required), `pressed`, `disabled`, `soft-disabled`, `count`, `hint`, `description`, `variant` (`default`, `ghost`) | `button`, `icon`, `count` | `--caribou-icon-button-size`, `--caribou-icon-button-icon-size`, `--caribou-icon-button-pressed-fg` |
| `<caribou-button>` | `variant` (`primary`, `secondary`, `danger`), `type` (`button`, `submit`), `loading`, `disabled` | `button`, `spinner` | `--caribou-button-size`, `--caribou-button-bg`, `--caribou-button-fg` |

- `<caribou-icon>` is always hidden from assistive tech, and is sized by
  `font-size` and coloured by `color`. An unknown name renders nothing.
- `<caribou-icon-button>`: `label` becomes the button's `aria-label`. It
  is not the tooltip: a `title` equal to the name is read again as the
  description. Set `hint` for a tooltip. `pressed` has three states: no attribute means it is not a
  toggle (no `aria-pressed`); `pressed="false"` is a toggle that is off;
  `pressed` or `pressed="true"` is on. Bind it as
  `pressed=${on ? 'true' : 'false'}`. The hit area is 2.25rem, 44px on a
  coarse pointer.
- `<caribou-icon-button>` for a control that is off but must still be
  heard (signed out, "Sign in to boost"): `soft-disabled` keeps it in the
  tab order with `aria-disabled` and swallows its clicks; `hint` is the
  tooltip; `description` is read after the name. It
  lives in the button's own shadow root, because an `aria-describedby` id
  in the caller's root cannot reach the inner button. `variant="ghost"` is
  borderless and muted, and fills the icon while pressed; the status card
  sets `--caribou-icon-button-pressed-fg: var(--success)` and
  `--caribou-icon-fill: none` on boost. The status card's actions are the
  first server-rendered use; `tests/e2e/status-card-hydration.spec.ts`
  hydrates them in CI.
- `<caribou-button>`: the label is the slotted text. `type="submit"` submits
  its form (through `ElementInternals`) the way a native submit button
  does: after every click listener has run, and not if one of them called
  `preventDefault()`. `loading` sets
  `aria-busy`, shows a spinner and swallows clicks, but keeps the button
  focusable; `disabled` takes it out of use.
- A disabled or loading control's host does not fire `click`, so a
  `@click` on the host is safe.
- `<caribou-button type="submit">` cannot submit a form without
  JavaScript. Its inner button is `type="button"` and the submit runs in a
  click listener; a native submit inside its shadow root would not reach
  the form either. A form that must work with JavaScript off (sign-out)
  keeps a native `<button type="submit">`. The sign-in picker uses the
  component because its form has no `action`: without JavaScript it has
  nowhere to go anyway.
- The host matches `:focus` but not `:focus-visible` when its inner button
  has focus. To style keyboard focus from outside, check
  `composedPath()[0].matches(':focus-visible')` on `focusin` (see the
  Follow button in `caribou-profile-header.ts`).

## Tests

- Component: happy-dom. Create the element, append it, `await el.updateComplete`,
  query `el.shadowRoot`.
  When the element sets state in `firstUpdated`, one await is not enough: it
  resolves `false` before the second render. Loop instead:
  `while (!(await el.updateComplete)) {}`.
- Put every `${child}` binding inside an element. happy-dom drops a child
  binding that sits at the top level of a template, with no error, so
  ``html`<ul>…</ul>${more}` `` renders no `more` in a component test. Browsers
  and SSR are fine; wrap it: ``html`<div><ul>…</ul>${more}</div>` ``.
- SSR: put `// @vitest-environment node` on the first line and use `ssr()` from
  `tests/integration/_ssr.ts`.
- A test that sends a `Cookie` header to a spawned server also needs the node
  environment — happy-dom strips that header from `fetch`.
- `*.mobile.spec.ts` runs only in the `mobile-webkit` Playwright project
  (iPhone 15: touch, bottom nav bar), locally and in CI. It needs WebKit:
  `pnpm exec playwright install webkit`.

### Real-upstream e2e specs

`public-timeline.spec.ts` and `no-js-public-timeline.spec.ts` load `/local` and
`/public` with a `caribou.instance=fosstodon.org` cookie, and the server
fetches the real timeline from that instance. They are skipped when `CI` is
set. Locally they need one thing the other specs do not.

The server trusts the instance cookie only when its storage holds an OAuth app
registration for that host — any key under `apps:fosstodon.org:`. A fresh
checkout has none, so the pages render the sign-in placeholder and every one
of these specs fails with "no `caribou-status-card`". Seed a registration in a
storage directory of its own, so a real one in `.data/` is left alone, and
start the server on it. From `apps/caribou`:

```
pnpm build
mkdir -p .data/e2e/apps/fosstodon.org
echo '{"client_id":"e2e","client_secret":"e2e","vapid_key":"e2e","registered_at":1}' \
  > .data/e2e/apps/fosstodon.org/e2e-seed
PORT=4312 STORAGE_DIR=.data/e2e node dist/server/server/index.mjs &
E2E_BASE_URL=http://localhost:4312 pnpm test:e2e
```

`.data/` is ignored by git. The seed only opens the cookie gate; the specs
never sign in, so the dummy credentials are never sent anywhere.
`tests/integration/ssr-list-paint.test.ts` covers the same path in vitest: it
starts its own server and seeds its own storage, and needs only the build.
