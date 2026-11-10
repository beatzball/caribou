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
- `actAsAccounts(post)`, `actAsClient(session)`, `readAsAccount(userKey, post)`,
  `actAs(userKey, action, post, view)` — act on a post as another
  signed-in account (Bluesky only). The rules are in "Act as another
  account".

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
- `savedFeedsCache`, `loadSavedFeeds(opts)` (`saved-feeds.ts`, #194) — a
  Bluesky reader's saved feeds, keyed by `userKey`, so one account never
  sees another's. `loadSavedFeeds` reads through
  `client.blueskySavedFeeds()`. A copy loaded less than 5 minutes ago
  (`SAVED_FEEDS_FRESH_MS`) answers with no request, so a Home tab click
  does not read the prefs again. An older copy answers at once and is read
  again in the background; a failure there keeps it. With no copy, or with
  `force: true` (a Retry), it reads and throws when the read fails, keeping
  what the cache had. Two loads for one account in flight share one
  request. An answer that lands after the active account changed is still
  stored under the account that read it. A Mastodon client (by `capabilities.network`)
  stores nothing and answers `[]`. Read only: nothing here writes prefs.

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

**Relationships** (`relationships.ts`) follow the same rule, by field
group. The cache is keyed by the reader's UserKey, so every read is the
reader's copy. A write names one group:

| group | fields |
|---|---|
| follow | `following`, `requested`, `bluesky.followUri` |
| block | `blocking`, `bluesky.blockUri`, `bluesky.blockingByList` |
| mute | `muting`, `mutingNotifications`, `bluesky.mutingByList` |

A read is judged one group at a time. It keeps the cached fields of a
group when a write to that group is out, when a write to that group
started after the read did, or inside the lag window after a write to
that group finished, when the read disagrees with what the write left:
any flag **or** the record URI. So a read that says `following: true`
with another `followUri` is refused too (**A2**). Every other field,
and every other group, always comes from the read. A Mastodon client's
lag window is 0.

The group rule is for partial answers (Bluesky acks) only. **A whole
answer drops an old read whole (R2-3).** A Mastodon write answers the
whole relationship, so its answer is newer than every field of a read
that started before the write. That read is dropped whole, as before
#188, and so is a read that lands while a Mastodon write is out. So a
read from before a block never brings "Follows you" back.

**Network.** Each post and account says its network: it has a `bluesky`
field or it is Mastodon (`resourceNetwork` in the client package). The
reader can act on a resource only when the active client's network is
the resource's (`canActOn`). A Mastodon post also needs the reader's
server, as before.

## Bluesky acks (#188)

A Bluesky write answers an ack, not the post or the relationship
(bluesky-client README, "Actions"). The rules above still hold; only the
commit step differs.

- **Status actions (`mutations.ts`).** The ack's `on` sets the flag and
  its `record` sets the record ref (`likeUri`, `repostUri`; a bookmark
  has none). The count stays as the click left it: the ack has no count,
  and the next reader's copy brings one by the merge rule. The slot is
  finished with the ack's flag and record. Rollback, the in-flight guard
  (one click is one write) and the account check (`ownerGeneration`: an
  ack that lands after an account change writes nothing) are as for
  Mastodon.
- **Relationships (`relationships.ts`).** **An ack is partial (A1).**
  It names only the fields its write changed: the flag and its record
  URI. They go over the last answer (`queue.confirmed`); every other
  field stays. With nothing cached, only the named fields are stored, and
  every other field is unknown: absent, neither true nor false. A screen
  shows no Follow / Unfollow choice while `following` is unknown
  (`relationshipKnown`); the profile header and search load the
  relationship, and that read fills the unknown fields (the group rule
  above). `toggleFollow` does nothing while `following` is unknown. The
  next write builds its ref from the last answer, so an unfollow names
  the follow record the follow made.
- **A Bluesky block leaves the follow.** The optimistic block patch
  changes `following` only on Mastodon, whose block ends the follow.
- **A blocked read knows nothing about the follow (R2-1).** While either
  side blocks, the AppView hides the follow, but the follow record stays.
  So such a read leaves `following` and `followUri` unknown
  (`mapRelationship`), and no Follow choice is shown. The profile header
  still shows Unblock when `blocking` is known. After an Unblock ack, the
  relationship is read again, and that read fills the follow. So Unblock
  never leads to a second follow record.
- **The read after Unblock can still see the block (#242).** The AppView
  lags, so that first read can leave the follow unknown. When the caller
  passes its page's `signal` (`setBlock(account, false, { signal })`), the
  relationship is read again at 5 s, at 20 s, and 5 s before the client's
  lag window (`readLagMs`) ends: 55 s on Bluesky. Every read is sent
  inside the window, so a read that still shows the block and answers in
  time cannot undo the Unblock. A slow answer that lands after the window
  ends can still show the old block. The reads go on while the follow is unknown and no block is
  known. The account is taken before the Unblock write starts. No read is
  made once the signal aborts (the page goes) or the active account
  changes, even if it changes back. The profile header passes its signal;
  other callers read once.
- **An undo never claims more than it removed (A3).** A Bluesky block or
  mute can come from a list (`bluesky.blockingByList`,
  `bluesky.mutingByList`: the list's URI). A personal undo cannot remove
  it, so Unblock and Unmute **refuse** it: nothing is sent, the cache
  stays as it is, and the toast says "This block comes from a list.
  Remove the account from the list, or unsubscribe from it." (or "This
  mute comes from a list. …"). The client refuses the same case when
  its own read finds the list, and its error carries that message
  (`userMessage`), which the toast shows.
- **Mastodon** still answers the whole post or relationship, and that path
  is unchanged.

## Bluesky drafts (#189, spec 7.2)

`bluesky-compose.ts`, over the drafts in `compose.ts`.

**What a Bluesky draft holds.** `ComposeDraft.text` (and `language` from a
redraft), plus `bluesky`:

| field | what |
|---|---|
| `reply` | `{ root, parent }` strong refs (`uri` + `cid`). `parent` is the post replied to; `root` is its `replyRef.root`, or the post itself when it is a top post. |
| `quote` | the quoted post's strong ref, or `null` |
| `images` | per image: the blob ref `uploadBlob` answered, its type and size, its alt text, its `aspectRatio` (or `null` when the browser could not read it), the file name |
| `labels` | self-labels from the label menu (`BLUESKY_SELF_LABELS`: `porn` Adult, `sexual` Suggestive, `nudity` Nudity, `graphic-media` Graphic), and any other self-label a redraft carries |
| `rkey` | the record key, made (`blueskyNextRkey`) when the draft is made, and stored with its first save (R6) |
| `sent` | the exact record a send wrote or tried to, frozen with its facets and `createdAt`, and the input it was made from (`blueskyDraftInput`) |
| `card` | a link card (#200): `uri`, `title`, `description`, `image` (the `cardyb` image URL, or `null`), `thumb` (the uploaded blob ref, or `null`). See "Bluesky link cards". |
| `cardDismissed` | the link whose card the reader removed, so it does not come back |

Facets are not kept on their own: they are made from the text at send
time (`blueskyDetectFacets`, which resolves mentions to DIDs) and frozen in
`sent.record`. Slots: `new`, `reply:<parent uri>`, `quote:<quoted uri>`.

**The record** (`blueskyRecord`): `text`; `facets` when there are any;
`reply`; `embed` is `app.bsky.embed.images` (each image with its `alt` and
`aspectRatio`), `app.bsky.embed.record` for a quote, or
`app.bsky.embed.recordWithMedia` for both, or `app.bsky.embed.external` for
a link card when there is neither (K2); `labels` as
`com.atproto.label.defs#selfLabels`: the menu's values in menu order,
**only with images** (the menu labels media, spec 7.4), then any other
value a redraft carried, as it is (#190); `langs` from a
redraft's language; `createdAt`.

**What survives.** All of it is plain JSON in `caribou.drafts.<userKey>`.

| event | the draft |
|---|---|
| reload | kept whole: text, refs, blob refs, alt text, labels, `rkey`, `sent`. The file behind an image is not (memory only); its blob ref is. |
| account switch | kept under its own account; the dialog closes (it posts only as the account it opened for). |
| session expiry | kept (rule: an expiry keeps drafts). A send that failed with the expiry keeps `sent`, so the retry after signing in again checks first. |
| sign-out | removed with the account's other drafts. |
| a 401 that removes a Mastodon session | kept (#215 tracks letting a reader delete it). |

**A draft that can be posted is never empty.** `isDraftEmpty` is false for
a Bluesky draft with text, images, a quote, or `sent`. Those are every field
that alone lets Post send (a reply needs text or images; labels go only with
images). So a quote with no text keeps its stored rkey through an unfreeze,
a close and a reload (R6), and a send in doubt is never dropped.

**One post per click** (`postBlueskyDraft`). Five rules. Every path in the
send follows them; a new path must too.

**R1. Only `getRecord` decides what happened.** After any failed create (no
answer, a timeout, a 5xx, or an answered refusal such as `BlobNotFound` or
"a value already exists at that key"), the send's result is never read from
the error. It is read from `blueskyGetOwnPost(rkey)`:

| the check | result |
|---|---|
| found, and it has this send's content (R7) | posted |
| found, but another record | `earlier-posted`: the reader's current draft is kept with a new rkey |
| absent (`RecordNotFound` only) | the rkey is unused: unfreeze (`sent: null`, same rkey), keep the reader's **current** draft, and throw the create's error |
| the check failed | unknown: the send stays pending, nothing more is sent, the create's error is thrown; the next Post checks again |

Only `RecordNotFound` means absent. A 404, `AccountDeactivated`,
`AccountTakedown`, a 5xx or a network error is "the check failed".

**R2. A retry sends what the reader sees now.** A pending draft (`rkey` and
`sent`) is checked first, by the table above. Found → posted or
`earlier-posted`, nothing is sent. Absent → the **current** draft is frozen
on the same rkey and sent. A late first write is still safe: the second
create fails ("exists"), the check finds the first record, the compare (R7)
says it is another content, and the result is `earlier-posted` with the edit
kept. With no edit, the compare says it is this content, and the result is
`posted`.
No edit is ever replaced by older text, and no draft is stuck: a record the
PDS refuses (a missing blob) unfreezes, so removing the image lets it go.

**R3. Durable before the network.** The frozen draft is written to storage
before `createRecord`, and read back to confirm. If it cannot be stored,
nothing is sent, the caller gets the draft back **unfrozen** (`onDraft`),
and `DraftNotSaved` is thrown ("Could not save the draft, so the post was
not sent."). So every later Post takes the same refused path until storage
works. Without the stored rkey a reload could post twice.

**R4. A send writes storage only for the draft version it owns.** Every save
of a draft gives it a new revision (`rev`, unique, set by `saveDraft` and `storeDraftIf`). A send
reads the slot's revision when it starts, and each write it makes (freeze,
unfreeze, clear on success, the kept draft after `earlier-posted`) happens
only if the stored revision is still the one it owns; a write it makes
moves its own revision on. After every await inside the send (the check,
facet detection) it checks the revision again before the freeze,
and stops (`DraftChanged`, nothing sent) if another save came in. After the
create it only skips its writes. So a dialog closed and reopened during
the send, then edited, keeps its edit: that edit is a pending draft, and its
next Post finds the record and keeps the edit (R2).

**R5. Every message is true.** "Could not save the draft, so the post was
not sent." only when the freeze was refused. "An image was uploaded again"
only when one was.

**R6. A draft gets its rkey when the draft is made**, like a Mastodon
draft's `idempotencyKey`. The dialog makes it (`blueskyNextRkey`) when it
opens a draft that has none, and it goes to storage with the draft's first
save. Every copy of the draft (a reopened dialog, a reload) then has the
same rkey, so one draft makes at most one record, even when two copies are
posted at once. The rkey is kept through an unfreeze. It changes only after
`earlier-posted`, for the kept edits. `postBlueskyDraft` refuses a draft
with no rkey (a `TypeError`): the send never makes one.

**R7. "This is our post" means the same content, not the same `createdAt`.**
A found record is this send's post when its content matches the frozen
record's, field by field: text, reply refs, quote ref, image CIDs and alt
text, self-labels, langs. **Not facets:** a mention's facet is there only
when its handle lookup worked, so two freezes of the same draft can differ
in facets with no edit; facets come from the text, and the text is compared.
The whole record is never deep-compared:
`getRecord` gives the SDK's `BlobRef` objects for images, so a CID is read
from `ref.$link` or from the CID object's string. An rkey belongs to one
draft (R6), so the same content at it is this draft's post. This is what
makes "no answer, the check says absent, the write lands late, Post again"
end as `posted`, not as a second post.

The dialog side (rule 4 of round 1, kept): the dialog captures its owner
(client, account, slot, dialog session) before each await (fit, upload,
re-upload, `recoverBlob`, the target read, the send) and checks it after,
before it touches its state or storage. `onDraft` is applied only while the
owner holds.

After `posted`, the post is read back (`fetchStatus`, 3 tries a second
apart, as the AppView lags). It is cached and `caribou:posted` is sent only
while the client's account is still the active one. A post the AppView does
not have yet answers `posted` with `status: null`.

Tests (`bluesky-compose.test.ts`): a timeout after the write, then a retry,
is one post; a lost answer, a reload, a retry; a lost answer, an edit, a
retry keeps the edit; not found sends the current draft once with the same
rkey (R2); a late first write with an edit keeps the edit (R2); a found
record that is not the frozen one is never read as posted; a failed check
sends nothing (R1); a 400 that is not `RecordNotFound` sends nothing; a
refused first create unfreezes (R1); a pending send whose retry is refused
for a missing blob unfreezes, and removing the image posts (R1, R2);
storage refusing every click sends nothing, then one post after a reload
(R3); a reopened and edited draft survives an old send's success, its late
blob refusal, and a facet lookup that lands late (R4); an answer after an
account switch tells no screen.

### Reply and quote limits (#199)

`bluesky-gates.ts`. The author of a new post can limit who replies (a
thread gate, `app.bsky.feed.threadgate`) and turn quotes off (a post gate,
`app.bsky.feed.postgate`). The draft keeps the choice in `bluesky.gates`
(`BlueskyGates`); a draft with no `gates` has the default.

**G1. Only a new top-level post has limits.** The `new` and `quote:` slots.
A reply cannot set a thread gate: the lexicon says the gate's rkey "must
match the record key of the thread's root post", and a reply is not the
root, so the AppView ignores it. (A post gate on a reply is valid in the
lexicon; Caribou keeps both off for a reply, so a reply has no limit
control at all.) `blueskySentGates` gives `null` for a reply, whatever the
draft holds.

**G2. The default writes nothing new.** "Everyone can reply, quotes on" is
`gates` absent, or `{ replies: null, quotes: true }`. Then the send is
`createRecord` of the post alone, as before #199, and `blueskyDraftInput`
is the same string as before #199 (so a send pending from before still
matches its own input, R1).

**G3. Post and limits land together or not at all.** With a limit, the
send is one `com.atproto.repo.applyWrites`: the post, then the thread gate
(when replies are limited), then the post gate (when quotes are off). All
three use the draft's rkey. `applyWrites` is one commit, so the PDS keeps
all or none. The check after a failed send (R1) reads only the post: the
post found means its limits are there too.

**G4. The limits are part of the send.** They are frozen in `sent.gates`
with the record and are part of `blueskyDraftInput`. A retry of an
unchanged frozen record sends the frozen limits (R2). A limit changed after
a send in doubt is an edit: when the earlier post is found, the result is
`earlier-posted` and the new choice stays in the draft.

The post record alone cannot say which limits landed: a retry that
changed only the limits re-freezes on the same rkey, and the earlier
write may still land first. So when the **check** finds the post (R1, R2),
and its content and input match, the send also reads the gate records at
that rkey (`blueskyGetOwnGates`) and compares them with `sent.gates`
(`sameBlueskyGates`: the same rules in order, no titles; no records is no
limit). Same: `posted`. Different: `earlier-posted`, and the reader's
current choice stays with a new rkey. A failed gate read is "the check
failed": nothing more is sent and the send stays pending. A send answered
by its own create needs no read: that answer is for the limits it sent.

**G5. Who can reply.** `replies` is `null` (everyone), `[]` (nobody), or
some of: people you mention (`mention`), people you follow (`following`),
your followers (`follower`), and one of your own lists (`list`, its id; the client makes the URI in the reader's repo, so no other list can be named).
At most one list, so at most 4 rules (the lexicon allows 5). The rules go
in that order, whatever order they were picked in. Turning off the last
rule goes back to everyone, not to nobody.

**G6. The limit is said in plain words** (`blueskyGatesText`): "Everyone
can reply." / "Nobody can reply." / "Only people you mention, people you
follow, your followers and people on Friends can reply.", then "Quotes are
on." or "Quotes are off."

**G7. A limit alone is draft content.** `isDraftEmpty` is false for a
draft whose limit is not the default, so a limit chosen before any text
is kept through a close or a reload. The default alone is still empty.

**G8. The panel belongs to one account.** The dialog keeps its panel
across openings and passes it the account (`account`). A new account
closes the panel and forgets its lists; they load again for that account
on the next open. A list from another account is never offered.

Tests (`bluesky-gates.test.ts`, `bluesky-compose.test.ts`): each rule's
record shape, the order, nobody, the plain words, a reply never sends
limits (G1), the default sends `createRecord` and keeps the old input (G2),
a limit sends one `applyWrites` call with one rkey (G3), a lost answer then
a retry is one post with its limits, a limit changed after a lost
answer is `earlier-posted`, and (review 1) a pending send with no limits,
then only the limits changed, the check absent, the first write landing
before the retry, is `earlier-posted` with the new limits kept; a failed
gate read stays pending (G4); a limit alone is kept (G7).

## Bluesky link cards (#200, spec 7.2)

`bluesky-link-card.ts`, beside `bluesky-compose.ts`. The fetch is in
`packages/bluesky-client` README ("Link cards"); the dialog's part in the
app README.

- **K1. The draft keeps the card** (`bluesky.card`), so a reload shows it and
  posts it. The draft keeps `thumb` too: a reload or a retry does not upload
  the image again.
- **K2. A card only with no other embed.** `blueskyRecord` writes
  `app.bsky.embed.external` only when the draft has no images and no quote.
  `cardAllowed(draft)` says the same for the dialog. A reply can have a card.
- **K3. The record's embed:** `{ $type: 'app.bsky.embed.external', external:
  { uri, title, description, thumb? } }`. `thumb` only when the blob is
  there. `description` is always a string (the lexicon needs it).
- **K4. The image is uploaded at Post, once** (`prepareCardThumb`). Only for
  a draft with no pending send (`sent` is `null`): a pending send already
  froze its record, and changing the draft would make R7 read our own post
  as another. With a card that has an `image` and no `thumb`: fetch it, fit
  it to 1 MB (the lexicon's cap), upload it. Success stores `thumb`. Any
  failure stores `image: null`, so the card is posted without an image and
  a retry is the same post. The account is checked after every await: an
  answer for another account changes nothing.
- **K5. Same post, same card.** `blueskyDraftInput` and R7's compare include
  the card's `uri`, `title`, `description` and thumb CID.
- **K6. A card alone does not make a draft non-empty.** Its link is in the
  text.
- **K7. The prepared draft is stored only for the revision it read.**
  `prepareCardThumb(client, slot, draft, opts)` reads the slot's revision
  before the upload, and stores the draft with its thumb through
  `storeDraftIf` with that revision (R4). Another save in between (another
  tab) throws `DraftChanged` and keeps that save; storage refusing the write
  throws `DraftNotSaved`. Nothing is sent either way.
- **K8. An input frozen before link cards still matches.** With no card,
  `blueskyDraftInput` has no `card` key, so a pending send frozen by the
  version before #200 equals its unchanged draft: a found record is
  `posted`, and an absent one sends the frozen record as it is.

Tests (`bluesky-link-card.test.ts`, `bluesky-compose.test.ts`): the record
with a card, with a thumb, with images (no card), with a quote (no card); a
card in a reply; a thumb uploaded once and stored; an image that fails
posts the card without it; a pending send is not changed; an account
switch during the upload; the R7 compare with a card; a save from another
tab during the upload (K7); storage refusing the prepared draft (K7); an
input in the exact pre-#200 shape, found and absent (K8).

## Bluesky delete and redraft (#190)

`own-posts.ts` (delete), `bluesky-redraft.ts` (redraft), `draft-files.ts`
(image bytes).

**Delete** (`deleteOwnStatus`, the same function as Mastodon's). For a
Bluesky client it calls `blueskyDeletePost(uri)`; for Mastodon it calls
`deleteStatus(id)` as before. The post and every repost of it leave the
cache at once and its id is marked deleted, so every list drops it. Only
the author's own post: the card offers Delete only on it, and the client
refuses another repo's URI.

A Bluesky delete has three outcomes, and **only `getRecord` decides** when
the answer is not a clear refusal (as R1 does for a create). The client
does this (`packages/bluesky-client` README, "Delete"):

| the delete | the outcome | the page |
|---|---|---|
| answered OK | deleted | the post stays gone |
| no answer, a timeout or a 5xx, and `getRecord` says `RecordNotFound` | deleted | the post stays gone |
| an answered 4xx refusal, or `getRecord` finds the record | failed | the post comes back; "Could not delete this post. Try again." |
| `getRecord` fails too | unknown | the post comes back; "Could not tell whether the post was deleted. Reload to check." |

`deleteOwnStatusOutcome` answers the outcome, and whether the account
changed meanwhile (`stale`: then it writes nothing to the page and says
nothing). `deleteOwnStatus` is the old shape on top of it: the post as the
reader saw it when deleted (Bluesky's delete answers nothing), else null.
Mastodon never has "unknown": its failures are "failed", as before.

**Redraft. Rule: nothing can be lost after the delete.** Bluesky has no
edit, so a redraft deletes the post and opens a new draft with what it
had. Everything that can fail happens **before** the delete, and the
draft is stored durably first. The order:

0. **A stored redraft wins** (rule D4 below). First of all, before any
   read: when a redraft of the same post is stored already
   (`findRedraftOf`; a delete in doubt kept it), it opens. Nothing is
   read, uploaded or deleted.
1. **Read** (`readBlueskyRedraft`). The record from the reader's PDS
   (`blueskyGetOwnPost`), not the AppView copy: it has the text as typed,
   the exact refs and blob CIDs. Each image's bytes (`blueskyGetBlob`),
   typed with the record's `mimeType` (a PDS may answer
   `application/octet-stream`). The reply parent and the quoted post
   (`fetchStatus`, cached): `gone` (`not_found`), `limited`
   (`replyDisabled` / `embeddingDisabled`), `ok`, or `unknown` (the read
   failed). The post's reply and quote limits (`blueskyGetOwnGates`, #262).
   Any read failing except a target's throws: nothing is
   deleted. A failed limits read throws `BlueskyRedraftGatesUnread`
   ("Could not read the post's reply and quote limits, so it was not
   deleted."): a redraft never drops limits without saying so. The record not there throws `BlueskyRedraftGone`: the post is
   already deleted (the card drops it, app README).
2. **Ask.** When the draft would be empty (no text, no image, no
   quote: a post that is only a link card, a video or a feed card,
   `redraftKeepsSomething`), there is no confirm and no delete: "Nothing
   in this post can be kept in a draft. Use Delete." Else the card's
   confirm names what is not kept and a gone or limited target (app
   README).
3. **Build and store** (`storeBlueskyRedraft`). Every step can fail, and a
   failure throws with nothing deleted and nothing left stored:
   - the draft is built from the record (table below); an odd record
     (missing or wrong-typed fields) is read defensively, and a throw here
     is before the delete;
   - each image is **re-encoded** (the caller's `prepareImage`, the
     canvas, as compose does) and uploaded. A new encoding gives a new
     CID, so the delete does not take the new blob with the old record
     (the PDS deletes a blob as soon as no record names it; keeping the
     old refs would leave dead refs);
   - the rkey is made (`blueskyNextRkey`), so the draft's first save
     already has it (R6);
   - an empty draft throws (the card stops before this, step 2);
   - the draft, with the post's URI as `bluesky.source`, is stored in a
     new **`staged:<key>`** slot of the owner account (`storeDraftIf`,
     refused → throw). See "Rule: a staged redraft is hidden" below;
   - the image bytes (the re-encoded ones) are stored in IndexedDB
     (`draft-files.ts`), keyed by account, the final slot
     `redraft:<key>` and image id. Refused → the draft is removed again,
     and it throws. A post with no images does not use IndexedDB.
4. **Delete** (`deleteOwnStatusOutcome`, rules above), then
   `settleBlueskyRedraft` follows the outcome:
   - deleted → the draft is renamed to `redraft:<key>`; other unexposed
     staged copies of the same post that no flow of this tab runs (a
     closed tab's) are removed (rule E, case 3); step 5.
   - failed → the staged draft and its bytes are removed
     (`discardBlueskyRedraft`): the post is still there.
   - unknown → the draft is renamed to `redraft:<key>`, marked
     `sourceMaybeLive`, and the toast says so: "Could not tell whether the
     post was deleted. Your redraft is saved and opens the next time you
     write a new post. Check your profile first, so it is not posted
     twice."
5. **Open** the composer on the `redraft:<key>` slot (app README). When
   it cannot open (another composer is open, or the account changed), the
   draft stays stored and opens with the account's next new post
   (`findRedraftSlot`); a toast says so when the reader is still on that
   account.

**Rule E: when Caribou removes a draft.** Only in these cases:

1. The send that posted it.
2. The reader discards it.
3. An **unexposed** staged copy, removed by its **own** redraft flow:
   its delete was refused, or a stored redraft of the same post won (D4),
   or a redraft of the same post was deleted (the closed tab's copy).

**Exposed** (`bluesky.exposed`, stored with the draft) is set the first
time a staged copy can be seen: revealed as a fallback, opened, or
renamed to `redraft:`. A `redraft:` slot is always exposed. An exposed
draft is a normal draft for good, and only cases 1 and 2 remove it. No
other cleanup exists: plain Delete removes no draft, and age removes no
draft. A removal is revision-checked, and never touches a staged slot
that a flow of this tab is running for.

**Rule: a staged redraft is hidden until the delete is decided.** No
composer opens an unexposed `staged:` slot (`findRedraftSlot` skips it), so the
reader cannot edit it while the delete runs. The outcome moves it or
removes it. The removal is revision-checked, like every other draft
write: only the revision the store wrote is removed. So nothing the
reader writes can be erased by a refused delete.

A moved Bluesky redraft goes in its own `redraft:<key>` slot, never in
`new`, `reply:` or `quote:`. So it never overwrites another draft, and a
new post opens it first, whatever its target, even when that target is
gone.

**The rename needs no more storage.** The move from `staged:<key>` to
`redraft:<key>` is one revision-checked write of the account's draft map
that renames the slot in place (`renameDraftIf`), never a second copy.
The staged draft already holds `sourceMaybeLive: false`, so the rename
only changes values. The image bytes are stored under `redraft:<key>`
from the start (`draftFilesSlot` maps a `staged:` slot to it), so they do
not move. If storage refuses even the rename, the `staged:` slot stays
and is revealed (`revealDraftSlot`): exposed, with the outcome's
`sourceMaybeLive`. This page keeps both in memory, and stores them as
soon as storage takes a write (the reveal tries at once; opening the
slot stores them). A new post finds it (`findRedraftSlot` takes an
exposed `staged:` slot), after a reload too once the flag is stored; its
bytes load by their real key.

**Known gap: a refused rename, a refused reveal write, then a reload.**
When storage refuses the rename and also every later write, the flag
`exposed` lives only in this page. After a reload, the `staged:` slot is
unexposed again, so it is hidden as a staged copy: a new post does not
find it. Recovery finds it (`recoverStagedRedrafts`): at once when the
post is gone, or after `STAGED_MAX_AGE_MS` (a day) when the post is still
up. So the draft is hidden for up to a day, never lost.

**Known cost of rule E (accepted).** If a tab closes before its delete
goes out, and the reader later uses plain Delete on that post, the next
new post offers a redraft the reader no longer wants. The reader discards
it. Plain Delete removes no draft (rule E), so this is the price of never
losing one.

**Rule D4: the stored redraft wins.** A stored redraft of the same post
(the same `bluesky.source`: a `redraft:` slot, or an exposed `staged:`
one) may hold the reader's edits, so it is never replaced. The card looks for it before the confirm: found → it opens,
"You already have a redraft of this post…", and nothing is read,
uploaded or deleted. Found later (the delete's outcome, or a closed
tab's staged draft): the new staged copy and its bytes go, and the
stored slot stays, its `sourceMaybeLive` set from the outcome. So the
text cannot be posted twice, and no edit is lost.

**A post that may still be up.** A draft marked `sourceMaybeLive` (a
delete in doubt) is checked when the dialog opens it
(`checkRedraftSource`, `getRecord`): still up → the dialog shows a note;
gone → the mark is cleared.

**A tab closed during the delete.** Its draft stays in `staged:<key>`,
unexposed. When a new post opens and the account has unexposed staged
drafts this tab is not deleting for (`hasOrphanStagedRedrafts`),
`recoverStagedRedrafts` asks `getRecord` for each source:
- gone → the draft moves to `redraft:<key>` (unless a stored redraft of
  the post wins); it opens with the next new post, and a toast says so;
- still up, staged less than a day ago (`stagedAt`, set by the store,
  `STAGED_MAX_AGE_MS`) → it stays hidden: another tab may still be
  deleting for it. It is asked about again next time;
- still up and a day old → it moves to `redraft:<key>`, exposed, marked
  `sourceMaybeLive`, so the dialog shows "The post this redraft came from
  is still up…". The reader decides. It is not asked about again;
- no answer → it is tried again next time.

**Account switch.** Each step checks the account after its await
(`ownerGeneration`), and before any write, caches included: a reply or
quote target read that answers after a switch is not cached. A switch
before the store: nothing is stored or
deleted. A switch after the store and before the delete: the draft and
its bytes are removed, nothing is deleted. A switch during the delete:
the outcome still decides storage (failed → removed; deleted or unknown →
kept for that account), but nothing touches the new account's page.

**Image bytes** (`draft-files.ts`). A stored redraft keeps each image's
bytes in IndexedDB (`caribou-draft-files`), because its blob is not proven
usable until the post is sent: the PDS may drop an unused blob, and the
deleted post was the only copy. The dialog loads them when it opens the
slot, for the previews and for #189's blob recovery, after a close, a
reopen or a reload. `pruneDraftFiles()` removes every entry whose account,
slot and image id is not in a stored draft (a `redraft:<key>` entry also
lives while `staged:<key>` names it): after a send, on close, and at
sign-out. Images the reader picked in compose are
not stored there: the reader has those files.

**What the draft takes from the record.**

| record | draft |
|---|---|
| `text` | `text`. Facets are made again from the text at send. So a link whose shown text is not its URL (other apps shorten links) gets its full URL back in the text, and the text can then be over 300 graphemes (Post is off until the reader cuts it). A mention is resolved again from the handle in the text, so a renamed account's mention stays plain text. |
| `facets` | not kept (see `text`) |
| `reply` | `bluesky.reply` (same strong refs), `inReplyToId` = the parent URI |
| `embed` record, or `recordWithMedia.record`, whose URI is a post (`app.bsky.feed.post`) | `bluesky.quote` (same strong ref) |
| an embedded feed, list, starter pack or labeler | not kept (a card) |
| `embed` images, or `recordWithMedia.media` images | `bluesky.images`: the new blob ref, `alt`, `aspectRatio` (the record's, else the new encoding's), type and size |
| `labels` self-labels | `bluesky.labels`, every value. The menu's values (`porn`, `sexual`, `nudity`, `graphic-media`) go only with images; any other value goes as it is. |
| `langs` | `language` = the first one; the others are not kept (compose sends one) |
| a video, an external link card | not kept. The link's URL stays only if it is in the text. |
| `tags` | not kept |
| reply and quote limits (thread gate, post gate at the post's rkey, #262) | `bluesky.gates` (`readGates`: list rules by id, no titles), for a top-level post. A reply has no limits (G1): its draft gets none, and the confirm says "Its reply and quote limits are not kept." The new post writes them again with its own rkey (G3). |
| `createdAt` | not kept: a new post gets a new time |

## Act as another account (`act-as.ts`; Bluesky #197, Mastodon #131)

The reader can favourite, boost or bookmark a post as another signed-in
account without a switch. Today this is for Bluesky posts only. The
Mastodon part (resolve the post on the other server first) is still open
in #131; `actAsAccounts` answers no account for a Mastodon post until then.

1. **The picker lists only accounts on the post's network.**
   `actAsAccounts(post)` answers the signed-in accounts other than the
   active one: for a Bluesky post, Bluesky accounts only. An expired
   account is listed, so the picker can say so.
2. **No resolve step on Bluesky.** An AT URI and CID are the same for every
   account. The write sends them as the post has them.
3. **The write goes through the other account's own client.**
   `actAsClient(session)` is a Bluesky client for that sign-in: its PDS,
   its session, its repo. The record names its DID. Its restore does not
   change `blueskyRestore` (no splash) and does not change the active
   reader's moderation.
4. **The other account's view stays out of the cache.** `readAsAccount` reads the
   post through that client and answers its flags and record refs
   (`ActAsView`). Nothing is written to `statusCache`. An `actAs` write
   changes no cached flag, record ref or count of the active reader. Counts
   catch up at the next read. If a copy read by the other client is ever
   cached, its `viewerOf` names that account, so the merge drops its viewer
   fields (seam 4, "Copies that are not the reader's").
5. **An expired account does not write.** `actAs` and `readAsAccount` answer
   `{ kind: 'expired' }` and send nothing when the session is marked
   `expired`. A request that finds the session gone (the client answers
   `unauthorized`) marks it expired, through `caribou:session-expired`, and
   answers `expired` too.
   **Expiry voids older answers.** After every await, `actAs` and
   `readAsAccount` look at the session again. Expired now: the answer is
   `expired`, whatever the server said. Signed in again (a new
   `generation`): the answer is `failed` and is not kept.
6. **One write per account, action and post at a time.** A second call
   while the first is out answers `{ kind: 'busy' }` and sends nothing.
7. **Every answer is true.** `ok` carries the view the server left (the
   flag and record from the ack). `failed` carries a message; the caller
   keeps its old view.
8. **An acked write holds through read lag.** The AppView can show a new
   like up to `readLagMs` (60 s) late. So each write that the server
   acked is kept, apart from the active reader's slots: by account,
   sign-in `generation`, post and action, with its flag, its record and
   the time. `readAsAccount` first waits for that account's writes to the
   post that are still out. Then, for each action, the kept answer wins
   over the read when the read started before the write finished, or
   when the read disagrees with it within `readLagMs`. After that the
   read wins. So a reopened dialog still shows the like, and its undo
   deletes the acked record; a click never makes a second like. A failed
   write keeps nothing new.
9. **An old sign-in is forgotten.** When a client is made, the clients
   and kept answers of every sign-in that is no longer stored (signed out,
   or signed in again) are dropped.

## Lists (`lists.ts`; Mastodon #51, Bluesky #195)

One set of functions for both networks. The client does the network part
(bluesky-client README, "Lists").

- **Keyed by account.** Every cache entry is keyed by the account that
  read it, so one account never sees another's lists.
- **Writes show at once and go back on a failure,** with a toast. One
  list's writes, and one membership's writes, go to the server one at a
  time, in order; only the last one of a run settles the cache.
- **A read never undoes a pending write.** A read waits while a write to
  its keys is out, and drops its answer and asks again when a write
  started or ended while it was out.
- **An answer for an earlier account writes nothing** (`ownerGeneration`),
  and its failure says nothing.
- **Bluesky answers are whole, not acks.** A Bluesky list write answers
  the list (or nothing), read back from the PDS when the answer was in
  doubt, so A1 (partial acks) does not apply. The PDS reads its own writes,
  so a read right after a write is not stale, and no lag window is needed.
- **A write whose outcome is unknown** (`BlueskyWriteUnknown`: no clear
  answer, and the read-back failed too) is not shown as done: the change
  goes back, the toast says "Could not tell whether … Reload to check.",
  and the lists (and the members, when shown) are read again. That read
  brings the server's state, whichever it is.
- **A refusal with words for the reader.** When a failed write carries
  `userMessage` (a Bluesky list too large to change here), the toast says
  that instead of "Couldn't …".
- **A partly done delete (`BlueskyListPartlyDeleted`).** The list comes
  back, the toast says "Some members were removed, but the list was not
  deleted. Delete it again to finish.", and the lists, that list's members
  (when shown) and every known "lists that hold this account" are read
  again, so the Members panel and the picker's boxes show what is left. An
  unknown delete reads all three again too. When the list is gone but the
  sweep after it failed (`listGone: true`), the list stays gone and the
  toast says some members may remain. **A failed re-read drops the cache
  it was for** (the members, a "lists that hold this account" entry): the
  old rows and boxes are never shown as current, and the screen loads
  them again or shows its Retry.
- **One click is one write.** The screens send a write per change of a
  box or per button press; the client's kept rkey makes a repeated intent
  after a lost answer reuse its record, not make a second one.

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
has come in. After that, an empty first page keeps the list as it is only
when its **raw top** is the one the list last read: the newest `indexedAt`
and its URI on the AppView page, skipped reasons included (`seen.newestAt`
and `seen.newestUri`). Then nothing new came in, and "Load older" does not
come back for a list that has already read to its end. When the raw top
changed, new notifications arrived, maybe all of kinds Caribou skips, with
shown ones behind them: the page replaces the list (a new generation) and
its cursor is used, so "Load older" reaches them. Mastodon pages have no raw
top; an empty Mastodon page has no cursor anyway.

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
