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
The active client's `capabilities` follow the same rule: the server does not
know the account, so read them in `firstUpdated()` or later
(`packages/mastodon-client/README.md`, "Public API").

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
page chunk fails to load (`components/_stale-build.ts`). Not once the page
is leaving (`beforeunload`, until `pageshow`): Firefox fails a dynamic import
still loading when the page navigates away (the Bluesky chunk on a Bluesky
page), and a reload then would cancel the reader's navigation. WebKit can do
the same and was seen in CI to fire the failure without that guard catching
it; a reader who leaves a Bluesky page in its first moment may be sent back.
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
Caribou. A plain click on a hashtag (`.hashtag` or `rel="tag"`, text `#name`)
whose name is in `status.tags` opens `/tags/<name>` (`tagPath` in
`components/_tag-path.ts`). Other links go to their real `href`. Every module that
calls DOMPurify installs `installPurifyHooks` from
`@beatzball/caribou-mastodon-client/sanitize-opts`, so the server and the client
output stay the same string.

**A hashtag page** is `pages/tags/[tag].ts`. The server reads the tag from the
reader's instance (the cookie) and paints the first page, like `/local`; the
name keeps its case. `parseTagParam` accepts exactly the names Mastodon's
`Tag::HASHTAG_NAME_RE` accepts, ported to JavaScript, and refuses the rest
before any request. Without an instance the server sends the sign-in
placeholder, and a signed-in reader then gets the timeline from their own
server after the first render. `<caribou-tag-header>` shows the Follow button
only after mount, for a signed-in reader. Follow state lives in `tagCache`
(`@beatzball/caribou-state`), keyed by account and by `normalizeTagName`, a
copy of Mastodon's `HashtagNormalizer` (NFKC, lowercase, its ASCII folding
table): `#Café`, `#cafe` and `#CAFE` are one tag, for the follow state, the
kept timeline and the match against `status.tags`. A read that fails with
anything but 404 leaves the state as it was, and no button shows while it is
unknown. A read that overlaps a write, or a result from an earlier account,
is dropped. It is the one page with its own title (`#tag · Caribou`): the
server sets it through `seoTitle`, and on the client only the connected page
whose tag is in the address sets it; it puts `Caribou` back when it leaves.
`tests/e2e/tags-ssr.spec.ts` starts its own server with
`tests/e2e/fixtures/upstream-stub.mjs`, which answers the server's requests to
`example.social`, so the server-painted page and its hydration run in CI.

**Search** is `pages/search.ts` and `<caribou-search>`. The address is the
source of truth: `q` is the query, `type` the tab (`accounts`, the default,
`hashtags` or `statuses`; `components/_search-query.ts`). The server sends
only those two, so the server render and the first client render both say
"Searching…", and the element searches after mount. One request
(`GET /api/v2/search`, no `type`) fills all three tabs. Typing waits 300 ms,
then replaces the address; Enter, a tab and Back or Forward each make or
use their own history entry. Every search takes a number, and only the
newest one, under the same account (`ownerGeneration()`), may show its
answer. A signed-in reader searches their own server with the token, and a
pasted or deep-linked web address is asked with `resolve=true`: when the
answer names one post or one account, the page replaces the search entry
with that thread or profile. A reader who is not signed in searches the
instance from the cookie with no token (`searchPublic`). Mastodon then
answers people and hashtags, finds no posts, and refuses `resolve`
(401), so the Posts tab says to sign in. With no instance known, or a
server that refuses all tokenless search, the page shows the sign-in
placeholder. The right rail has a search box (a plain GET form, so it works
without JavaScript), and Search is in the nav rail, in More on a phone.

**A content warning hides the post body.** When the shown post (the boosted
one, for a boost) has a `spoilerText`, the card renders the warning and a
Show more button, and `#status-body` stays empty until the reader opens it,
so its media and link card load nothing. Anything else that belongs to the
body goes inside that region, behind the same `bodyShown` check. Opened
posts are remembered per page session by source instance and id, and the
memory empties on an account change. Without JavaScript a post with a
content warning cannot be opened: the server sends the collapsed card and
no fallback. Read such a post on its home instance.

**A quoted post shows inside the post that quotes it.** Mastodon 4.5
puts it in `status.quote`; `<caribou-status-card>` mounts
`<caribou-status-quote>` in the post body, so the post's own content
warning hides the quote too. An accepted quote shows the quoted post's
author, text, a media summary (no media loads) and a link to its thread; a
plain click on the card opens the thread too. Every other state (pending,
rejected, revoked, deleted, unauthorized, blocked or muted author) and an
unknown one show a short note. After mount, a card on the reader's server
takes the quote from the cached copy of the post: the reader's copy
(`loadReaderView`) says whether they may see the quoted post, and a list
that keeps its own copy (a thread) never gets it. The cache decides which quote
to keep (below, "Which copy wins"). Hashtags and mentions in
the quoted text open in Caribou, as in a post (`components/_post-links.ts`).
The quoted post's own content warning,
the reader's filters, mutes and blocks, and a newer edit or a delete from
the status cache apply as on a card. A quote inside a quoted post (a
shallow quote, an id only) is a link to the quoted post, never a second
card. The status cache keeps the quoted post under its own id, and the
server sanitizes it with the post (`sanitizeStatus`). A post that only
links to another post, as on an older server, stays a link: making an
embed would mean a fetch per link and a guess at which links are posts.
Creating a quote is not built yet.

**Which copy wins.** A post can reach the status cache many times: the
server's page data (no token), the reader's own copy, an action's answer,
a boost of it, a quote of it. `mergeStatus` and `cacheStatus` in
`@beatzball/caribou-state` decide each field by one rule. Two places
hold what they decide:

- **The post's record** (`postRecords`, one per post id). Every copy of
  the post writes to it, wherever it came: alone, inside a boost, inside
  a quote. It holds what the reader's server says: `filtered`, the quote,
  and when a copy with a token last arrived (`tokenAt`, in arrival order).
  A copy with a token is one that has `filtered`; Mastodon sends it on
  every copy fetched with a token since 4.0, and quotes came in 4.5.
  Cards read it through `readerFiltered` and `readerQuote`, never by
  searching cached copies.
- **The cached copy** (`statusCache`), for everything else. "Known" below
  is the cached copy of the same post, alone or else inside a boost.

| field | kept in | the new copy wins unless |
|---|---|---|
| `filtered` | record | it has none (no token) |
| `quote` | record | a copy with a token has arrived and this one has none, or this quote is shallow (an id only) and names the accepted post the record carries in full |
| the quoted post | cache, under its own id | — it is cached only when the copy's own quote wins; a quote kept from the record is not cached again |
| edit fields (`EDIT_FIELDS`) | cache | the known copy has a newer `editedAt` |
| viewer state: the slots (`favourited` + `likeUri`, `reblogged` + `repostUri`, `bookmarked`) and `muted`, `pinned`, `replyDisabled`, `embeddingDisabled` | cache | it is not the reader's copy (page data, another account's); for a slot also: its write is out, the copy's fetch started before that write finished, or it disagrees with that write (flag or record ref) inside the network's lag window. A copy from another account never brings viewer state, cached or not. The rule is in the `@beatzball/caribou-state` README, "Viewer state" |
| counts beside a flag | cache | the reader's copy: never, but when its slot is kept the count moves by one to match the kept flag. Any other copy: the slot's write is out, or the cached flag is set and the new count is lower |
| `poll` | cache | the reader's vote is out; on a merge, the new copy has no `voted` (it keeps the known `voted`, `ownVotes`, and counts when they are higher) |

The reader flags stay in the cached copy: the reader's own actions write
them there (`mutations.ts`), and no reader-side decision reads them from
a boost. A store hands every copy it fetched to the cache with its source
(`readSource`, taken before the request); server page data has none and
counts as page data. An account change empties the records and drops every reader
flag (`forgetReaderFields`), so the next copy is taken.

**The reader's server filters hide or warn.** A status fetched with a
token carries `filtered`: every filter that matches it, whatever the
context. The card picks the ones for its `filter-context` attribute (home,
notifications, public, thread, account; empty, as on bookmarks, never
filters) in `components/_status-filter.ts`. Hide removes the card and its
row (`li:has(> caribou-status-card[hidden])`); warn shows "Hidden by filter:
<name>" and a Show button. A hide filter on the post a thread is about
warns instead. A server without filters v2 sends no `filtered`, and nothing
changes. Server-rendered data is fetched without a token, so it has none
either: the server render never filters and hydration holds. Once the page
runs with a session on the same server, the timeline, the profile and the
thread ask for the reader's copies of those posts (`loadReaderViewFrom` in
`components/_shell.ts`, `GET /api/v1/statuses?id[]=`, or one by one on an
older server). Until that answer is in, a signed-in reader does not see
those posts: a head script marks `<html>` before the first paint and its
style hides every card's post through the inherited
`--caribou-reader-veil` (`server/lib/reader-veil-head.ts`); the mark never
comes off by itself (after 15 s with no app it says why, with Reload). Once
the app runs, one rule holds: such a post stays covered until the reader's
check for it has settled (`readerChecks` in `@beatzball/caribou-state`), or
the reader chooses Show. The note says "Checking this post…" while the
check is out, and "Could not check this post…" with Retry after a failed
request or for a post the server left out; a Retry keeps the note. Each
check entry belongs to the request that made it, so a late answer from an
earlier account cannot uncover a post a newer check still holds. The server HTML is
the same for every reader, so hydration holds. Stores seed with
`mergeStatus`, so a reader's copy already cached keeps its `filtered`. A
post can be cached twice, alone and inside a boost; `readerFiltered(id)`
holds the newest `filtered` from either, and the card reads that.

**Mute and block change the relationship at once.** `setMute`,
`setBlock` and `toggleFollow` in `@beatzball/caribou-state` write the
relationship cache first, then ask the server. Writes to one account go
through one queue, in order, so an answer cannot overwrite a newer one, and
an Undo pressed before the mute has answered runs after it. A failed write
leaves the queue and the cache shows the rest. A muted or blocked
account's notifications leave the list too. A block, and anything else that
runs after a dialog, checks that the same account is still signed in. In every context but a profile, a card hides a post by an account
the reader mutes or blocks, or a boost by one; only a card on the reader's
own server reads the cache, since account ids are per server. The card
whose menu did it shows "You muted @x." with Undo instead, so focus has a
place. Block asks first (`confirmDialog` in
`components/caribou-confirm-dialog.ts`). `/settings/moderation` lists the
filters (read only, with a link to the server's own page), the muted and
the blocked accounts.

**Lists are private, so the server sends only the shell.** `/lists`
(`pages/lists/index.ts`) and `/lists/<id>` (`pages/lists/[id].ts`) render
the sign-in placeholder on the server, like `/home`, and the lists after
mount. A list's posts and even its title need the reader's token, so there
is no server-painted first page and no reading without JavaScript.
`parseListId` (`components/_list-path.ts`) refuses an id that is not
letters, digits, `-` or `_` before any request. The store is in
`@beatzball/caribou-state` (`lists.ts`): every entry is keyed by account,
writes change it at once and roll back with a toast, and an answer for an
earlier account is dropped (`ownerGeneration()`). A list timeline is
`<caribou-timeline kind="list" list=<id>>`, kept per list, and filtered in
the home context, as Mastodon does. New members come from a profile's menu
("Add to lists", `<caribou-list-picker>`); the server takes only accounts
the reader follows. The Members panel on the list and an unchecked box in
the picker remove them, with Undo in the toast (`toastRemoved` in
`components/_list-flows.ts`; `action: { label, run }` on a
`caribou:toast` event). Such a toast stays until it is used or dismissed,
and later toasts never push it out; a new toast always shows too, so with
several Undos up the stack can pass its limit of four. A read that crosses a write five
times in a row fails with Retry. Writes to one list or
one membership run in order; a read that crosses a write waits for it and
asks again, so it never undoes a change still on its way.
`/lists` is kept on an account switch; `/lists/<id>` is not (ids are per
account).

**The reader edits and deletes their own posts.** On a post whose author
has the active account's id (an id, never a handle, so a same-named
account on another server is not the reader), the post menu has Edit,
Delete and Delete & redraft instead of Mute and Block. Like every menu,
it shows only after the first render. Edit asks for the post as the
server has it now and for its source text, then opens
`<caribou-compose-dialog>` in edit mode (`caribou:compose` with `edit`).
An edit is not kept as a draft. Its visibility cannot change (Mastodon
does not allow it). Its media stays as it is and is sent back with the
edit, from the newest copy the page knows, since Mastodon drops any
attachment an edit leaves out. A post with a poll cannot be edited:
Mastodon removes a poll an edit leaves out, and starts one it sends again,
with no votes. `editOwnStatus` (`@beatzball/caribou-state`) writes
the new copy to the status cache, in place and inside every boost. A list
that keeps its own copies (a thread, notifications) shows it because the
card takes a newer edit from the cache (`editedAt`); its links follow
that copy too. No write to the cache lets an older copy undo an edit
(`cacheStatus` and `mergeStatus` both keep the newest edit, alone or
inside a boost), so a fetch that answers after the edit, or a late answer
to an earlier edit, changes nothing. A failed edit leaves the dialog open with
the text. Delete asks first (`confirmDialog`). `deleteOwnStatus` takes
the post and its boosts out of the cache at once and marks the id in
`deletedStatusIds`. A card whose post is marked hides; the thread's main
post says "You deleted this post." instead. Focus goes to the next post
in the list (or the one before). A failed delete puts it all back with a
toast. An account change drops the marks and every cached copy of a
deleted post with them. Delete & redraft opens a new post filled from the
server's answer (`text`, content warning, visibility, sensitive,
language, reply, media), kept as a draft, and with the post it replied
to when the page has it. The deleted post is nowhere else, so the redraft
is stored at once. An unsent draft already in its slot is never
overwritten: the redraft then goes in its own `redraft:<key>` slot
(`findRedraftSlot`), the dialog says so, and the next new post opens it
first, then the other draft. Esc, Cancel, a reload or an account switch
loses neither. An edited post shows "edited"
after its time: plain text in the server render, a button after mount
for a reader on the same server. It opens `<caribou-status-history>`
with every version, newest first, each sanitized like a post. A result
that lands after an account change is dropped.

**A poll is `<caribou-status-poll>`**, mounted by the card inside the
body region, so a content warning hides it too. The server and the first
client render show the results: shares, bars, the voters, and the end time
as a date. Option titles are plain text. After mount the end time counts
down, and for a reader who can act on the post (signed in, on its server)
an open poll they have not voted on shows radio buttons, or checkboxes for
several choices, and Vote. `votePoll` (`@beatzball/caribou-state`) writes
the vote at once to the post and to every boost of it, then the server's
poll; a failure puts the poll back, toasts, and reads the poll again. A
result from an earlier account writes nothing. The poll is read from the
status cache, so every card of the post agrees. `voted` and `ownVotes` are
the reader's: `mergeStatus` keeps them over a copy without a token, and an
account change drops them. Hidden totals show no shares until the end. The
compose dialog has a poll builder (not in an edit): options up to the
server's `configuration.polls` limit, a duration inside its range, several
choices, hidden totals. A poll and media exclude each other, as on
Mastodon, and a poll needs text. `tests/e2e/polls-ssr.spec.ts` paints polls
from the stub upstream and hydrates them in CI.

**Bookmarks page by a cursor, not a status id.** Mastodon orders
`/api/v1/bookmarks` by bookmark id and names the next page only in the Link
header. The client returns it as the page's `nextCursor`, and the timeline
store keeps it and sends it back as `cursor`. Every page carries a
`nextCursor`, profiles included, and the stores treat it as opaque: the
server hands the first one to the client with the page data, and the
"Older posts" link carries it as `?max_id=`. On `/bookmarks` that is the
bookmark id from the Link header, not a status id; the page does not read
`?max_id=`, so the link only has to be correct, not followed. It lives in the store, not the
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

**Notifications are grouped.** The list asks `GET /api/v2/notifications`
(Mastodon 4.3+) with `grouped_types[]` favourite, reblog and follow. A 404
means an older server: the list asks `/api/v1/notifications` and groups
the rows itself (`groupNotifications` in `@beatzball/caribou-state`: the
same type on the same post, or a follow, on the same UTC day), and
remembers that for the account until the page reloads. Older and newer
pages join the group they continue. A muted or blocked account leaves its
group; a group with nobody left goes. The e2e fixture answers the grouped
endpoint with 404, so a spec that mocks `/api/v1/notifications` keeps
working; `tests/e2e/notifications-grouped.spec.ts` serves the grouped one.

**Bluesky notifications** (#191) are grouped on the client, ordered by
`indexedAt`, and the badge is the server's count (`getUnreadCount`). The
list sends `updateSeen` at the moment a Mastodon list moves its marker, once
per new notification. The rules are in `packages/state/README.md`
("Notifications") and `packages/bluesky-client/README.md`
("Notifications"). Likes and reposts say "liked" and "reposted". A list
whose first page is empty with a cursor says "Nothing to show here yet.
Older notifications may follow." with "Load older", not "No notifications
yet": only a null cursor ends a list. When a "Load older" click ends the
list, focus moves to the end notice ("No notifications yet." or "No older
notifications."), not to the body, but only when focus is still on "Load
older" (or fell to the body) after the answer and the render: a reader who
moved on keeps their focus. This end notice is for Mastodon lists too.
Retry starts over and drops it. The notices go by the rows left after
mutes, blocks and filters. Each Bluesky author gets the reader's decision
(spec 7.4), and only once it is settled for that reader, as on the card
and the profile header (`blueskyDecisionSettled`); until then the author
is "Someone (checking your moderation settings)" with a blurred face.
Settled: `contentList` filter → the author leaves the row (a row with
nobody left goes, as for a mute); `contentList` blur → "Someone (Content
warning: …)" with no link and a blurred face; `avatar` blur → a blurred
face. An author with no decision is covered (fail closed). A mention's post
is moderated by its card, as everywhere.
`tests/e2e/bluesky-notifications.spec.ts` runs it against the fixture PDS.

**The changelog is part of the build.** `scripts/write-changelog.mjs`
(in `pnpm build-meta`) copies `CHANGELOG.md` into
`server/changelog.generated.ts`. `pages/changelog.ts` reads it in `pageData`
through a dynamic import, so the browser never downloads the text (Vite
still writes it as an unreferenced chunk under `dist/client/assets`, as with
the sanitizer); `server/lib/changelog.ts` parses it into plain data that Lit
renders as text. Nothing from the file is used as HTML. The unread dot is
`<caribou-changelog-dot>`: put one inside the item's `.icon-wrap` (the dot)
and one with `text` after the label (", new version" for a screen reader).
In the nav rail, `dot: true` on an item does both, and on a `more` item the
phone's More trigger gets them too. It is on Settings; the About section
of `/settings` (`caribou-settings-about.ts`) and the right rail link to
`/changelog`. The marker is
`lastSeenChangelogVersion` in `caribou.prefs.<userKey>`
(`components/_changelog-seen.ts`); `app-main.ts` starts it once.

**Keyboard shortcuts** live in `components/_shortcuts.ts`: one `keydown`
listener on the window, started from `app-main.ts`. A post is a
`<caribou-status-card>` in the page; `j` and `k` focus its `<li>` (or the
card where there is none), so any list of cards gets them with no code of
its own. The item gets `tabindex="-1"`, `data-caribou-post` and an
`aria-label` (the notification line without its buttons or list of who,
the author, the warning or the start of the text, the time) when it takes
focus. The name goes when focus leaves the post and is made again when it
comes back; `tabindex` stays, so a dialog can give focus back. That is after hydration,
so the server render does not change. Its focus ring is a sheet adopted into the
list's shadow root. `f`, `b`, `r` and `o` click the card's own controls and
permalink, so signed-out and soft-disabled rules hold. No key fires while
the reader types (an input, a textarea, a select, contenteditable, IME
composition), with Ctrl, Meta or Alt, while any dialog or popover is open
(a menu, its `data-open` fallback, an ALT description; focus need not be
in it),
after an earlier listener used it (`defaultPrevented`: Vimium's own keys
win), or with `shortcuts: false` in the account's prefs (`shortcutsOf`).
Letters are the letter the layout types, so Caps Lock and Dvorak work; a
layout with no Latin letters uses the key's place (`event.code`).
`?` opens `<caribou-shortcuts-help>`, whose list is `SHORTCUT_GROUPS`; add a
shortcut there and in `onKey` together. `n` belongs here too: it sends
`caribou:compose`, which the compose dialog answers.

**Bluesky is behind a flag.** `localStorage['caribou.flag.bluesky'] = '1'` turns it on for a developer.
`components/_bluesky.ts` is the only door to the atproto libraries (`loadBluesky()`, a dynamic `import()`); they build into the `bsky` chunk group in `vite.config.ts`, which a Mastodon page never requests (`packages/bluesky-client/README.md`).

### Bluesky views (#184)

Phase 2b: client render only. Every rule here applies only to a Bluesky
post or account (one with a `bluesky` field) or to a Bluesky client. A
Mastodon post, account or client renders as before.

**Home, profile and thread.**

- Home for a Bluesky account is the Following feed: `<caribou-timeline
  kind="home">` with the Bluesky client. It polls every 30 s like Mastodon.
  The store keeps feed order (`timelineOrder()` is `null`). When a catch-up
  does not meet the top post (`gap`), the banner says "Many new posts", and
  applying it replaces the list.
- Profile tabs are posts, replies and media (`getAuthorFeed` filters, in the
  client). The thread is `getPostThread`.
- The profile and thread pages render on the server as today. After
  hydration, with the flag on and a Bluesky account active, a Bluesky route
  (`/@did:…`, or `/@name` with a dot and no second `@`, spec 8.4) swaps in
  a client-rendered `<caribou-profile>` or `<caribou-thread>`. The thread's
  id is `at://<handle or did>/app.bsky.feed.post/<rkey>`. `/@me` looks the
  account up by its DID. Server rendering is in "Bluesky SSR" below.

**Nav.** With a Bluesky account active the rail hides Local and Public (by
`capabilities`), and Search and Lists until phase 5 (by network).

**A list that is empty but not ended.** A list ends only on a null cursor
(`packages/state` README). A page can be empty with more behind it (five
pages of unavailable bookmarks; a page where no post could be mapped). So
the timeline and the profile render the "Older posts" anchor while the list
is empty and has a cursor, and the empty notice only at the real end. With a
client, the anchor loads the next page in place until a post arrives or the
list ends. The server and the first client render agree: both read the
cursor.

**Moderation on the card** (spec 7.4, `packages/bluesky-client` README).
The card reads the newest copy's `bluesky.moderation` (status cache first,
so a refetch after Retry shows). The surface is `contentView` on the focused
post of a thread and `contentList` everywhere else.

| what | rule |
|---|---|
| `contentList.filter` | The card is hidden, like a filter's `hide`. Never on the focused post. |
| surface `blur` | The post is covered: "Content warning: <reason names>". A Show button unless `noOverride`. |
| a fail-closed reason (labeler unavailable, unknown label, moderation failed) | The cover also offers Retry: it fires `caribou:bluesky-moderation-retry` (the session glue reloads definitions) and refetches the post through the active Bluesky client. |
| `contentMedia.blur` | `caribou-status-media` gets `sensitive`; `contentMedia.noOverride` sets its `no-override`. The link card, the video card and `bluesky.recordCard` lose their image, and one line says "Media hidden by a content label", with Show unless `noOverride`. |
| `avatar.blur` (the post's result) | The author's avatar is blurred. |
| a quoted post | The same rules with its own `bluesky.moderation`, inside the quote card: filter and blur cover the quote with its reasons; Show unless `noOverride`; the avatar blurs. |
| profile header | `avatar` and `banner` from the account's `bluesky.moderation`. A Bluesky account with no result yet is blurred (fail closed). |

**Covers compose; the strictest wins.** What a reader sees of a Bluesky
post, quote or profile is the strictest of every cover that applies: the
label cover (from the current reader's decision), the relationship cover
(mute or block), the filter verdict, and the veil. A Show on one cover
never lifts another: the covers nest, each with its own Show, outermost
first. A `noOverride` cover (a label that forbids it, the veil, a decision
Caribou cannot read) has no Show at all, and nothing under it renders.

**A decision belongs to one reader.** Each copy records whose decision it
carries (`bluesky.viewerOf` on a post; the reader that looked up a profile,
the header's `.viewerOf` property, which `<caribou-profile>` sets). The current reader is the active Bluesky
account, or none. A decision made for another reader, or for no reader
when one is active, is never reused: the item is covered ("Checking this
post against your moderation settings…", no Show, Retry) until a copy for
the current reader arrives. Retry fetches as the reader, so with no
Bluesky reader a cover has no Retry. With no Bluesky reader (signed out, or a
Mastodon account active), an author with a `!no-unauthenticated` self-label
is never shown: the notice "This account asked to be seen only by
signed-in readers." takes the post's, quote's or profile's place, whatever
decision the copy carries. A Bluesky post or account with no `moderation`
is covered too (fail closed).

**Every surface.** The card, the quote card and the profile header each
ask `blueskyDecisionSettled` (`components/_bluesky-moderation.ts`) about
their own newest decision: made for the current reader, and the reader
veil settled for it (every subscribed labeler covered). Until it says so,
the surface is covered, locked, with Retry; a new labeler subscription
covers it again. The check reads the reader and check signals on every call,
whatever its inputs, so an effect that first ran with no decision or
another reader's still follows later changes. The quote card reads the quoted post's newest copy from
the status cache, as the outer card does, and gets the same rules. The
profile header covers the display name, handle and bio under
`profileView` (and blurs the avatar and banner by their own contexts); its
Retry fetches the account again through the reader. A successful Retry
moves focus to what it revealed. The card's `labeled` class names the
cover the reader is at (the first one not lifted).

**The reader veil for Bluesky cards.** With a Bluesky account active, a
Bluesky card shows its post only when `blueskyCheckSettled(post, reader)`
says so. Until then it is covered with "Checking this post against your
moderation settings…" and a Retry, and never a Show button. The check is
in `./moderation`, so `_bluesky.ts` loads it lazily, the first time a
Bluesky account is active; until it loads, the card is covered. The reader
(prefs and label definitions) comes from `setBlueskyReader()`, which the
session glue (`components/_bluesky-session.ts`) calls when the active
Bluesky client restores; a reader for another account counts as none. A
cover's Retry fires `caribou:bluesky-moderation-retry`: the glue loads the
prefs and definitions again (one load at a time), sets the reader, and the
active client's calls wait for that load, so the card's refetch is judged
with the new definitions. A failed load leaves the reader as it was.
With a Mastodon account active, or none, a Bluesky card settles at once.

### Bluesky compose (#189)

`<caribou-compose-dialog>` with a Bluesky account active. Every rule here
applies only when the dialog's client is Bluesky; Mastodon compose is as
before. The draft and the retry rules are in `packages/state` README
("Bluesky drafts"), the client's calls in `packages/bluesky-client` README
("Compose").

**Controls.** No visibility, no poll, no content-warning text (by
`capabilities`). "Add images" takes images only (`accept="image/*"`), at
most 4. The counter shows graphemes left out of 300. Post is off when the
text is over 300 graphemes **or** over 3000 bytes, counted with the SDK's
`RichText` (`countPost`), as the PDS counts. The SDK loads through
`loadBluesky()` when the dialog opens; until it has, Post is off. A post
may have no text when it has an image or a quote. When the bytes are over
(few graphemes can be many bytes), visible text says "Over the 3000-byte
limit", the counter's name adds it ("270 characters left, over the
3000-byte limit"), and the live region says it once. Post is also off with
more than 4 images, whatever a stored draft holds.

**Images** (`components/_image-fit.ts`). Each picked file goes through
`fitImage(file, 2 MB)`. **Every image is drawn on a canvas and encoded
again as JPEG**, whatever its size: a blob on a PDS is public
(`com.atproto.sync.getBlob`) and the PDS keeps it as sent, so this is what
removes EXIF data, GPS position included, and it turns HEIC, TIFF or other
types into one Bluesky shows. An animated GIF keeps its first frame.

- not an image: refused, "… is not an image."
- cannot be read by the browser: refused, "… could not be read as an
  image." (it cannot be cleaned either).
- long side 2000 px at most (a larger one is scaled down), quality 0.9,
  0.8, 0.7, then the long side × 0.8 each round, until it is at most 2 MB.
  Below a 400 px long side it is refused: "… is too large, even made
  smaller. Pick an image under 2 MB." A transparent image gets a white
  ground (JPEG has no transparency).

At most 4 images, counted across picks: the picker's room is 4 minus the
draft's images minus the uploads in flight. Each image has a local `id`
for its controls (remove, alt text), not its CID: the same file picked
twice is two images with one CID. The upload is the fitted image, never
the original. The alt text field is the draft's: it goes in the post's
embed, with no server call. The page keeps each fitted file in memory by
the image's id. When the PDS answers `BlueskyBlobNotFound` (it dropped an
upload no post used yet), the send unfreezes the record (state rule 1),
and the dialog uploads that file again (the same bytes, so the same CID)
and asks the reader to post again; an image with no file (after a reload)
shows "Not on the server any more. Remove it and add it again." and Post
stays off until it is removed.

**Labels instead of a content warning** (spec 7.4). With at least one
image, a `<caribou-menu>` "Label this media" (anchored, the shared menu's
focus rules) lists Adult, Suggestive, Nudity and Graphic. Each is a toggle button with
`aria-pressed`; the menu's name lists the labels on. Labels go in the
record only with images. Known: the shared menu closes after each choice, so
two labels take two openings (review note N7, left as it is for day one).

**Reply and quote.** `caribou:compose` with `inReplyTo` (a Bluesky post) or
`quote`. The draft takes the strong refs from the post (`reply.root` from
its `replyRef.root`, else the post). No mentions are typed into a Bluesky
reply: a mention is addressed by DID, never by handle text (#177's note).
The dialog opens only when the post's network is the active account's: a
Mastodon account never opens for a Bluesky post, and only a Bluesky account
quotes. On open the dialog reads the post again (`fetchStatus`):

| the post | the dialog |
|---|---|
| `replyDisabled` (reply) or `embeddingDisabled` (quote) on the dialog's own copy **or** on the status cache's copy, checked on open, after the fresh read, and at send. Neither copy is known to be newer, so either one blocks. The fresh read also goes into the cache (`cacheStatus`). | "The author limited replies. You cannot reply to this post." / "The author turned off quotes for this post." Post is off, and a send is refused with that toast. #188 owns the card's buttons; this is the second check. |
| gone (`not_found`) | "The post you replied to was deleted." (or quoted). The draft keeps its text; Post is off. |

**Sending.** `postBlueskyDraft`, under the five rules in the `packages/state`
README ("One post per click", R1 to R5). The open draft takes every draft
the send makes (`onDraft`), the frozen one before the network. Storage
refusing the freeze is a toast, "Could not save the draft, so the post was
not sent.", nothing is sent, and the open draft is unfrozen, so every later
Post is refused the same way until storage works. Every await in the dialog
(fit, upload, re-upload, the target read, the send) captures its owner
(client, account, slot, dialog session) and checks it after; a late answer
for a closed, reopened or switched dialog writes nothing. A failed create is
checked at once (R1): found, the dialog closes as posted; absent, the draft
is open again with the reader's text; the check failed, the toast says
"Post again to retry; it is never sent twice." and the dialog shows "The
last send did not finish. Post checks first, so the post is never sent
twice." (only while no send runs: during a send it would not be true). The
draft gets its rkey when the dialog opens it (state R6), so a dialog closed
and opened again during a send posts the same record, not a second one;
Post waits for the rkey. When a send from an earlier opening of the dialog
ends posted, and the open draft has the same rkey and the same content, the
dialog closes: that text is posted. When another version is the one posted (a late first write after an
edit), the dialog stays open with the edits and says "Your earlier version
was posted." with a link to it (`/@<did>/<rkey>`) that opens in a new tab,
so the open dialog does not cover a page change. After a blob refusal the
toast says only what happened: an image uploaded again, an image to add
again, or "The server refused an image this post named." The reply/quote
block is read live at every render and at every Post.
Link cards are phase 6: a link is posted as a facet with no card.

Tests: `caribou-compose-dialog-bluesky.test.ts` (limits with emoji,
combining marks, CJK and a link; one post after a lost answer, a reload and
an edit; reply and quote refs; the flags; images, alt text, labels, resize,
the 4-image cap and blob recovery); `_image-fit.test.ts`;
`tests/e2e/bluesky-compose.spec.ts` (the real SDK against a fixture PDS: the
counter, a TID rkey, facets, and a lost answer across a reload is one post).

### Bluesky delete and redraft (#190)

The card's Delete and "Delete & redraft" on the reader's own Bluesky post.
Rules, and the order of the steps, in `packages/state` README, "Bluesky
delete and redraft". The rule: nothing can be lost after the delete.

- **Delete** asks first, as for Mastodon. The post leaves every list at
  once. A refusal brings it back: "Could not delete this post. Try
  again." A delete whose outcome cannot be known brings it back too:
  "Could not tell whether the post was deleted. Reload to check." Focus
  goes as for Mastodon.
- **Delete & redraft.** One flow at a time per card: a second click while
  one runs does nothing. A visible `role="status"` line under the post
  says "Reading the post…", then "Getting the draft ready…", then
  "Deleting the post…".
  1. A redraft of this post is stored already (a delete in doubt kept
     it): it opens instead, and nothing is read, uploaded or deleted.
     "You already have a redraft of this post, so it opens. The post was
     not deleted. If it is still up, use Delete." (state README, rule
     D4).
  2. The card reads the record, its images and its reply and quote
     targets. A failure: "Could not read this post, so it was not
     deleted." The record is not there: "This post is already deleted."
     (info), and the card leaves every list; focus goes to the next post
     when it was in this card.
  3. When nothing in the post can be kept (no text, no image, no quote),
     there is no confirm and no delete: "Nothing in this post can be kept
     in a draft. Use Delete." (info). Else the confirm, "Delete and
     redraft this post?", says what is lost, and adds a sentence for each
     that applies: "The video is not kept.", "The link card is not
     kept.", "Its labels are not kept." (a menu label on a post with no
     images), "The post it replies to is gone, so the redraft cannot be
     posted as a reply." / "The author of the post it replies to limited
     replies.", and the same for the quoted post.
  4. The draft is built, the images re-encoded and uploaded, and the draft
     and image bytes stored. A failure: "Could not get the redraft ready,
     so the post was not deleted: <reason>".
  5. Delete. Focus goes to the next post only when it is still in this
     card (the steps before can take seconds). Failed: as Delete, and the
     staged draft is removed. Unknown: the draft is kept, and the toast
     says so (state README).
  6. The dialog opens on the stored slot (`caribou:compose` with
     `blueskyRedraft: { userKey, slot }`; the dialog sets `opened` on the
     detail). When it cannot open (another composer is open), a toast
     says "Your redraft is saved. It opens the next time you write a new
     post."
- **Plain Delete** removes no draft (state README, rule E).
- **The dialog** opens a stored Bluesky slot like a Bluesky new post: its
  refs, images, labels and rkey. It loads the slot's image bytes from
  IndexedDB for the previews and for blob recovery (after a close, a
  reopen or a reload too). The note "Your other unsent draft stays as it
  is…" shows only when the draft's own slot (`new`, `reply:`, `quote:`)
  holds another unsent draft.
- **Targets.** A draft with a reply or quote ref shows the post it names,
  from the cache or read (`fetchStatus`). **While a target is being read,
  Post is off**, and a send is refused ("Checking the post this replies
  to or quotes. Post again in a moment.", an info toast). Gone or
  limited, the dialog's note names the kind ("The post you replied to was deleted." or "The post you
  quoted was deleted."), and Post stays off, as for any reply or quote.
- **A post that may still be up.** A redraft whose delete was in doubt is
  checked when it opens. If the post is still up, a note says "The post
  this redraft came from is still up. Delete it first, or this text is
  posted twice."
- **A tab closed during the delete.** A new post checks for its staged
  draft (state README). Found, with its post gone: a toast says "A
  redraft from an earlier visit was found. It opens the next time you
  write a new post."
- **Labels.** The label menu has four items: Adult (`porn`), Suggestive
  (`sexual`), Nudity, Graphic, as the official app.
- Mastodon's delete and redraft do not change.

### Bluesky card actions (#188)

The card's buttons for a Bluesky post. The writes and their rollback are
in `packages/state` ("Bluesky acks") and `packages/bluesky-client`
("Actions").

| button | Bluesky reader, Bluesky post | other readers |
|---|---|---|
| Reply | on; opens the composer with `{ inReplyTo }`. **Off** with "The author limited replies" when `bluesky.replyDisabled` is set. | off; "Sign in with a Bluesky account to reply" (Mastodon reader) or "Sign in to reply" |
| Quote (Bluesky posts only) | on; opens the composer with `{ quote: status }`. **Off** with "The author turned off quotes" when `bluesky.embeddingDisabled` is set. | off, with the same sign-in hint |
| Boost, Favourite, Bookmark | a repost, a like or a bookmark; one click is one write; a failure rolls back with a toast | off, with the sign-in hint |
| More → Mute, Block | mute or block the author | not shown |

- **The flags come from the newest copy** of the post (the status cache's
  `bluesky`), so a reader's copy that turns replies off turns Reply off.
  The server render and the first client render use the card's own copy.
- **A limited post never opens a composer.** The button is
  soft-disabled (the click and the `r` key do nothing) and the handler
  checks the flag again. The composer checks a third time at submit.
- **Six controls on a small phone.** Up to 480 px wide, a bar with Quote
  starts under the avatar, its gaps shrink and its buttons have less
  side padding (each stays 44 px). A Bluesky count of 1000 or more is
  short: 2140 is "2.1K", 12345 is "12.3K" (`shortCount`; the
  description keeps the whole number). With such counts the bar fits on
  one row from 360 px. At 320 px it can wrap to a second row; the page
  never scrolls sideways (`bluesky-actions.spec.ts` measures 320, 360
  and 375 with 312 / 2140 / 12345). These rules match only a Bluesky
  card, so Mastodon cards keep their layout and whole counts.
- **Follow from unknown state.** A Bluesky ack, or a read made while
  blocked, can leave `following` unknown (state README, A1 and R2-1).
  The profile header and search show no Follow button until a read
  fills it (`relationshipKnown`). The header still shows Unblock when
  the block is known.
- **List blocks and mutes.** Unblock and Unmute refuse a block or mute
  that comes from a list, with a toast that says so (state README, A3).
- **A Mastodon card has no Quote button** and its other buttons are as
  they were.
- **Block confirm.** For a Bluesky account (card, profile header, Settings
  → Moderation), the question ends "Blocks on Bluesky are public. Anyone
  can see that you blocked this account." A Mastodon block's text is
  unchanged.

### Bluesky SSR (#185, #186)

Phase 3. The server paints a Bluesky profile and thread with no token
(spec 8). `server/lib/bluesky-public.ts` is the one place that fetches
them.

**The server flag.** The Bluesky flag lives in the browser, so the server
cannot read it. The server paints Bluesky routes only when the env var
`BLUESKY_SSR=1` is set (`server/lib/bluesky-flag.ts`, read before the SDK
loads). Without it a Bluesky route renders as it did in phase 2b, and
nothing changes for any reader. With it, **every** reader gets the Bluesky
page for a Bluesky route, whatever their browser flag says: the browser flag
then only decides whether a Bluesky account can swap in its own render.
Deploy notes: `docs/deploy.md`, "App env vars for Bluesky".

**What the server fetches.** Only `BLUESKY_PUBLIC_APPVIEW` (default
`https://public.api.bsky.app`), through `upstream-cache.ts`, with a fixed
TTL per call (`BLUESKY_TTL`): `TTL.BLUESKY_PROFILE`, `TTL.BLUESKY_AUTHOR_FEED`
and `TTL.BLUESKY_THREAD` are 30 s, the AppView's `max-age`; label
definitions are `TTL.BLUESKY_LABEL_DEFS`, 1 h. An error or a 429 is never
cached.
Never a handle's own domain, never a PDS, and no redirect is followed
(`redirect: 'error'`). Calls: `app.bsky.actor.getProfile`,
`app.bsky.feed.getAuthorFeed` (`includePins=false`, the tab's filter, the
`max_id` query as the cursor), `app.bsky.feed.getPostThread`, and
`app.bsky.labeler.getServices` for Bluesky's labeler.

**Route rules (spec 8.4), in this order.** `routeOf(segment)` in
`components/_bluesky-route.ts`:

1. `@name@host` (a second `@`): Mastodon, remote account.
2. `@did:…`: Bluesky, by DID.
3. `@name` with a dot: Bluesky, by handle.
4. `@name` with no dot: Mastodon, local to the cookie's server.
5. `/@<handle or did>/<id>`: a Bluesky post when rule 2 or 3 matched.

The server reads the route segment percent-decoded once (`decodeSegment`),
as the client reads the address (`routeSegment`), so `/@did%3Aplc%3Aalice`
and `/@alice%40example.social` mean the same route on both sides.
Before any fetch the server checks the syntax: the DID, the handle and the
record key, with `@atproto/syntax` (`@beatzball/caribou-bluesky-client/syntax`).
A bad one gets a 404 page in the shell and no request.

**Links Caribou builds.** `profilePath` never makes a bare dotted `/@name`
for a Mastodon account: rule 3 would read it as a Bluesky handle. With no
host it takes the host from the account's `url`. With no host and no URL, a
dotted name links to a search for the account. `postPath` follows the same
rule for a post's link: a dotted local acct takes the host given, then the
account URL's host. With neither, the time links to the post's own `url` on
its server (a new tab) when that is an http(s) URL, and is not a link at
all when it is not. The status card and the quote card both use it.

**A page opened by DID** (`/@did:plc:…`) replaces the address bar with the
handle form in `firstUpdated`, never in `render`, with `history.replaceState`.
Not when the handle is `handle.invalid`, and not on a hidden account.

**Moderation.** The server runs `moderate()` with `LOGGED_OUT_PREFS` and
Bluesky's label definitions, as a signed-out reader's client would. When the
definitions cannot load, `moderate()` gets `null` and covers every label it
cannot define (fail closed). The covers, the veil and `noOverride` come from
the same plain data on the server and in the first client render.

**`!no-unauthenticated` (spec 8.3).** Content from an author appears in
signed-out SSR only if that author's own labels were read and none is
`!no-unauthenticated`.

- Per author, everywhere an author's content can appear: the profile, each
  feed item, the reposter of a repost, a quoted post, the parent and root of a
  reply, every post in a thread, and a record card's creator.
- An allow-list, not a block-list: an author shows only when the code has
  **seen** it whole (`isProvenVisible`): an object with a `did:` DID, a
  string handle, and a `labels` array of objects with no
  `!no-unauthenticated`. A missing author, a partial one (no DID, no handle,
  no labels), or `labels` that is null or not an array is hidden.
- The server checks each author slot by name before mapping: the profile,
  each feed item's author and reposter, and every thread post's author. A
  failed one becomes a marker with only its DID, `handle.invalid` and the
  label. A feed item's `reply` is dropped. `mapEmbed` checks a quoted
  author and a record card's creator the same way for a signed-out copy;
  a known record card with a missing or partial creator is the notice card.
- A hidden account in the page data has `handleInvalid: true`, so any path
  built from it is a DID path, never `/@`.
- The server filters before the data goes into `serverData`. A hidden
  author's display name, handle, avatar, banner, bio and post text are not
  in the response at all: not in the body, the title, a meta tag or the
  page data.
  - A hidden profile: the page sends the shell and "This account asked to
    be seen only by signed-in readers." Its posts are not fetched. The page
    data has no handle.
  - A hidden post (its author or its reposter is hidden): the item keeps its
    id, time and reply link, and nothing else. The card renders the notice.
  - A hidden quoted post: the quote card's notice (`mapEmbed`).
  - A hidden record card creator: the card is the notice, with no name,
    description or image (`mapEmbed`).
  - A feed item's reply parent and root are not in the page data.
  - A thread opened by a hidden author's handle: the page data does not
    keep the handle; the client reads it from the address after the first
    render.
- In the client: with no Bluesky account active (signed out, or a Mastodon
  account), the notice stays, and the first render equals the server's. With
  a Bluesky account active, the page swaps in its own client render after
  hydration, which fetches as the reader and shows the account.

### Bluesky SSR: rate limits (#187)

All signed-out SSR comes from one server address, and the AppView's limit
is not documented (spec 12.1). So a 429 never becomes an error page.

1. **A 429 defers the page.** When the AppView answers 429, the page data is
   `{ kind: 'deferred', appview }`, with no handle and no post id (the server
   did not learn whether the account is hidden). The server render is the
   loading shell ("Loading…"), and so is the first client render.
2. **Back off.** After a 429 the server makes no Bluesky SSR fetch until
   `Retry-After` has passed: whole seconds or an HTTP date, at least 1 s,
   at most `BACKOFF_MAX_S` (60 s); `BACKOFF_DEFAULT_S` (30 s) when the header
   is missing or unreadable. Every Bluesky page in that time is `deferred`,
   with no fetch. A 5xx or a network error is an error page as before, with
   no back-off. **A rate limit is never turned into "no data"**: a 429 on
   any call, label definitions included, reaches the page fetcher, which
   defers. Only other label-definition failures give "not loaded" (moderation
   then covers, fail closed).
3. **The browser reads it.** After hydration, a deferred page reads its
   route from the address and asks `appview` (the origin the server named)
   itself. With a Bluesky account active, it swaps in the signed-in client
   render as any Bluesky page does. Otherwise (signed out, or a Mastodon
   account) it runs `signedOutProfilePage` / `signedOutThread` from the
   package (`components/_bluesky-public.ts`): the **same** guard, mapping
   and moderation as the server, before anything renders, with the
   browser's DOMPurify for the HTML. The SDK comes in the `bsky` chunk,
   loaded only on a deferred Bluesky page. A failed browser read is the
   page's error message, which names the address the reader typed.
4. **A late answer is dropped.** The browser uses its result only if its
   page is still connected and the address is still the one it started
   from (`stillOn` in `components/_bluesky-route.ts`). It checks before it
   sets the page's data and before `replaceDidRoute`, so a slow answer never
   changes the page or the address the reader moved on to.
5. **Not kept.** The page cache never keeps a `deferred` page
   (`_page-cache.ts`): it is only a loading shell, so a revisit asks again.

**The reader check skips Bluesky posts.** `loadReaderViewFrom` asks a
Mastodon reader's server for its copy of server-rendered posts. It never
sends a Bluesky post there: the id means nothing to that server, and the
post would end up "Could not check".

## Accounts

A reader can be signed in to several accounts, on several servers, with one
active. Accounts live in the browser; the server keeps no session.

**Storage keys** (localStorage, through `@beatzball/caribou-state`):

| key | holds |
|---|---|
| `caribou.users` | every account: `[userKey, session]` pairs, in sign-in order |
| `caribou.activeUserKey` | the active account's `userKey` (`name@server`), or `null` |
| `caribou.prefs.<userKey>` | that account's settings: `theme`, `defaultTimeline`, `shortcuts`, `lastSeenNotificationId` (removed on its sign-out; a 401 keeps it) |
| `caribou.drafts.<userKey>` | that account's compose drafts (removed on its sign-out; a 401 keeps them) |

**Switching reloads the page.** A switch from the account menu, a sign-out
that leaves another account, and a 401 on the active account all change the
state at once and then call `land()` in `components/_switch-account.ts`. That
one coordinated landing points the instance cookie at the new active
account's server, then does one full navigation: the same page when it means
the same for any account (`pathAfterSwitch`), else `/home`; `/` when no account
is left. When the new active account is Bluesky, `/local` and `/public` go to
`/home` (Bluesky has neither). A Bluesky profile or post path (`/@did:…`,
`/@<dotted handle>`, either with `/<rkey>`; spec 8.4) is kept when the new
account is Bluesky: a DID and an AT URI are global, but only a Bluesky
client can read them. To a Mastodon account it goes to `/home`. A Bluesky account has no server, so
no cookie is written for it.

**Account names.** `fullHandle` is `@name@server` for Mastodon and `@handle`
for Bluesky. A Bluesky account row, in the rail's account menu and on
/settings, says "Bluesky" in its accessible name (`networkLabel`): the
network icon is hidden from assistive technology, and `alice@example.social`
and `alice.example.social` look alike. Mastodon rows do not change. Requests that arrive while a landing runs join it. A 401 on an
account that is not active removes only that account, with no reload.
A 401 for an earlier sign-in of an account (`generation`) changes nothing.
`caribou:session-expired` marks the account expired and changes nothing on
screen. The rules are "Session rules" in `packages/state/README.md`.

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

**`/` goes to the default timeline when an account is active**: `/home`, or
`/local` or `/public` when chosen on /settings. The server cannot know
(the accounts are in the browser), so it renders the sign-in page for every
reader. On `/` only, an inline script in the head
(`server/lib/root-forward-head.ts`) reads the stored accounts before the
first paint and calls `location.replace()` with that timeline, so `/` leaves
no history entry.

Before it leaves it shows the loading screen (`components/_splash.ts`): the
logo, a creeping ring and "Loading…". Chromium never paints a page whose
parser a navigation stopped in the head, so the script first ends `/` with
`document.write('<plaintext hidden>')`: the rest of `/` becomes hidden text,
nothing in it runs, and the screen paints. The theme head script runs before
it on `/`, so the screen has the reader's colors. The target timeline goes on
with the same screen (`server/lib/timeline-splash-head.ts`, a child of
`<html>` outside the rendered page, so hydration does not see it) until it
shows posts, an error, the empty notice or a placeholder (`settleSplash`). A
client-side forward shows it too. While it is up the body is `inert`, so
keyboard focus stays on the screen; leaving the timeline (Back, a link)
removes it at once. After 3 s it shows links to the timeline and to sign in;
after 10 s it goes, whatever happens. With reduced motion the ring stands
still and there is no fade.

When the script
keeps the reader on `/`, it marks `<html>` with `data-caribou-root`, and the
router does not check that load again (the error banner may have consumed a
stashed error by then). A client-side navigation to `/` is checked in
`pages/index.ts`, with the same rules (`components/_root-forward.ts`). `/` stays for `/?add`,
for a sign-in error (`?error=`, or the stashed `caribou.error`), and with no
active account. With storage blocked, or without JavaScript, `/` stays the
sign-in page. The pages send no Content-Security-Policy, so the inline script
runs; a CSP added later must allow it (a hash or a nonce).

**Adding an account** is `/?add`: the sign-in form, which keeps the stored
accounts. The new account becomes active; signing in to one already stored
replaces its token in place. Opened with no account (a stale link), it is the
plain landing.

## Settings

`/settings` holds the active account's settings, saved at once in
`caribou.prefs.<userKey>` through `readPrefs` / `updatePrefs` from
`@beatzball/caribou-state` (they keep the other keys). The server renders
the sign-in placeholder; the page renders the sections after it has read
the session, so a section may read storage when it connects.

**Sections** are listed in `components/_settings-sections.ts`, in page
order. Each is its own element (`caribou-settings-<name>.ts`) that renders
only its controls; the list gives it a `<section id>` and its `<h2>`. To add
one, write the element and add one entry to the list. `/settings#<id>`
scrolls to a section (`<caribou-settings>` does it, because the sections are
in its shadow root, out of reach of the browser's own fragment scroll).

**Storage can refuse.** The page reads the session from `activeUserKey`, not
from storage, so it never throws. With storage blocked it shows the defaults
and a note that they cannot be saved. When a save is refused (blocked or
full), the control goes back to the stored value and a `role="status"` line
says it was not saved.

**Theme**: dark (the default), light, or system. Before the first paint an
inline script at the end of every page's head (`server/lib/theme-head.ts`;
also the 404 page and both sign-in pages, whose CSP allows it by hash)
sets `data-theme` on `<html>` and the theme-color meta; blocked storage
leaves dark. After that `startTheme` (`components/_theme.ts`, from
`app-main.ts`) follows a change on /settings, an account switch, and the
system's setting. `<html>` is outside every template, so hydration is not
touched. Light tokens are `[data-theme="light"]` in
`packages/design-tokens/tokens.css`. `tests/e2e/settings.spec.ts` checks
the first frame.

**Default timeline**: Home, Local or Public. `/` forwards there (above), and
the sign-in completion page goes there for an account that chose one.

**Keyboard**: the shortcuts are on by default; the box turns them off, at
once. Show keyboard shortcuts opens the help sheet.

## Shared controls

Use these instead of a hand-styled `<button>`. Each one wraps a real
`<button>` in its shadow root, so keyboard use and accessibility come from
the browser. Focus is delegated to that button, so the control is one tab
stop. `<caribou-tabs>` is the exception: it holds no button, and each of
its links is its own tab stop (see below). Import the module from the component that renders it; the import
registers the element on the server and the client alike.

| element | attributes | parts | custom properties |
|---|---|---|---|
| `<caribou-icon>` | `name` (a key of `ICONS` in `_icons.ts`), `filled` | — | `--caribou-icon-fill` |
| `<caribou-icon-button>` | `icon`, `label` (required), `pressed`, `disabled`, `soft-disabled`, `count`, `hint`, `description`, `variant` (`default`, `ghost`) | `button`, `icon`, `count` | `--caribou-icon-button-size`, `--caribou-icon-button-icon-size`, `--caribou-icon-button-pressed-fg` |
| `<caribou-button>` | `variant` (`primary`, `secondary`, `danger`), `type` (`button`, `submit`), `loading`, `disabled`, `pressed`, `label`, `hint` | `button`, `spinner` | `--caribou-button-size`, `--caribou-button-bg`, `--caribou-button-fg` |
| `<caribou-tabs>` | `label` (required), `fill` | `nav` | — |

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
- A native `<button>` is right in a few places: an item in a
  `<caribou-menu>` (the caller's light DOM, see below), and a toggle whose
  `aria-controls` names a region in the same root (the status card's Show
  more and Show), since an id cannot reach into a shared control's root.
  A media ALT badge (`popovertarget`) is the same case. The gif play
  toggle in `<caribou-status-media>` stays native too: the button is the
  video itself, and a shared control's box (border, fill, accent when
  pressed) would have to be undone around it.
- `<caribou-button>`: the label is the slotted text. `type="submit"` submits
  its form (through `ElementInternals`) the way a native submit button
  does: after every click listener has run, and not if one of them called
  `preventDefault()`. `loading` sets
  `aria-busy`, shows a spinner and swallows clicks, but keeps the button
  focusable; `disabled` takes it out of use.
- `<caribou-button pressed>` is a text toggle (a filter such as All or
  Mentions). `pressed` has the same three states as on
  `<caribou-icon-button>`; on, it takes the accent fill in any variant.
- `<caribou-button>`: `label` names the button when its text is too short
  to say what it does (the status card's "edited" mark is named "Edited
  2h ago. Show edit history"); `hint` is its tooltip. Both go on the inner
  button, since an `aria-label` or `title` on the host does not reach it.
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

### `<caribou-tabs>`: tabs that are links

`<caribou-tabs label="Result type" fill>` with the tabs as child `<a href>`
elements. The profile tabs and the search tabs use it.

- Links, not an ARIA tablist: each tab is its own address, so it opens in
  a new tab, works with JavaScript off, and goes through Back and Forward.
  A tablist means a panel in the same page and arrow-key focus, which a
  link to another address does not have.
- The links stay in the caller's own root, slotted into a `<nav>` named
  by `label`. So the caller sets `aria-current="page"` on the active one
  and binds its click handler (`spaClick`, or its own).
- `fill` gives every tab the same width. Without it a tab is as wide as
  its text. On a narrow screen the row scrolls sideways; the page does
  not get wider. There is no scrollbar: a shadow at an edge shows that
  more tabs are that way, with JavaScript off too. Each tab is at least
  44px tall.
- WebKit (Safari's default) skips links on plain Tab; Option+Tab reaches
  them. An e2e test that tabs onto a tab presses `Alt+Tab` on WebKit.
- In Playwright, `getByRole('navigation').getByRole('link')` finds
  nothing: the links are the host's children in the DOM, not the shadow
  `<nav>`'s. Scope by the `caribou-tabs` element instead.

### `<caribou-menu>`: a small menu behind a button

`<caribou-menu icon="ellipsis" label="More">` with the items as children:
real links, and native forms where an item must work without JavaScript.
The phone nav bar uses it for More (Public, Bookmarks, Settings, Sign out).

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
  past the viewport. With `anchored` it opens next to its trigger instead
  (below it, or above it low in the viewport), as in a post's menu.
  `focus()` focuses the trigger. Parts: `trigger`, `icon`, `panel`.
- The items are the caller's light DOM, so the caller styles them. An item
  that is also shown elsewhere at another width must be `display: none`
  there, so its name is in the accessibility tree once. In e2e, check that
  with `ariaSnapshot()`: `getByRole` still finds an item slotted into the
  closed panel.

## Bluesky sign-in endpoints

The browser OAuth client (`@atproto/oauth-client-browser`) needs two things
from this server (spec 5.2 and 10). Both are plain Nitro routes; neither
stores anything.

### `GET /oauth/client-metadata.json`

`server/routes/oauth/client-metadata.json.get.ts`, built by
`server/lib/bluesky-client-metadata.ts`.

- The origin comes from `PUBLIC_BASE_URL` only, never from the `Host`
  header. It is normalized with `new URL(value).origin`, so case and a
  default port do not matter. atproto requires an `https` `client_id`
  with no port. The one exception is a local host (`localhost`,
  `127.0.0.1`, `[::1]`), which may use `http` and any port, for local
  tests and the CI smoke job. Any other value (unset, `http` on a real
  host, a port, a path, a query, credentials) makes the route answer
  404: a guessed `client_id` is worse than none. Local dev does not need
  it; the SDK uses its loopback client there.
- `client_id` is `<origin>/oauth/client-metadata.json`, the exact URL the
  file is served from. `client_uri` is `<origin>`; `redirect_uris` is
  `["<origin>/signin/bluesky"]`.
- A public client: `token_endpoint_auth_method: "none"`, no `jwks`.
  `scope: "atproto transition:generic"`, `grant_types:
  ["authorization_code", "refresh_token"]`, `response_types: ["code"]`,
  `application_type: "web"`, `dpop_bound_access_tokens: true`,
  `client_name: "Caribou"`.
- `Cache-Control: public, max-age=300`. The file changes only with a deploy
  or a new `PUBLIC_BASE_URL`, and an authorization server caches it anyway.
- Health check: `scripts/verify-prod.mjs` fetches the file from the URL it
  probes and fails unless `client_id` equals that URL and `redirect_uris`
  is that origin's `/signin/bluesky`. The `smoke-image` job runs the
  container with `PUBLIC_BASE_URL=http://localhost:3000` so the same check
  runs before merge.

### `GET /xrpc/com.atproto.identity.resolveHandle?handle=`

`server/routes/xrpc/com.atproto.identity.resolveHandle.get.ts`, built by
`server/lib/handle-resolver.ts` and `server/lib/ssrf-guard.ts`. A browser
cannot read DNS TXT records, so the SDK's `handleResolver` points here.
The answer has the shape the SDK's `XrpcHandleResolver` reads:

- `200 {"did": "did:plc:…"}`, `Cache-Control: public, max-age=60`.
- `400 {"error":"InvalidRequest","message":"Unable to resolve handle"}`
  when neither lookup gives a DID. The SDK reads exactly this message as
  "no such handle".
- `400 {"error":"InvalidRequest","message":"Invalid handle"}` for a handle
  that fails the syntax check. No lookup is made.
- `429` over the rate limit, `503` when 16 lookups are already running.
  Every error is `no-store`.

The rules, in order. Each one has a test in
`server/lib/__tests__/ssrf-guard.test.ts` or
`server/lib/__tests__/handle-resolver.test.ts`.

1. **Handle syntax first.** The atproto handle grammar: labels of
   `[a-z0-9-]`, 1–63 characters, no leading or trailing hyphen, at least two
   labels, the last label starts with a letter, 253 characters at most.
   Lowercased before use. The reserved TLDs atproto refuses (`.alt`,
   `.arpa`, `.example`, `.internal`, `.invalid`, `.local`, `.localhost`,
   `.onion`, `.test`) are refused. An IP address is never a handle.
2. **DNS first.** TXT `_atproto.<handle>`. Exactly one distinct
   `did=<did>` value counts; none or two different ones count as no
   answer. A DNS answer wins: HTTPS is tried only when DNS gives none.
3. **Answer only a DID, by the atproto method rules.** The DNS value and
   the HTTPS body (trimmed) must be `did:plc:<24 base32 chars>` or
   `did:web:<host>`. The `did:web` host must pass rule 1 (syntax, no
   reserved TLD, not an IP address) and has no port: atproto allows a
   port only for `localhost`, which rule 1 already refuses. Anything else
   counts as no answer, on both the DNS and the HTTPS path.
4. **HTTPS only on port 443.** `https://<handle>/.well-known/atproto-did`,
   `GET`, no cookies, no credentials.
5. **Resolve once, vet every address.** The host is looked up once: A and
   AAAA records through a `dns.promises.Resolver`, which can be cancelled
   (not `dns.lookup`, which cannot). If **any** address is special, the whole
   lookup is refused; a host that mixes public and private addresses is not
   trusted. Special means, for IPv4: `0.0.0.0/8`, `10.0.0.0/8`,
   `100.64.0.0/10` (CGNAT, and Alibaba's metadata address), `127.0.0.0/8`,
   `169.254.0.0/16` (link-local, and the cloud metadata address
   `169.254.169.254`), `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`,
   `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`,
   `203.0.113.0/24`, `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved and
   broadcast). For IPv6 the rule is an allow list: only global unicast
   `2000::/3`, and inside it not `2001::/23` (IETF special use, Teredo),
   `2001:db8::/32` (documentation) or `2002::/16` (6to4). So loopback,
   unspecified, IPv4-mapped (`::ffff:0:0/96`), NAT64 (`64:ff9b::/96`),
   unique local (`fc00::/7`, and AWS's `fd00:ec2::254`), link-local and
   multicast are all refused.
6. **Connect to the vetted address only.** The request goes to that IP
   literal; the host name is used only for TLS (SNI and certificate check)
   and the `Host` header. There is no second DNS lookup, so a resolver that
   answers a public address to the check and a private one to the connect
   (DNS rebinding) cannot reach the private one. When the connection to one
   vetted address fails (refused, unreachable, timed out), the next vetted
   address is tried. An HTTP answer or a TLS failure is final.
7. **Redirects are checked like the first hop.** At most 3. Each target must
   be `https:` on port 443 with no credentials. Its host name must pass all
   of rule 1 (syntax, no reserved TLD); an IP literal goes straight to the
   address check. Then rules 5 and 6 run again for it.
8. **Limits.** 3 s for the whole lookup (DNS, every hop and the body), 2 KB
   body (more is a failure, not a cut), at most 3 redirects, at most 16
   lookups at once (then 503), 30 requests per client IP per minute (then
   429). The client IP is the last `X-Forwarded-For` entry (the one the
   proxy in front of us added), else the socket address.
9. **Cache.** An answer is kept for 5 minutes (under the 10 the spec
   allows). A real "no answer" (no DID in DNS, and HTTPS answered without
   one or was refused by rules 4–7) is kept for 30 seconds. A null that
   came from the deadline or a passing error (a DNS server failure, a
   connection or TLS error) is not kept, so the next request tries again.
   At most 5,000 handles. The same handle asked twice at once makes one
   lookup.
10. **A lookup holds its slot until its work is over.** One of the 16
    slots is held until every DNS and HTTPS operation the lookup started
    has settled or been cancelled, not only until the answer is sent. At
    the deadline every running operation is cancelled (the DNS resolver's
    `cancel()`, the request's abort signal). The signal is checked before
    each phase (TXT, then the address lookup, then each connection), so no
    phase starts after the deadline.

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
