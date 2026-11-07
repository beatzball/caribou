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
| `src/embeds.ts` | `mapEmbed(embed, ctx, postUri?) → { mediaAttachments, card, recordCard, quote }` | #179 |
| `src/no-unauthenticated.ts` | `isNoUnauthenticated(actor)`, plain data so mappers can call it; `./moderation` re-exports it | #179, #180 |
| `src/moderation.ts` | `moderate(subject, userDid, prefs, labelDefs) → BlueskyModerationResult` | #180 |
| `src/map/labels.ts` | `mapLabels(labels) → BlueskyLabel[]` | #177 |
| `src/client.ts` | `createBlueskyClient(opts) → CaribouClient` (read methods), `BLUESKY_CAPABILITIES` | #177 |
| `src/errors.ts` | `normalizeXrpcError(err) → CaribouError` | #177 |
| `src/browser.ts` | the SDK classes; later the Bluesky `CaribouClient` and OAuth | #177, #182 |
| `src/index.ts` | the server-safe surface: everything above but `moderation` and `browser` | shared |

How they fit:

- `mapPost` calls `mapEmbed` for the media, cards and quote (see "Embeds").
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
| `mediaAttachments`, `card`, `quote` | `mapEmbed(embed, ctx, uri)` | — |
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
| `bluesky.recordCard` | `mapEmbed(…).recordCard` (a feed, list, starter pack or labeler) | `null` |

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

## Embeds (`mapEmbed`, spec 7.3)

**`mapPost` hands over the post URI:** it calls `mapEmbed(view.embed, ctx,
view.uri)` and copies the parts into the `Status`: `mediaAttachments`,
`card`, `quote`, and `recordCard` into `bluesky.recordCard`. The third
argument is where a video and the fallback card link, since the embed view
does not carry it. `embeds-map-post.test.ts` checks this through the real
`mapPost`.

**Requirement on moderation (#177, phase 2b):** a post's media moderation
(`contentMedia`) covers everything its embed shows: `mediaAttachments`,
`card` and its image, **and `bluesky.recordCard` and its image** (a feed or
list avatar). The status card draws `recordCard` itself and does not read
moderation contexts, so whoever wires moderation into the card must cover
it, with a test.

Two cards, two fields. `card` comes from the media (an external link, a
video, or the fallback). `recordCard` comes from the record (a feed, list,
starter pack or labeler, or the fallback for a record this build cannot
map). So a post with a feed and media keeps both, and the reader can see
and follow both. The status card shows `bluesky.recordCard` under the
media; a Mastodon post has no `bluesky` field and keeps "no link card
when there is media".

| `embed.$type` | `mediaAttachments` | `card` | `recordCard` | `quote` |
|---|---|---|---|---|
| none | `[]` | `null` | `null` | `null` |
| `app.bsky.embed.images#view` | up to 4, type `image` | `null` | `null` | `null` |
| `app.bsky.embed.gallery#view` | up to 4, type `image` | `null` | `null` | `null` |
| `app.bsky.embed.external#view` | `[]` | link card | `null` | `null` |
| `app.bsky.embed.video#view` | `[]` | video card | `null` | `null` |
| `app.bsky.embed.record#view` | `[]` | `null` | see "Records" | see "Records" |
| `app.bsky.embed.recordWithMedia#view` | from `media` | from `media` | from `record` | from `record` |
| anything else | `[]` | fallback card | `null` | `null` |

- **Image:** `id` and `url` = `fullsize`, `previewUrl` = `thumb`,
  `description` = `alt` (`null` when empty). With an `aspectRatio`,
  `meta.original` and `meta.small` carry its width, height and aspect.
- **Gallery:** each `items` entry maps like an image, with `thumbnail` for
  `thumb`. An item of another `$type` is skipped.
- **External:** `url` = `uri`, `title`, `description`, `image` = `thumb`,
  type `link`. An empty title becomes the link's host, so the link card
  (which needs a title) still shows. A Tenor GIF is an external embed.
- **Video:** a card of type `video`. `image` = `thumbnail`, `url` = the
  post on bsky.app, `title` = `alt` or "Video", description "Play on
  bsky.app". The status card puts a play mark on its image (Bluesky posts
  only). No `<video>` element: `playlist` is HLS (`.m3u8`), which only
  Safari plays (spec 7.3, phase 6).
- **Records** (`app.bsky.embed.record#view`, by `record.$type`):

  | `record.$type` | result |
  |---|---|
  | `…#viewRecord` | quote `accepted`, `quotedStatus` = `mapPost` of the record, with the same `ctx` |
  | `…#viewNotFound` | quote `deleted` ("The quoted post was deleted.") |
  | `…#viewBlocked`, `author.viewer.blocking` set | quote `blocked_account` ("you blocked its author") |
  | `…#viewBlocked`, any other block | quote `unauthorized` ("You cannot see the quoted post.") |
  | `…#viewDetached` | quote `revoked` ("removed this quote") |
  | feed (`generatorView`), list (`listView`), starter pack, labeler | `recordCard` that links to it on bsky.app |
  | anything else | fallback `recordCard` |

  A quoted record becomes a post view and goes through `mapPost`. Its
  `value` is the `record`, its first `embeds` entry the `embed`, and its
  `labels` and `author` (with the author's labels and viewer) pass through
  as they came, so moderation reads them. It has no `viewer`. The quote
  states reuse PR #167's quote card notes.
- **`!no-unauthenticated` (spec 8.3):** in a signed-out copy (`ctx.viewerOf`
  is `null`), a quoted post whose author has this label is never mapped. The
  quote is `unauthorized` with no post and `bluesky.hidden =
  'no-unauthenticated'`, and the quote card says "This account asked to be
  seen only by signed-in readers." The SDK does not count an embed's author
  in the outer post's moderation, so `mapEmbed` checks it. A reader with a
  Bluesky account active sees the quote.
- **One level of quote**, as on Bluesky. A quote inside a quoted post is
  `accepted` with no post, and the quote card shows it as a link. This
  also ends a chain that quotes itself.
- **Links:** bsky.app path parts are URL-encoded (a DID keeps its colons).
  A starter pack links by the creator's handle, else by DID. Building a
  link never throws: a part that cannot be encoded (a lone surrogate, which
  JSON allows) gives the root, `https://bsky.app`.
- **Fallback:** a card titled "Not supported here — open on bsky.app" that
  links to the post. It is the answer for an unknown `$type` and for a
  shape that does not match its `$type`. `$type` is matched by `switch`
  or `===`, never by an object lookup, so `__proto__` or `toString` is
  unknown too.

What fails closed: `mapEmbed` never throws. A bad record and good media
keep the media and give a fallback `recordCard`; good record and bad media
keep the quote or record card and give a fallback `card`. Both bad give
one fallback `card`, not two. If `mapPost`
throws on a quoted record, the quote is `accepted` with no post, and the
card says "The quoted post is not available."

Each card and media URL must be `http:` or `https:`, and is normalized
(`URL.href`, as the app's `_http-url.ts` does). A `uri` or `thumb` that is
not is dropped (the link card checks it again).

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
