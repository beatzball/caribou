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
`@click=${spaClick}` from `components/_spa-link.ts`. The status card's author
link is one: avatar, name and acct are children of one `<a class="author">`.
Build every profile path with `profilePath` from `components/_profile-path.ts`;
it adds the instance host to a local acct.

**Links inside a post body** are the author's server HTML; never rewrite them.
`<caribou-status-card>` has one delegated click on `.status-content`: a plain
click on a mention that matches `status.mentions` opens `/@acct@host` in
Caribou. Hashtags and other links go to their real `href`. Every module that
calls DOMPurify installs `installPurifyHooks` from
`@beatzball/caribou-mastodon-client/sanitize-opts`, so the server and the client
output stay the same string.

**A content warning hides the post body.** When the shown post (the boosted
one, for a boost) has a `spoilerText`, the card renders the warning and a
Show more button, and `#status-body` stays empty until the reader opens it,
so its media and link card load nothing. Anything else that belongs to the
body goes inside that region, behind the same `bodyShown` check. Opened
posts are remembered per page session by source instance and id, and the
memory empties on an account change. Without JavaScript a post with a
content warning cannot be opened: the server sends the collapsed card and
no fallback. Read such a post on its home instance.

**Bookmarks page by a cursor, not a status id.** Mastodon orders
`/api/v1/bookmarks` by bookmark id and names the next page only in the Link
header. The client returns it as the page's `nextMaxId`, and the timeline
store keeps it and sends it back as `maxId`. It lives in the store, not the
client: `activeClient` is a new client whenever `users` changes. The browser can
read the header because Mastodon sends `Access-Control-Expose-Headers: Link`;
an e2e mock must send it too (`tests/e2e/bookmarks.spec.ts`).

**A page the reader comes back to paints at once.** On an SPA navigation the
router swaps a page in only when its `onBeforeEnter` returns. A page that opts
in hands that hook to `enterWithCache` (`components/_page-cache.ts`): a page
seen before renders its last page data at once and fetches fresh data in the
background. `<caribou-timeline>` keeps its store in a keep-alive
(`createKeepAlive` in `@beatzball/caribou-state`), so the list is there in the
first frame; newer posts go to the new-posts banner, and the list does not
move. Snapshot statuses are read back through `statusCache`. A page older than
five minutes (`STALE_MS`) still paints at once, and `<caribou-update-notice>`
(one live region on `body`, outside every page, so its text change is
announced) shows "Updating…" until the refresh ends. Both caches drop everything when the
active account changes. A full page load never reads them, so the hydration
rule holds; it fills them, so the first move away and back is instant too.
Threads keep their store too, so a revisit shows replies in the order the
reader last saw. On an account change the caches empty, late results are
dropped (`ownerGeneration()`), and cached posts lose the reader's flags.
Home, Local, Public, profiles and threads opt in. Another page opts in with
its own `onBeforeEnter` override and, for a list, its own `createKeepAlive`.
`tests/e2e/page-cache.spec.ts` and `page-cache.mobile.spec.ts` hold the
requests and check the cached paint, the banner and the restored scroll.

**Server-only code stays out of the client bundle.** A page's `pageData`
fetcher runs only on the server; reach heavy server modules (the jsdom-backed
sanitizer) through a dynamic `import()` inside it.

**Notifications poll once for the whole app.** `app-main.ts` calls
`startUnreadNotifications()`; it follows the active session and keeps
`unreadNotificationCount` (from `@beatzball/caribou-state`) current. The nav
rail only reads that signal. Do not start a poll from a component inside a
page: every page has its own rail, and a page swap mounts two. The rail shows
the count only after its first update, because the server always renders 0.
The seen marker is `lastSeenNotificationId` in `caribou.prefs.<userKey>`; only
the unfiltered list on `/notifications` moves it, and only to a row that is on
screen in a visible tab and a page the router has shown, for the session the list was loaded for.

## Accounts

A reader can be signed in to several accounts, on several servers, with one
active. Accounts live in the browser; the server keeps no session.

**Storage keys** (localStorage, through `@beatzball/caribou-state`):

| key | holds |
|---|---|
| `caribou.users` | every account: `[userKey, session]` pairs, in sign-in order |
| `caribou.activeUserKey` | the active account's `userKey` (`name@server`), or `null` |
| `caribou.prefs.<userKey>` | that account's settings (removed on its sign-out) |
| `caribou.drafts.<userKey>` | that account's compose drafts (removed on its sign-out) |

**Switching reloads the page.** A switch from the account menu, a sign-out
that leaves another account, and a 401 on the active account all change the
state at once and then call `land()` in `components/_switch-account.ts`. That
one coordinated landing points the instance cookie at the new active
account's server, then does one full navigation: the same page when it means
the same for any account (`pathAfterSwitch`), else `/home`; `/` when no account
is left. Requests that arrive while a landing runs join it. A 401 on an
account that is not active removes only that account, with no reload.

**The instance cookie** (`caribou.instance`, httpOnly) names the server that SSR
reads `/local`, `/public` and threads from (`server/lib/instance-cookie.ts`).
The browser cannot write it, so the app asks `POST /api/instance` with
`{ server }`. A cross-site request gets `403`; a server this deployment has
no app registered with gets `400`. Sign-out never clears it, so the public
feeds keep their server. At start, `app-main.ts` heals a stale cookie: when
the page's instance came from the cookie and differs from the active
account's server, it posts once (`healInstanceCookie`).

**Sign-in is bound to the browser that started it.** `POST /api/signin/start`
is same-origin only (else `403`). It sets a random nonce in a `caribou.signin`
cookie (HttpOnly, SameSite=Lax, path `/api/signin`, 10 minutes, Secure on
https) and keeps only its SHA-256 in the OAuth state entry.
`/api/signin/callback` compares them in constant time before any token
exchange, uses the state up either way, and clears the cookie
(`server/lib/signin-binding.ts`). A callback URL opened in another browser
goes to `/?error=state_mismatch`; a callback with no `caribou.signin` cookie
at all (cookies blocked, or finished in another browser) goes to
`/?error=no_cookie`. One sign-in at a time per browser: starting a second one
replaces the cookie, so the first one's callback fails.

**Completing a sign-in.** On success the callback does not redirect. It
answers `200` with the completion page itself
(`server/lib/signin-complete-page.ts`): the session (token, server, `userKey`,
VAPID key) sits in a `<script type="application/json">` block, and the page's
one script stores it in `caribou.users`, makes it active, takes the callback
URL out of history and goes to `/feed`. The response sets the instance cookie
and has `cache-control: no-store`, `referrer-policy: no-referrer` and a CSP
that lets only that script and style run. The token is never in a URL, so a
link cannot sign a reader in to someone else's account. `/signin/done`, where
sign-in used to end with the session in the URL fragment, now only shows
"Something went wrong… Return to start" and stores nothing.

**Adding an account** is `/?add`: the sign-in form, which keeps the stored
accounts. The new account becomes active; signing in to one already stored
replaces its token in place. Opened with no account (a stale link), it is the
plain landing.

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

### `<caribou-menu>`: a small menu behind a button

`<caribou-menu icon="ellipsis" label="More">` with the items as children:
real links, and native forms where an item must work without JavaScript.
The phone nav bar uses it for More (Public, Bookmarks, Sign out).

- The panel is a native popover, and the trigger names it with
  `popovertarget`. The browser opens it, closes it on Escape or a press
  outside, and exposes its expanded state, with JavaScript off too.
- The trigger is a native `<button>` in the menu's own shadow root, not a
  `<caribou-icon-button>`: an id reference cannot reach into another
  element's shadow root. It is 44px square; `label` is its name.
- With JavaScript it also sets `aria-expanded`, focuses the first item on
  open, returns focus to the trigger when the menu closes from inside, and
  closes when an item is chosen or focus leaves it. A browser without the
  Popover API gets the same from a script fallback, but only with
  JavaScript on: an old browser with JavaScript off cannot open the menu,
  so on a phone its items are out of reach there.
- The panel is fixed above the viewport's bottom-right corner;
  `--caribou-menu-bottom` and `--caribou-menu-right` move it. It never grows
  past the viewport. Parts: `trigger`, `icon`, `panel`.
- The items are the caller's light DOM, so the caller styles them. An item
  that is also shown elsewhere at another width must be `display: none`
  there, so its name is in the accessibility tree once. In e2e, check that
  with `ariaSnapshot()`: `getByRole` still finds an item slotted into the
  closed panel.

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
- An e2e spec that seeds a session imports `test` and `expect` from
  `tests/e2e/_fixtures.ts`, not `@playwright/test`. A signed-in page asks for
  notifications at once (the unread badge); the fixture answers that with an
  empty list, and a spec's own `page.route` still wins.
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
