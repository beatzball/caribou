# @beatzball/caribou-bluesky-client

> Bluesky for Caribou: a `CaribouClient` for Bluesky, and mappers from
> AppView JSON into Caribou's own types.

**Status:** Phase 2a. The read client and mappers are in (#177); facets,
embeds and moderation land in #178, #179 and #180.
Bluesky is behind a flag until phase 4 (see "The flag" below).

## Purpose

Screens and stores read Caribou's own types (`Status`, `Account`, …, in
`@beatzball/caribou-mastodon-client`). This package turns Bluesky's views
into those types, so a screen reads a Bluesky post the way it reads a
Mastodon one. What Mastodon has no field for goes in each type's optional
`bluesky` field. Design: `docs/superpowers/specs/2026-11-04-caribou-bluesky-design.md`,
sections 6.5 (mapping), 7.1 (facets), 7.3 (embeds), 7.4 (moderation).

## Position in the stack

- **Depends on:** `@atproto/api`, `@atproto/oauth-client-browser`,
  `@beatzball/caribou-mastodon-client` (the owned types),
  `@beatzball/caribou-auth` (UserKey)
- **Depended on by:** `caribou-app` (through `components/_bluesky.ts` only)

## Module map

One owner each. Four workers share this package in phase 2a. Keep to your
own files; ask in your report for a change in another's.

| module | exports | owner |
|---|---|---|
| `src/map/context.ts` | `MapContext`: `viewerOf` and the caller's `moderatePost` | #177 |
| `src/map/post.ts` | `mapPost(view, ctx) → Status` | #177 |
| `src/map/account.ts` | `mapAccount(view) → Account`, `mapRelationship(view) → Relationship` | #177 |
| `src/map/feed-entry.ts` | `feedEntryId(entry)`, `mapFeedEntry(entry, ctx) → Status` | #177 |
| `src/facets.ts` | `renderFacets(text, facets) → html` | #178 |
| `src/embeds.ts` | `mapEmbed(embed, ctx) → { mediaAttachments, card, quote }` | #179 |
| `src/moderation.ts` | `moderate(subject, userDid, prefs, labelDefs) → BlueskyModerationResult` | #180 |
| `src/map/labels.ts` | `mapLabels(labels) → BlueskyLabel[]` | #177 |
| `src/client.ts` | `createBlueskyClient(opts) → CaribouClient` (read methods), `BLUESKY_CAPABILITIES` | #177 |
| `src/errors.ts` | `normalizeXrpcError(err) → CaribouError` | #177 |
| `src/browser.ts` | the SDK classes; later the Bluesky `CaribouClient` and OAuth | #177, #182 |
| `src/index.ts` | the server-safe surface: everything above but `moderation` and `browser` | shared |

How they fit:

- `mapPost` calls `mapEmbed` for the media, card and quote.
- `mapPost` does **not** run moderation. It calls `ctx.moderatePost(view)`,
  which the caller builds from `moderate()` with the reader's prefs (or the
  logged-out defaults on the server). The mappers stay free of the SDK.
- `mapEmbed` maps a quoted post with the same `ctx`.
- `mapAccount` leaves `bluesky.moderation` unset. A screen treats a missing
  result as "not checked yet" and keeps the profile covered (fail closed).
- Who fills `Account.bluesky.moderation`: the profile page's caller (#177,
  the read methods). It calls `moderate({ kind: 'profile', view })` and sets
  the field. A feed card does not: it uses its post's result, which already
  counts the author's labels (its `avatar` context).
- `BlueskyModerationResult` is plain data, one entry per context
  (`contentList`, `contentView`, `contentMedia`, `avatar`, `banner`,
  `profileList`, `profileView`). The SDK's `ModerationDecision` instance never
  leaves `moderate()`: page data goes through JSON, and JSON drops its
  `ui()` method (spec 7.4).

## Moderation rules (`src/moderation.ts`, spec 7.4 and 8.3)

Moderation decides what a reader may see. Done wrong, it shows harmful
media. So every gap **fails closed**: when Caribou does not know, it covers.

`moderate(subject, userDid, prefs, labelDefs, opts?)`:

- **Inputs.** `subject` is `{ kind: 'post', view }` or `{ kind: 'profile', view }`.
  `userDid` is the reader's DID, or `undefined` for a signed-out reader.
  `prefs` comes from `getPreferences`. `labelDefs` comes from
  `getServices?dids=<subscribed>&detailed=true`, through
  `labelDefsFromServices(views)`. `opts.labelersCovered` is what the AppView
  answered in `atproto-content-labelers` for the fetch that gave this view.
  `prefs` or `labelDefs` `null` means "missing or failed to load".
- **Bluesky's labeler is always subscribed.** If `prefs.labelers` lacks
  `BSKY_LABELER_DID`, `moderate()` adds it with no per-label choices. The
  SDK's `getPreferences` does the same.
- **Bluesky's labeler has custom labels too** (`spam`, `rude`, `sensitive`,
  and more). So its definitions are needed like any labeler's. The server
  loads and caches `getServices?dids=<BSKY_LABELER_DID>&detailed=true` and
  passes it, also for signed-out SSR. Without it, those labels get the
  fail-closed cover below.
- **Plain data out.** The result has all seven contexts. Each is the SDK's
  `ui(context)` as booleans plus `reasons`. The `ModerationDecision` never
  leaves `moderate()`. A JSON round trip gives the same object.
- **`labelersCovered`** is `opts.labelersCovered`, or `[]` when the caller
  does not know. `[]` never settles the veil.

The steps, in order:

1. **Clean the subject once.** Caribou copies the subject (it never changes
   the caller's view) and keeps only labels the SDK can define. This covers
   every place the SDK reads labels: the post, its author (account and
   profile labels), and a quoted post and its author.
   - A negated label (`neg: true`) is dropped everywhere.
   - A label stays only if the SDK can define its value by an **own key**
     (`Object.hasOwn`): in the labeler's loaded definitions, or in the SDK's
     built-in `LABELS`. A value like `constructor` or `__proto__` is not
     defined. Every lookup table in this file uses own keys only.
   - A dropped label on the post or its author goes to the gap scan (step 3).
     A dropped label on a quoted post is only dropped: the quote is
     moderated on its own, through `ctx.moderatePost`, by the embed mapper.
2. **Run the SDK, wrapped.** If `moderatePost` or `moderateProfile` throws,
   the result is a cover in every context: `blur: true`, `noOverride: true`,
   `filter: false`, one reason named "Content warning (moderation failed)".
3. **The gap scan.** Each label dropped in step 1 (not negated) from the
   author or from a subscribed labeler gets the fail-closed cover.

Fail-closed rules:

| gap | what Caribou does |
|---|---|
| `prefs` is `null` | Strict prefs: adult content off, every built-in and every value on the subject `hide`, and every labeler named on the subject counts as subscribed. Every cover then has `noOverride`, except on the reader's own post or profile. |
| `labelDefs` is `null`, or has no entry for a subscribed labeler | A label from that labeler that the SDK cannot define covers its target. Reason name: "Content warning (labeler unavailable)". |
| The labeler's definitions loaded, but do not define this value | The same cover. Reason name: "Content warning (unknown label)". |
| A self-label the SDK does not define | The same cover, "Content warning (unknown label)". |
| The SDK throws | Every context covered (step 2). |

The fail-closed cover:

- A content label (on the post) blurs `contentList`, `contentView` and
  `contentMedia`. An account label blurs every context. A profile label
  (on the profile record) blurs `avatar` and `banner`.
- It sets `noOverride`: no Show button. The card offers Retry, which loads
  the definitions again (spec 7.4). `isLabelerUnavailable(reason)` tells the
  card which reasons are these.
- It never sets `filter`. A post the reader cannot judge stays in place as
  a cover with Retry. It is never dropped without a word.
- On the reader's own post or profile it leaves `noOverride` off, as the
  SDK does: the author still sees the cover, with Show.

Other rules:

- **`noOverride`** comes from the SDK (a `no-override` label, an adult label
  with adult content off, or a block), or from the rules above. The card and
  `caribou-status-media` then show no Show button.
- **Who wires it.** The Bluesky status card (phase 2b) sets
  `caribou-status-media`'s `sensitive` from `contexts.contentMedia.blur` and
  its `no-override` attribute from `contexts.contentMedia.noOverride`. That
  card does not exist yet; its PR must test this wiring.
- **Logged-out defaults** are `LOGGED_OUT_PREFS`: adult content off,
  `DEFAULT_LABEL_SETTINGS`, Bluesky's labeler only. The server uses them,
  with Bluesky's label definitions.
- **`!no-unauthenticated`** (spec 8.3): `isNoUnauthenticated(author)` says
  whether the author asked to be hidden from signed-out readers. The server
  calls it per post (a repost in an author feed has another author) and
  renders the notice, never the post. The SDK also covers such a post with
  `noOverride` whenever `userDid` is `undefined`. A negated label counts for
  neither. A reader with only a Mastodon account active is signed out of
  Bluesky: `userDid` is `undefined`.
- **Reasons.** One per label cause, for the cover's text: `label` is the
  value, `source` the labeler's DID (or the author's), `name` the
  definition's English name. A block, mute, muted word or hidden post adds
  a reason too, with `label` set to the SDK's cause type
  (`blocking`, `blocked-by`, `block-other`, `muted`, `mute-word`, `hidden`).

The reader veil (`blueskyCheckSettled(post, reader)`):

A Bluesky card stays under the reader veil until this returns `true`.
SSR data was fetched with Bluesky's labeler only, so a label from another
labeler the reader subscribes to is not on that post yet.

- No Bluesky account active (`reader` is `null`): settled. The logged-out
  default is final.
- Otherwise the subscribed labelers are the reader's `prefs.labelers` plus
  Bluesky's labeler. It is settled only when all of these hold:
  1. The reader's prefs are loaded, and label definitions are loaded for
     every subscribed labeler, Bluesky's included.
  2. The post came from a fetch as this reader (`viewerOf` is the reader's
     UserKey).
  3. `labelersCovered` is not empty and has every subscribed labeler.
  4. Moderation ran on that data (the reader fetch maps with the reader's
     `moderatePost`, so 2 implies it).
- A new subscription later breaks rule 3, and the card is covered again
  until a refetch.

## Mapping rules (#177)

Spec 6.5. What maps to what, and what shows when data is missing.

**Post (`mapPost`)**

| `Status` field | from the post view | when missing or unknown |
|---|---|---|
| `id`, `uri` | `uri` (the AT URI) | — |
| `url` | `https://bsky.app/profile/<author did>/post/<rkey>` | — |
| `createdAt` | `record.createdAt` | `indexedAt` when absent or not a date |
| `content` | `renderFacets(record.text, record.facets)` | a record that is not an `app.bsky.feed.post` maps as empty text |
| `account` | `mapAccount(author)` | — |
| `inReplyToId` | `record.reply.parent.uri` | `null` |
| `inReplyToAccountId` | the DID in that URI | `null` |
| `mediaAttachments`, `card`, `quote` | `mapEmbed(embed, ctx)` | — |
| `mentions` | mention facets: `id` = the facet's DID, `acct` = the visible text without `@` (display only, see below) | `[]` |
| `tags` | tag facets, `url` = `https://bsky.app/hashtag/<tag>` | `[]` |
| counts | `likeCount`, `repostCount`, `replyCount`, `quoteCount` | `0` |
| `favourited`, `reblogged` | `viewer.like != null`, `viewer.repost != null` | `false` |
| `bookmarked`, `muted`, `pinned` | `viewer.bookmarked`, `viewer.threadMuted`, `viewer.pinned` | `false` |
| `visibility` | always `public` | — |
| `sensitive`, `spoilerText` | `false`, `''` (moderation is separate, 7.4) | — |
| `poll`, `editedAt`, `emojis`, `language` | `null`, `null`, `[]`, `record.langs[0]` | `language` `null` |
| `bluesky.likeUri`, `repostUri` | `viewer.like`, `viewer.repost` | `null` |
| `bluesky.replyRef` | `record.reply` (root and parent strong refs) | `null` |
| `bluesky.replyDisabled`, `embeddingDisabled` | `viewer.replyDisabled`, `viewer.embeddingDisabled` | `false` |
| `bluesky.labels` | `mapLabels(labels)` | `[]` |
| `bluesky.moderation` | `ctx.moderatePost(view)` | — (the caller always gives one) |
| `bluesky.viewerOf` | `ctx.viewerOf` | — |

- **Bad facets.** A record is author-written, so its facets can be
  anything. A facet that is not an object, has no whole-number byte index,
  or has no feature object is dropped; so is a feature that is not an
  object. The post stays readable, and `renderFacets` gets only the good
  facets.
- **`mentions[].acct` is display text.** It is what the author typed, and it
  can be stale or point the wrong way (spec 7.1). Only `id` (the DID) says
  who is mentioned. Compose (#189) must address a reply's mentions by `id`,
  never by `acct`.
- **Authors have no moderation of their own.** A post's `account` and a
  repost's reposter come from `mapAccount`, so their `bluesky.moderation`
  is unset. A card reads the avatar and banner decision from the post's
  `bluesky.moderation` (`avatar`, `banner`): the SDK's `moderatePost` already
  counts the author's labels.

`mapLabels` keeps `src`, `uri`, `cid`, `val`, `neg`, `cts` and drops the
rest. The signature (`sig`) is bytes; it would not survive JSON, and the
SSR page data must equal the first client render.

**Account (`mapAccount`)**

| `Account` field | from the profile view | when missing |
|---|---|---|
| `id` | `did` | — |
| `acct`, `username` | `handle` | — |
| `url` | `https://bsky.app/profile/<handle>`; the DID when the handle is `handle.invalid` | — |
| `displayName` | `displayName` | `''` (screens fall back to the handle) |
| `note` | `renderFacets(description, [])`: escaped text, line breaks, no links yet (7.1 asks #178 for link detection) | `''` |
| `avatar`, `avatarStatic` | `avatar` | `''` |
| `header`, `headerStatic` | `banner` | `''` |
| counts | `postsCount`, `followersCount`, `followsCount` | `0` |
| `createdAt` | `createdAt` | `indexedAt`, then `''` |
| `locked`, `bot`, `group`, `fields`, `emojis`, `roles` | `false`, `false`, `false`, `[]`, `[]`, `[]` | — |
| `bluesky` | `{ did, handleInvalid, labels }`; `moderation` stays unset | — |

**Relationship (`mapRelationship`)**: `following` = `viewer.following != null`,
`followedBy` = `viewer.followedBy != null`, `blocking` = a block record **or**
a block list, `blockedBy`, `muting` = `viewer.muted` (a mute list counts),
`mutingNotifications` = `muting`, `showingReblogs` = `!viewer.mutedOnlyReposts`.
`bluesky.followUri` and `blockUri` are the reader's own records; a block by
list has no `blockUri` (the reader undoes it on the list).
`requested`, `requestedBy`, `notifying`, `domainBlocking`, `endorsed` are `false`.

**Feed entry (`feedEntryId`, `mapFeedEntry`, seam 8)**

- A plain entry is its post: id = the post URI.
- A repost (`reasonRepost`) becomes a wrapper `Status` whose `reblog` is the
  post. Its id is `reason.uri`. The lexicon makes `uri` optional; without
  it the id is `repost:<by.did>:<post.uri>:<reason.indexedAt>`. That
  fallback never equals the post's id or any record URI, the reader's own
  repost record included.
- The wrapper's `account` is `reason.by`, its `createdAt` is
  `reason.indexedAt`, its counts are `0`, its content is empty, and its
  `bluesky` names the repost record (`uri`, `cid` from `reason`) with the
  post's moderation, so the wrapper reads as a Bluesky resource.
- A repost's id can change between reads: if the AppView sends `reason.uri`
  on one read and leaves it out on the next, the same repost has two ids.
  A catch-up then does not meet it and answers a gap (seam 7), which
  replaces the list. That is the intended result, not a duplicate; do not
  "fix" it by guessing.
- Any other reason (`reasonPin`, an unknown one) maps as a plain entry.
  Profile feeds ask for no pins (`includePins: false`), so a pinned post
  never shows twice.

## The client (#177)

`createBlueskyClient({ userKey, agent, moderation, onUnauthorized })` is the
Bluesky `CaribouClient`. It takes a signed-in `Agent` (#182 makes it) and a
moderation source (#180 builds it from the reader's prefs and label
definitions). It imports the SDK for types only; `./browser` exports it.

- **Order:** `timelineOrder()` is `null` for every kind: the store keeps
  feed order (seam 6).
- **Paging:** `nextCursor` is the AppView's `cursor`, passed back as it
  came. An empty AppView page ends the feed (`nextCursor` `null`), even
  when it sends a cursor.
- **One bad post never fails a page.** A mapper that still throws on one
  post's data drops that post, not the page. The page keeps its cursor
  (its end is read from what the AppView sent). In a thread a bad reply is
  left out; a bad post asked for by itself (`fetchStatus`, the focus of
  `fetchThread`) is `not_found`. `onMapError(err, uri)`, when given, hears of each
  dropped post. A page whose every post was dropped is empty with its
  cursor, and the store reads on.
- **Catch-up (`sinceId`, seam 7):** Bluesky has no `since_id`. The client
  pages from the top, at most 3 pages of 50, until it meets the entry whose
  id is `sinceId` (by entry id, so a bad post above it does not stop it). Met: the answer is every entry above it, then it, and
  `nextCursor` is `null`. Not met: the answer is every entry it read, and
  `nextCursor` is the cursor after the last page, or `null` when the feed
  ended (an empty page drops its cursor). The store calls that a gap
  ("Many new posts") and replaces the list when applied.
- **Bookmarks:** a deleted or blocked bookmark is left out. To save
  requests, the client reads past pages of only unavailable bookmarks (at
  most 5) until a page has a post or the bookmarks end. At that budget it
  answers an empty page with the last cursor, never `null`: a list ends
  only on a null cursor (`packages/state` README), so the store asks again
  and older bookmarks stay in reach.
- **Reads:** `home` → `getTimeline`; `bookmarks` → `getBookmarks` (a check
  answers an empty page, as on Mastodon); `fetchStatus` and
  `fetchStatuses` → `getPosts` (25 per request); `fetchThread` →
  `getPostThread`, ancestors oldest first, descendants depth first, a
  not-found or blocked post left out; `lookupAccount` and
  `verifyCredentials` → `getProfile`; `fetchAccountStatuses` →
  `getAuthorFeed` (`posts` = `posts_no_replies`, `replies` =
  `posts_with_replies`, `media` = `posts_with_media`);
  `fetchRelationships` → `getProfiles` (25 per request, in the order
  asked); `fetchMutes`, `fetchBlocks` → `getMutes`, `getBlocks`;
  `fetchFilters` → `[]` (Bluesky has no server filters).
- **Not here yet:** `local`, `public`, hashtag and list timelines, every
  write, compose, polls, edit, notifications, search, lists and tags throw
  `CaribouError('not_found')` naming the issue that adds them. A screen
  hides those by `capabilities`.
- **Errors (`normalizeXrpcError`):** 401 → `unauthorized` (and
  `onUnauthorized()`), 404 or an XRPC `NotFound` / "not found" 400 →
  `not_found`, 429 → `rate_limited` with `retryAfter` from
  `ratelimit-reset`, 5xx → `server_error`, no answer → `unreachable`.
- **Dedup:** two equal reads in flight share one request.

## Facets to HTML (`renderFacets`)

A Bluesky post is plain text plus facets. `renderFacets(text, facets)`
turns them into HTML (spec 7.1). It is pure and server-safe, and it never
throws. The caller still runs the shared `PURIFY_OPTS` over the result, on
the server and in the browser, as for Mastodon content.

The rules:

- **Byte ranges.** A facet's `byteStart` (inclusive) and `byteEnd`
  (exclusive) count UTF-8 bytes, not JavaScript characters. The renderer
  encodes the text with `TextEncoder` and cuts the bytes.
- **Bad facets drop.** A facet is skipped, and its bytes show as plain
  text, when its range is not whole numbers, is empty, falls outside the
  text, or cuts a character in half. A facet with no `index`, or with no
  feature that can render (below), is skipped too.
- **Overlaps.** After the skips above, facets are sorted by `byteStart`
  (equal starts keep the record's order). A facet that overlaps the one
  kept before it drops. Skipping the facets that would render as text
  first means a broken facet cannot hide a good one inside its range.
- **The first known feature wins.** One facet can carry several features.
  The first one of type `#link`, `#mention` or `#tag` decides. An unknown
  type is passed over. If the deciding feature is not safe (below), the
  segment is plain text.
- **`#link`** → `<a href="<uri>" rel="nofollow noopener noreferrer"
  target="_blank">`. Only `http:` and `https:`. Any other scheme, or a URI
  that does not parse, renders as plain text. The `href` is the parsed
  URL (`new URL(uri).href`).
- **A link does not hide its host.** An allow-list. The link keeps its
  visible text only when one of these is true:
  1. **Same host.** The text, read by the URL parser (with `https://`
     added when it does not start with `scheme://`, after ASCII whitespace
     is trimmed), has no user info and gives the link's host. Hosts compare
     as the parser writes them (lowercase, punycode, `．` and `。` read as
     `.`), after one leading `www.` drops from each.
  2. **Plain prose.** After NFKC, the text has no format or invisible
     character (`\p{Cf}`, which covers U+FEFF, U+200B–U+200F, U+202A–U+202E,
     U+2060–U+206F and the soft hyphen; also U+2028 and U+2029), and none of
     `. : / @ [ ] \` or a Unicode full stop (`。`, `۔`, `܁`, `܂`, `።`, `⸼`).

  Otherwise the link shows its real URI (`new URL(uri).href`) as its text.
  So any text with an invisible character, and any text that looks like an
  address but names another host, shows where the link really goes.

  The accepted cost: link text such as `e.g.`, `v1.2`, `3.14`, `[1]`,
  `word…` (NFKC turns `…` into `...`) or `see example.com now` over a link
  to another host shows the URI instead. So does text with a zero-width
  joiner, such as a family emoji. Prose like "read this" or "click here"
  keeps its text. A false alarm only shows more than needed; a missed spoof
  hides where a link goes.
- **`#mention`** → `<a href="/@<did>">`, built from the facet's DID. The
  visible text stays as written; it can be stale, and the profile page shows
  the current handle. A DID that is not `did:<method>:<id>` renders as
  plain text.
- **`#tag`** → `<a href="/tags/<tag>?net=bsky">`, the tag URL-encoded. The
  href is the same for every reader, so the server render and the first
  client render agree. An empty tag, or one with a lone UTF-16 surrogate
  (it cannot be URL-encoded), renders as plain text.
- **Text.** Each segment is decoded (U+FEFF is kept: it is content, not a
  byte-order mark) and HTML-escaped (`&`, `<`, `>`, and a
  no-break space as `&nbsp;`, the way the DOM writes text back). A line
  break (`\n`, `\r\n` or `\r`) becomes `<br>`.
- **Wrap.** The whole text goes in one `<p>`. Empty text, or a `text` that
  is not a string, gives `''`.
- **Stable through DOMPurify.** The output uses only tags and attributes in
  `PURIFY_OPTS`, so sanitizing returns the same string. A test checks this.
- **Hydration.** The output depends only on its input, so the server render
  equals the first client render. One exception to watch: the host check
  uses `new URL`, and Node and the browser may ship different IDNA (UTS 46)
  tables. For an unusual Unicode host in link text they could disagree, and
  that one post's markup would differ at hydration. If a hydration mismatch
  shows up on a Bluesky link, look here first.

## The chunk rule

The atproto libraries are 181 KB gzipped. Only Bluesky pages and Bluesky
accounts may load them (spec 12.2, 12.3 item 5).

- The app reaches this package's SDK modules (`./browser`, `./moderation`)
  only through a dynamic `import()`, and only in `components/_bluesky.ts`.
  A static import of either puts the libraries on every page.
- The app's `vite.config.ts` has a rolldown `codeSplitting` group, `bsky`,
  for `@atproto`. Without it, rolldown puts its runtime helpers inside the
  atproto chunk, `app-main` imports that chunk statically, and every
  Mastodon page downloads it.
- `apps/caribou/tests/e2e/bluesky-chunk.spec.ts` checks it: a Mastodon page
  fetches no script with atproto code in it, and with the flag on the code
  arrives in `bsky-*.js`. It fails without the group.

## The server-safe rule

`src/index.ts` and every module it reaches import `@atproto/*` for **types
only** (`import type`). So the server render and any client code can import
the package root without pulling in the SDK. Mappers and the facet renderer
are pure functions.

`./moderation` and `./browser` are the SDK doors. The server may import
`./moderation` statically (SSR runs moderation with logged-out defaults).
The client loads both lazily.

`src/__tests__/server-safe.test.ts` fails on a runtime `@atproto` import in
any module other than those two: a value import, a side-effect import, or a
dynamic `import()`. A lazy load of the SDK belongs in a door too, so the
server-safe modules stay pure and the chunk rule has one place to look.

## The flag

`localStorage['caribou.flag.bluesky'] = '1'` turns Bluesky on for a
developer. Today it only warms the `bsky` chunk. No reader sees a control
for it, and with it off nothing changes for Mastodon.

## Fixtures

Real AppView JSON shapes, under `src/__fixtures__/`, with placeholder
accounts only (`alice.example.com`, `did:plc:alice`). Never a real account.
