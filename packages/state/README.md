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
- `thread-store` — direct seeding. The focused/context signals are
  flipped straight to `{ status: 'ready', data: ... }` from `opts.initial`;
  `load()` is a no-op when both signals are already `ready`. There's no
  pagination to hand off.

## Viewer state: slots and who wins

A post's viewer state is what the reader did to it. One rule decides
which copy of a post may change it (spec 6.3, seam 4). It is the same
for Mastodon and Bluesky. The code is `caches.ts` (`viewerOf`,
`readSource`, `slotWriteStarted`, `slotWriteFinished`).

**Words.**

- **Slot.** One action's flag and its record ref, kept together:
  `like` = `favourited` + `bluesky.likeUri`, `repost` = `reblogged` +
  `bluesky.repostUri`, `bookmark` = `bookmarked`. A Mastodon post has no
  record refs; its slots are the flags only. Slots are separate: a like
  in flight does not hold back a repost.
- **Other viewer fields.** `muted`, `pinned`, and on a Bluesky post
  `replyDisabled` and `embeddingDisabled`. `filtered` and a poll's vote
  keep their own rules (the app README's "Which copy wins").
- **Source.** Where a copy came from. `readSource(owner)`, read just
  before the request starts, gives `{ owner, startedAt }`: the account
  whose token fetched it, and the viewer clock at that moment.
  `PAGE_DATA` is the server's page data: no token, and maybe older,
  because it passes through the server's upstream cache.
- **The reader's copy.** A copy whose source's owner is the active
  account. A Bluesky copy must also name that account in
  `bluesky.viewerOf`. Page data is never the reader's copy.
- **The viewer clock.** A number that goes up by one each time a slot
  write finishes.

**Who writes a slot.** Only two things:

1. The reader's own action (`mutations.ts`). It writes at once
   (optimistic) and marks the slot as written to. When the server answers,
   it writes the answer (commit) or puts the old flag and ref back
   (rollback). Either way the write is finished: the slot records the
   clock (after one step up), the time, the flag it ended with, and the
   client's lag window.
2. A copy, by the merge rule below.

**The merge rule, for each slot.** A copy changes the slot only when all
four hold. Otherwise the slot keeps its cached flag and ref.

1. It is the reader's copy.
2. No write to the slot is out.
3. Its fetch started at or after the slot's last write finished
   (`startedAt >= finishedAt`).
4. It agrees with the slot's last write, or the lag window has passed
   since that write finished. The window is the writing client's
   `capabilities.readLagMs`: 60 seconds on Bluesky, whose AppView can lag
   behind a write; 0 on Mastodon, which reads its own writes at once.

When a slot is kept, the count beside it (`favouritesCount`,
`reblogsCount`) is still the copy's, so other readers' likes show. It
moves by one when the kept flag differs from the copy's flag: that copy's
count does not hold the reader's write yet. A merge also keeps the rule it
always had for counts (the app README's "Which copy wins").

The other viewer fields follow rule 1 only: the reader's copy wins,
any other copy keeps what is cached.

**When nothing is cached for the post.** The copy is cached as it is.
Page data has no viewer state (Mastodon leaves the fields out; a Bluesky
public copy says "not done"). One exception: a copy whose
`bluesky.viewerOf` names another account is cached without its viewer
fields, so one account's like never shows as another's (#131).

**Defaults.** `cacheStatus(s)` with no source means "the active reader
fetched it just now". `mergeStatus(s)` with no source means page data.
Every store passes a real source from `readSource` taken before its
request. That is what makes rule 3 work.

**An account change** empties every slot record, with the reader flags
(`forgetReaderFields`). A write still out for the old account finds a
new owner generation when it answers and writes nothing.

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
