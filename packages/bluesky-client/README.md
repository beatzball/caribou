# @beatzball/caribou-bluesky-client

> Bluesky for Caribou: a `CaribouClient` for Bluesky, and mappers from
> AppView JSON into Caribou's own types.

**Status:** Scaffold (#177). Module signatures are fixed; bodies are TODO.
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
| `src/moderation.ts` | `moderate(subject, userDid, prefs, labelDefs) → BlueskyModerationResult` | #180 |
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

## Embeds (`mapEmbed`, spec 7.3)

**Requirement on `mapPost` (#177):** call `mapEmbed(view.embed, ctx, view.uri)`
and copy the parts into the `Status`: `mediaAttachments`, `card`, `quote`,
and `recordCard` into `bluesky.recordCard`. The third argument is the
post's AT URI. A video and the fallback card link to that post on
bsky.app, and the embed view does not carry it. Without it they link to
`https://bsky.app`, and no test here can tell.

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
- **One level of quote**, as on Bluesky. A quote inside a quoted post is
  `accepted` with no post, and the quote card shows it as a link. This
  also ends a chain that quotes itself.
- **Links:** bsky.app path parts are URL-encoded (a DID keeps its colons).
  A starter pack links by the creator's handle, else by DID.
- **Fallback:** a card titled "Not supported here — open on bsky.app" that
  links to the post. It is the answer for an unknown `$type` and for a
  shape that does not match its `$type`. `$type` is matched by `switch`
  or `===`, never by an object lookup, so `__proto__` or `toString` is
  unknown too.

What fails closed: `mapEmbed` never throws. A bad record and good media
keep the media and give a fallback `recordCard`; good record and bad media
keep the quote or record card and give a fallback `card`. If `mapPost`
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
