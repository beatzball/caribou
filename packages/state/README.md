# @beatzball/caribou-state

> Signal-based stores that hold the client's view of Mastodon data.

**Status:** Coupled by design — exists to glue Caribou together.

## Purpose

Caribou's UI components are mostly stateless renderers. This package owns the
mutable state behind them: who's signed in, which statuses we've fetched,
which thread is in focus, what the timeline polling background task last
saw. Anything that has to be observed from the DOM lives here.

The shape is two-layer: an ID-keyed cache of every status and account we've
ever seen, plus per-screen stores that hold ordered lists of IDs. Stores never
own entity objects — they hold IDs and project through the cache. Two screens
showing the same status share one cache row, so a like, boost, or edit
propagates without coordination.

## Position in the stack

- **Depends on:** `@beatzball/caribou-auth` (UserKey), `@beatzball/caribou-mastodon-client` (CaribouClient + errors), `@preact/signals-core`, `masto`
- **Depended on by:** `apps/caribou` (every page) — no other package
  consumes it
- **Boundary it owns:** the in-memory shape of a logged-in session.
  Network, retries, and dedup are the client's job; rendering is the app's
  job; this package is the bookkeeping in between.

## Public API

Sources of truth — see file for full signatures.

**Caches** (`caches.ts`)

- `statusCache`, `accountCache` — read-only signals of `Map<id, T>`.
  Treat as immutable; write through the helpers below.
- `cacheStatus(s)` — write a status, cascades into `cacheAccount(s.account)`.
- `cacheAccount(a)` — write an account.
- `updateStatus(id, patch)` — shallow-merge into an existing status; silent
  no-op if the id is not cached.

**User session** (`users.ts`)

- `users`, `activeUserKey`, `activeUser`, `activeClient` — signals.
- `addUserSession(s)`, `removeActiveUser()` — mutators that also persist
  to `localStorage`.
- `loadFromStorage()`, `saveToStorage()` — explicit hydration boundary.
- `markExpired(userKey, generation)`, `removeSession(userKey, generation)` —
  what a failure may do to a session. The rules are below.
- `emitSessionExpired(detail)` — the event a client sends when the network
  says its credentials are gone.
- `isBlueskySession(s)`, `blueskyUserKey(did)`, `setBlueskyDriver(d)`,
  `blueskyRestore`, `signOutBluesky(userKey, generation)` — the Bluesky
  session parts. The rules are below (8 to 12).

**Session rules** (`users.ts`; the handlers are in
`apps/caribou/components/_unauthorized.ts`)

A session has a `generation`: a random id made at each sign-in. It names that
sign-in, not a token. A client is made for one session and keeps that
session's `generation`.

1. **A sign-in always wins.** It writes a new entry under the key, with a new
   `generation` and no `expired`. It replaces whatever was there.
2. **A failure names its sign-in, and storage decides.** Every failure event
   carries the `userKey` and the `generation` of the client that saw it.
   Another tab can sign in, sign out or add an account at any time, and this
   tab's memory does not see it. So a failure reads `caribou.users` from
   `localStorage` first. It changes anything only when the **stored** entry
   for that `userKey` has that `generation` (and this tab's entry has it
   too). With no stored entry (signed out elsewhere) or another `generation`
   (signed in again elsewhere), it is `'stale'`: nothing changes, in storage
   or in memory. When it matches, it writes the stored map with only that one
   entry changed; every other stored account stays as storage has it. This
   tab's account list then becomes that map. If the account active here is
   not in that map (another tab signed out of it), the active key becomes the
   stored one when it is in the map, else null. A late failure from an
   earlier sign-in never touches a later one, in this tab or another.

   **Limits.** This holds when the other tab's write finished before this
   tab reads storage. The read and the write are not one step across tabs: a
   write from another tab between them can be lost. Other writes (a switch,
   a sign-in in the app, a sign-out, `loadActiveAccount`) still write this
   tab's whole map. Cross-tab coordination for every writer is issue #214.
3. **Credentials gone: `caribou:session-expired`** `{ userKey, generation }`.
   The entry gets `expired: true` and stays. Its prefs, its drafts, the
   active account and the page all stay. Only a sign-in (rule 1) clears
   `expired`. Marking it twice is the same as marking it once. No client
   sends this event yet; the Bluesky client will.
4. **A Mastodon 401: `caribou:unauthorized`** `{ userKey, generation }`. The
   entry is removed (rule 2 guards it). Its prefs and drafts stay in
   `localStorage`, so a new sign-in to the same account finds them. When it
   was the active entry, the app moves to the next account, or to `/`.
   Whether Mastodon should use rule 3 instead is a separate issue (spec 5.6).
5. **Network errors, timeouts and 5xx change no session.** They send no
   event. The request fails like any other.
6. **Only a sign-out deletes local data.** `signOutActive` and
   `removeActiveUser` remove the entry, its prefs and its drafts.
7. **A late result writes only to its own sign-in.** `loadActiveAccount`
   stores the account only while the entry has the `generation` it started
   with. It keeps `expired` as it is. For a Mastodon session it loads the
   account once (while `account` is null). For a Bluesky session it loads it
   on every page load and also writes the handle from it, so a changed
   handle shows after the next load.

`loadFromStorage` fills a missing `generation` from the token. So an entry
stored before these rules keeps its guard: a new sign-in has a new token.

**Bluesky sessions** (`users.ts`, `bluesky-session.ts`; spec 5.5 and 5.6)

A session is a `MastodonSession` or a `BlueskySession`. A Bluesky session
has `network: 'bluesky'`, `did`, `handle` and `pds`, and no token: the SDK
keeps the tokens and the DPoP key in IndexedDB under the DID. Its
`userKey` is `<did>@bsky`. A Mastodon entry has no `network` field
(entries stored before Bluesky have none either). Rules 1 to 7 hold for
both networks. These add to them:

8. **`activeClient` stays synchronous.** For a Bluesky session it returns a
   client at once. `userKey`, `capabilities` and `timelineOrder` answer at
   once. Every other method waits for one restore of the OAuth session
   (`oauthClient.restore(did)`), then runs on the real client.
   `blueskyRestore` is `'idle'`, `'pending'`, `'ready'` or `'failed'`;
   screens show the splash while it is `'pending'`.
9. **One restore per sign-in.** The restore is kept by `userKey` and
   `generation`. `activeClient` makes a new client object each time the
   active entry changes (for example when its account loads); a new object
   for the same sign-in uses the same restore, and `blueskyRestore` does not
   go back to `'pending'`. When the restore succeeds, every later call uses
   that client. When it fails with a network error, the call fails like any
   other (rule 5) and the next call tries the restore again. The session is
   gone when the SDK says so (refresh refused, token revoked, its `deleted`
   event) or when any request answers 401, with or without a token
   challenge. Then the client sends `caribou:session-expired` with its own
   `generation` (rule 3) and every call fails with `unauthorized`. A
   network error, a timeout or a 5xx is not a 401 and changes nothing. A
   Bluesky client never sends `caribou:unauthorized`.
10. **The restore runs only through the driver.** This package never loads
    the atproto libraries. The app sets a driver (`setBlueskyDriver`) that
    loads them with a dynamic `import()`. With no driver, every call fails
    with `unauthorized` and nothing is sent.
11. **Sign-in checks who signed in.** The DID of the new session must equal
    the DID the typed handle resolved to (or the typed DID). With a PDS host
    typed, any account on it may sign in. A sign-in to a DID that is
    already stored replaces its entry (rule 1), so it clears `expired`.
    **A failed attempt never changes another account's session.** On a
    mismatch nothing is added under the typed handle. The SDK has already
    swapped the code and stored a session for the DID that signed in, and
    it revoked that DID's earlier session to do so. So:
    - When that DID is not a Caribou account, the app revokes the new
      session too. Nothing is stored.
    - When that DID is already a Caribou account, the new session stays: it
      is now that account's only session. `renewSession(userKey)` gives the
      entry a new `generation` and clears `expired` (rule 1). The active
      account does not change.
12. **Once sign-out starts for a DID, the SDK's session store refuses
    every write for that DID until a new sign-in for that DID starts.**
    `signOutBluesky(userKey, generation)` asks the driver to sign out. The
    driver marks the DID as signing out, then deletes its stored session
    (tokens and DPoP key). A delete always works; a write for that DID is
    dropped, so a refresh that was already running cannot put tokens back,
    whenever it lands. The server revoke is tried after that, best effort,
    and the driver does not wait for it. When the driver has answered, the
    entry, its prefs and its drafts are dropped (rule 6), only while the
    entry still has that `generation`; the landing goes on only after that.
    When the local delete itself fails, the driver throws and the entry
    stays: the account is not shown as signed out while its tokens are
    still stored. Same tab only; other tabs are #214. The Mastodon
    `/api/signout` route is not used.

`userName(user)` for a Bluesky session is the loaded account's handle
(`account.acct`), else the stored `handle` (rule 7 keeps the two in step).

**Stores**

- `createTimelineStore(kind, opts)` — `home` / `local` / `public`. Supports
  SSR seeding (`opts.initial`) and visibility-aware polling.
  The new-posts buffer keeps the order the client gives
  (`client.timelineOrder(kind)`); with no client, Mastodon's.
  In feed order (`timelineOrder` null) only checks fill the buffer, never
  page data. Each check asks from the top shown post, and its answer
  replaces the buffer. An answer that does not reach that post is a gap:
  `gap` turns true, and `applyNewPosts()` replaces the list with it. No
  view shows `gap` yet. One check runs at a time.
  Bookmarks take the feed-order path too; the real client answers a
  bookmarks check with an empty page, so bookmarks never fill the
  new-posts banner.
- `createThreadStore(client, statusId, opts)` — focused status + ancestors
  + descendants, fetched in parallel via `Promise.allSettled`.
- `createProfileStore(accountId, tab, opts)` — `posts` / `replies` / `media`
  with `loadMore` cursor.
- `createAccountCache(clientSource)` — handle → Account memo with
  in-flight dedup.

**Glue**

- `bindSignals(instance, read)` — subscribe a custom-element host to a
  set of signals; returns a disposer. Prefers `instance.update` (Elena)
  and falls back to `instance.requestUpdate` (Lit) — Elena wins if both
  exist.
- `startPolling({ intervalMs, fn })` — `setInterval` that pauses on
  `document.hidden`.

## How it works

The three decisions that shape everything else:

**Map replacement on every write.** Signals fire on identity change, not
mutation. Every cache write allocates a fresh `Map`, copies the prior
contents, and assigns to `.value`. That's the cost of getting "this status
changed → both timelines re-render" without subscription bookkeeping. For
realistic Mastodon timeline sizes (hundreds, low thousands) it's still cheap
and the simplicity beats a more clever immutable structure.

**List stores hold IDs; the cache owns objects.** `timeline-store` and
`profile-store` hold `signal<string[]>`; the user-facing `statuses` is
`computed(() => ids.map(id => cache.get(id)))`. Two consequences: (1)
edits to a status appear in every list that referenced its ID with no
extra wiring, and (2) two screens showing the same status never go stale
relative to each other because there's only one source of truth.
`thread-store` is the exception: it holds the focused status and context
directly inside an `AsyncState<T>` signal because a thread is a one-shot
view with no cross-screen sharing to gain. It still side-effects into the
cache (so timelines pick up freshly-fetched statuses) but doesn't read
through it.

**SSR seeding is opt-in via `opts.initial`, with three slightly different
shapes.** All three stores accept seed data and skip the redundant
fetch on construction; the differences are in pagination handoff:

- `timeline-store` and `profile-store` — full handoff. Each sets
  `firstLoadConsumed = true` so `load()` no-ops once, *and* keeps
  `opts.initial.nextCursor` as its cursor for `loadMore`'s first call.
  After that each page's `nextCursor` names the next one. The cursor is
  opaque: a store never derives it from a status id, because another
  network's cursor is not one. The Mastodon client sets it to the last
  status id (or the Link header's id for bookmarks), and null at the end.
  **The list ends only when the client says so, with `nextCursor === null`.**
  An empty page with a cursor is not the end: a Bluesky page can be empty
  and still have older posts (every post on it deleted, blocked, or
  unreadable). `hasMore` is `cursor !== null`. The Mastodon client gives
  an empty page a null cursor (no last id, and Mastodon sends no Link
  header for an empty page), so Mastodon ends as before. Each
  `loadMore()` reads one page; the scroll anchor asks again only after the
  last page has rendered, so a run of empty pages is one request at a
  time, never a tight loop.
- `thread-store` — direct seeding. The focused/context signals are
  flipped straight to `{ status: 'ready', data: ... }` from `opts.initial`;
  `load()` is a no-op when both signals are already `ready`. There's no
  pagination to hand off.

## Viewer state: slots and who wins

A post's viewer state is what the reader did to it. One rule decides
which copy of a post may change it (spec 6.3, seam 4). It is the same
for Mastodon and Bluesky. The code is `viewer-slots.ts` (`settleViewer`,
`readSource`, `slotWriteStarted`, `slotWriteFinished`).

**Words.**

- **Slot.** One action's flag and its record ref, kept together:
  `like` = `favourited` + `bluesky.likeUri`, `repost` = `reblogged` +
  `bluesky.repostUri`, `bookmark` = `bookmarked`. A Mastodon post has no
  record refs. The count beside a slot (`favouritesCount`,
  `reblogsCount`) goes with it. Slots are separate: a like in flight does
  not hold back a repost.
- **Other viewer fields.** `muted`, `pinned`, and on a Bluesky post
  `replyDisabled`, `embeddingDisabled` and `viewerOf`. `filtered` and a
  poll's vote keep their own rules (the app README's "Which copy wins").
- **Viewer fields.** The slot flags and refs plus the other viewer
  fields. One list in `viewer-slots.ts` (`VIEWER_FIELDS`,
  `BLUESKY_VIEWER_FIELDS`). With the viewer fields removed, a post is as
  a signed-out reader sees it: no flags, refs null, `replyDisabled` and
  `embeddingDisabled` false.
- **Source.** Where a copy came from. `readSource(owner)`, read just
  before the request starts, gives `{ owner, startedAt }`: the account
  whose token fetched it, and the viewer clock at that moment.
  `PAGE_DATA` is the server's page data: no token, and maybe older,
  because it passes through the server's upstream cache.
- **Three kinds of copy.**
  - **The reader's copy.** Its source's owner is the active account. A
    Bluesky copy must also name that account in `bluesky.viewerOf`.
  - **Another account's copy.** Its source's owner is not the active
    account (a late answer to a fetch the last account started), or its
    `bluesky.viewerOf` names an account that is not the active one.
  - **Page data.** Neither: `PAGE_DATA` with no other account named.
- **The viewer clock.** A number that goes up by one each time a slot
  write finishes.
- **A Bluesky decision stays with its reader.** `bluesky.moderation` was
  made for the reader in that copy's `bluesky.viewerOf` (or for no reader).
  The two always travel together. When the merge keeps the cached
  `viewerOf` (another account's copy, page data), it keeps the cached
  `moderation` too. When it clears `viewerOf` (another account's copy with
  nothing cached, an account change), it drops `moderation`: a screen then
  covers the post until a copy for the current reader arrives (app README,
  "A decision belongs to one reader").

**Who writes a slot.** Only two things:

1. The reader's own action (`mutations.ts`). It writes at once
   (optimistic) and marks the slot as written to. When the server answers,
   it writes the answer (commit) or puts the old flag and ref back
   (rollback). Either way the write is finished: the slot records the
   clock (after one step up), the time, the flag and ref the cached post
   ended with, and the client's lag window.
2. A copy, by the merge rule below.

**The merge rule, for each slot.** A copy changes the slot only when all
four hold. Otherwise the slot keeps its cached flag and ref.

1. It is the reader's copy.
2. No write to the slot is out.
3. Its fetch started at or after the slot's last write finished
   (`startedAt >= finishedAt`).
4. It agrees with the slot's last write, or the lag window has passed
   since that write finished. To agree, the copy's flag and its record
   ref must both be what the write left (a Mastodon copy has the flag
   only). The window is the writing client's `capabilities.readLagMs`:
   60 seconds on Bluesky, whose AppView can lag behind a write; 0 on
   Mastodon, which reads its own writes at once.

**Counts.** A copy's count and flag come from one server read, so the
count holds the reader's own action exactly when the flag does.

- When the copy changes the slot, its count is taken as it is. No other
  rule moves it.
- When the slot is kept, the count is the copy's, moved by one to match
  the kept flag (+1 when the kept flag is on and the copy's is off, -1
  the other way). Other readers' likes still show, and the reader's own
  action is counted once.

The other viewer fields follow rule 1 only: the reader's copy wins.

**Copies that are not the reader's.** They never bring viewer state.

- **Another account's copy** keeps every cached viewer field. A field
  the cache does not have is removed. With nothing cached, the copy is
  cached with its viewer fields removed. This holds on both networks.
- **Page data** keeps every cached viewer field. A field the cache does
  not have is the copy's (page data has none: Mastodon leaves the fields
  out, and a Bluesky public copy says "not done"). Its counts are the
  copy's, with two exceptions. While a write to the slot is out, the
  cached count stays. When the cached flag is on, a lower count stays
  cached: page data passes through the server's upstream cache and can
  be older than the reader's own write.

**With nothing cached**, the reader's copy and page data are cached as
they are. Rules 2 to 4 need a cached post: they decide between a copy
and the cached slot. A write to a post that is not cached writes
nothing, so there is nothing to keep. Every list caches its posts before
it shows a card, so a card's write always has a cached post.

**Defaults.** `cacheStatus(s)` with no source means "the active reader
fetched it just now". `mergeStatus(s)` with no source means page data.
A store or component that fetches with the reader's token passes a
source from `readSource` taken before its request. That is what makes
rule 3 work. A copy that came from the page (a thread's or timeline's
server data, the card's own copy) stays page data.

**An account change** removes every viewer field from every cached post
(nested posts too) and empties every slot record (`forgetReaderFields`).
A write still out for the old account finds a new owner generation when
it answers and writes nothing, so no slot stays marked as written to.

**Relationships** (`relationships.ts`) follow the same rule. The cache
is keyed by the reader's UserKey, so every read is the reader's copy. A
read does not replace the cached relationship while a write is out, when
a write started after the read did, or inside the lag window after a
write finished when it disagrees with what that write left
(`following`, `requested`, `muting`, `blocking`).

**Network.** Each post and account says its network: it has a `bluesky`
field or it is Mastodon (`resourceNetwork` in the client package). The
reader can act on a resource only when the active client's network is
the resource's (`canActOn`). A Mastodon post also needs the reader's
server, as before.

## Notifications (`notifications-store.ts`, `notification-groups.ts`)

**Paging, both networks.** A list ends only when the client says so, with
`nextCursor === null`, as for timelines. An empty page with a cursor keeps
"Load older". `loadMore()` sends the last page's `nextCursor` back as
`cursor`, as it came. The Mastodon client gives a single-notification page
the last id as its cursor and an empty page `null`; a grouped page the
oldest id it covers, and no groups `null`. So Mastodon ends where it did.

**Mastodon** is as before: the server's groups (4.3+), else single ones
grouped here by `groupNotifications` (same type on the same post, or a
follow, on the same UTC day), ordered by id. The seen marker is the local
`lastSeenNotificationId`.

**Bluesky** (`client.capabilities.network === 'bluesky'`) has no server
groups, no `min_id` and no id order. Its list:

- **Order:** by `indexedAt`, newest first. Equal times keep the order the
  AppView sent. Never by id: an AT URI sorts by DID.
- **Grouping** (`groupBlueskyNotifications`): likes, reposts and follows
  group. The key is the type, the post's URI (none for a follow) and the UTC
  day of `indexedAt`: `favourite:<post uri>:2026-11-08`,
  `follow::2026-11-08`. So a group is "these people liked this post on that
  day", and two pages never disagree on where a notification goes: the day
  is fixed, not a window that moves with the newest one. Every other type
  is a row of one. The whole list is grouped again on every change.
- **Place:** a row sits where its newest notification is. When a poll
  brings a new like for a group, the row keeps its key (an open "Show all"
  stays open) and moves to the top, as a Mastodon group does. Who did it:
  newest first, each account once. `count` is how many notifications the
  list holds for it; `complete` is true (the list has every one it loaded).
- **Poll:** `fetchNotifications({ sinceId: <newest uri>, sinceAt: <its
  indexedAt> })`. The client reads from the top until it meets that one, or
  the first one older than its time when it was deleted (README of the
  Bluesky client). Met: the new ones are merged above, and rows "Load older"
  brought in stay. Not met (a gap, more than 150 new): the list is replaced
  by what was read, and its cursor goes on from there. Nothing is lost:
  older ones are under "Load older".
- **Unknown reasons** never reach the store: the client skips them.

**A replaced list is a new generation (both networks).** `load()`, a gap
poll, and a poll that loads the first page into an empty list replace the
list or its cursor. Each starts a new generation, so an answer to a request
made before it (a "Load older" in flight) writes nothing: no old rows, no
old cursor. The request it drops no longer holds the list as loading.

**A poll on an empty list** loads the first page only until a first page
has come in. After that, an empty first page changes nothing: it must not
bring back "Load older" for a list that has already read to its end.

**Unread badge.** `unreadNotificationCount` is the one count the nav rail
reads. `startUnreadNotifications()` follows the active session (for
Bluesky its `generation`; there is no token). On every session change,
also A → B → A, the count is 0 at once and an answer for the old session
is dropped.

- Mastodon: notifications newer than the local marker, one page at most.
- Bluesky: `client.getUnreadCount()`, the server's count, capped at
  `UNREAD_CAP` so the rail says "40+". A count whose request started before
  the last `updateSeen` landed is dropped: it can still count what the
  reader just saw.

**`updateSeen` (Bluesky)** is sent by `markBlueskyNotificationsSeen`, which
`<caribou-notifications>` calls at the moment a Mastodon list moves its
marker: the "All" list (not "Mentions") has loaded or polled, it has
rendered, the tab is visible, the router has shown the page, and the
session is still the one the list was loaded for. Then:

- `seenAt` is the store's `seen.newestAt`: the newest `indexedAt` the list
  has read from the top (load and polls, not "Load older"), skipped
  reasons included. A skipped reason has nothing to show, so it is seen
  with the rest; else the badge would count it forever.
- It is sent only when the list read an unread one (`isRead: false`) and
  `seenAt` is newer than the last `seenAt` this browser sent for the
  account (`lastSeenNotificationAt` in its prefs). So it is sent once per
  new notification, also across reloads, and never moves back.
- It goes to the active client only when that client is for the same
  `userKey`, and the active session has the same `generation`, when it is
  sent. One request per account at a time; a newer `seenAt` asked for
  meanwhile is sent after it.
- On success, `lastSeenNotificationAt` moves, and the badge goes to 0 if
  that session is still active. On failure nothing changes, and the next
  view or poll tries again.

## Gotchas

- **Don't mutate cache Maps directly.** Direct `.set` skips the signal-write
  and consumers won't re-render. Always go through `cacheStatus`,
  `cacheAccount`, `updateStatus`, or assignment to `.value`.
- **Don't mutate an object *after* caching it.** `cacheStatus(s)` stores
  `s` by reference, not by clone. Mutating `s.favourited = true` outside
  the cache will silently update every consumer's view without firing
  the signal — they'll re-render late or not at all. Treat fetched
  status/account objects as frozen the moment they enter the cache.
- **`updateStatus` is silent on miss.** If the id was evicted (or never
  cached), the patch is dropped without warning. Currently nothing evicts,
  so this is dormant — but if eviction ever lands, races between a fetch
  and an interaction (fav, boost) will silently lose data. Prefer
  `cacheStatus` for full objects.
- **`activeClient` creates a new client per `activeUser` identity change.**
  That's fine for the components that subscribe via `bindSignals`, but a
  caller that captures `activeClient.value` in a long-lived closure will
  hold a stale client across user switches.
- **`account-cache`'s `handleToId` never invalidates.** A renamed or
  re-pointed handle will keep returning the old account for the lifetime
  of the cache. Page reload is the workaround.
- **`users.ts` reads/writes `localStorage` synchronously and unconditionally.**
  `loadFromStorage` will throw on SSR if anyone calls it server-side; only
  call from app entry points that run in the browser. Same for
  `addUserSession` / `removeActiveUser`.
- **Polling fires immediately on `visibilitychange → visible` *and*
  starts the interval.** Near rapid visibility flapping, you may see
  back-to-back fires. The poll function should be idempotent (it is —
  `sinceId` makes it a no-op when nothing's new).

## Externalization potential

**Coupled by design.** The patterns (signal-keyed entity cache, ID-list
stores, SSR seeding via `initial`) are reusable, but every concrete API
in this package speaks Mastodon — `mastodon.v1.Status`,
`mastodon.v1.Account`, `TimelineKind`, profile tabs that match Mastodon's
filter shape, the `caribou.users` storage key. Extracting a generic
"signal-cache + paginated-list-store" library would mean stripping all
the domain types and re-introducing them as generics, at which point most
of the value (Mastodon-shaped helpers like `cacheStatus` cascading into
`cacheAccount`) goes away. The interesting design is the *pattern*, and
that's better documented than packaged.

## Alternatives considered: signal libraries

`@preact/signals-core` was chosen for: ~1kb gzipped, sync flush (matters
for Lit/Elena's `requestUpdate` cycle), no framework bind, and a
`signal` / `computed` / `effect` API that's a near-1:1 fit for the TC39
Signals proposal. Trade-offs against the alternatives:

| Library | What we'd gain | What we'd give up |
|---|---|---|
| `@vue/reactivity` | Proxy-based reactivity — could mutate the Maps in place and consumers would still re-render | The "every write goes through a helper" discipline disappears, which is half the reason this package is auditable. Also ~3-4× the bundle. |
| `solid-js` | Best-in-class fine-grained tracking; `createStore` gives nested-path reactivity for free | Solid's reactivity is owner-scoped (`createRoot`); we'd need to wrap every Lit/Elena host in a root and propagate disposers. The signal package would stop being a clean leaf. |
| TC39 Signals (polyfill) | Standards alignment; `bindSignals`-equivalent would survive future runtime support without a rewrite | Proposal is still moving; the polyfill is roughly the same size as preact/signals-core but with rougher ergonomics. Worth revisiting once the proposal stabilizes. |
| `nanostores` | Idiomatic for ID-keyed atoms (`atom`, `map`, `computed`) and tiny | The `atom`/`map` split would reshape `caches.ts` and `users.ts` — not a code reduction, just a different vocabulary. |
| `mobx` / `zustand` | Mature ecosystems, devtools | Both are store-of-state models, not signal graphs. `bindSignals`-style "this component reads X and Y, re-render when either changes" becomes manual subscription tracking. |

**The migration cost isn't the API surface — it's the discipline.** The
`computed(statuses)` projection through a signal cache is what makes
"two timelines, one status" work without subscription bookkeeping. Any
swap that loses fine-grained tracking would force every consumer to
declare what it depends on, and every store mutation to publish what
it changed.

## See also

- `apps/caribou` — every page mounts these stores
- `packages/mastodon-client` — the `CaribouClient` interface this
  package consumes
- `docs/superpowers/specs/2026-04-21-caribou-v1-design.md` §12 — SSR
  contract that `initial` implements
