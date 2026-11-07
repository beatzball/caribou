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
| `src/embeds.ts` | `mapEmbed(embed, ctx, postUri?) → { mediaAttachments, card, quote }` | #179 |
| `src/moderation.ts` | `moderate(subject, userDid, prefs, labelDefs) → BlueskyModerationResult` | #180 |
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

## Embeds (`mapEmbed`, spec 7.3)

`mapPost` calls `mapEmbed(view.embed, ctx, view.uri)`. The third argument
is the post's AT URI. A video and the fallback card link to that post on
bsky.app, and the embed view itself does not carry it. Without it they link
to `https://bsky.app`.

What maps to what:

| `embed.$type` | `mediaAttachments` | `card` | `quote` |
|---|---|---|---|
| none | `[]` | `null` | `null` |
| `app.bsky.embed.images#view` | up to 4, type `image` | `null` | `null` |
| `app.bsky.embed.external#view` | `[]` | link card | `null` |
| `app.bsky.embed.video#view` | `[]` | video card | `null` |
| `app.bsky.embed.record#view` | `[]` | see "Records" | see "Records" |
| `app.bsky.embed.recordWithMedia#view` | from `media` | from `media`, else from `record` | from `record` |
| anything else | `[]` | fallback card | `null` |

- **Image:** `id` and `url` = `fullsize`, `previewUrl` = `thumb`,
  `description` = `alt` (`null` when empty). With an `aspectRatio`,
  `meta.original` and `meta.small` carry its width, height and aspect.
- **External:** `url` = `uri`, `title`, `description`, `image` = `thumb`,
  type `link`. An empty title becomes the link's host, so the link card
  (which needs a title) still shows. A Tenor GIF is an external embed.
- **Video:** a card of type `video`. `image` = `thumbnail`, `url` = the
  post on bsky.app, `title` = `alt` or "Video", description "Play on
  bsky.app". No `<video>` element: `playlist` is HLS (`.m3u8`), which
  only Safari plays (spec 7.3, phase 6).
- **Records** (`app.bsky.embed.record#view`, by `record.$type`):

  | `record.$type` | result |
  |---|---|
  | `…#viewRecord` | quote `accepted`, `quotedStatus` = `mapPost` of the record, with the same `ctx` |
  | `…#viewNotFound` | quote `deleted`, no post ("The quoted post was deleted.") |
  | `…#viewBlocked` | quote `blocked_account`, no post |
  | `…#viewDetached` | quote `revoked`, no post ("removed this quote") |
  | feed (`generatorView`), list (`listView`), starter pack, labeler | a card that links to it on bsky.app |
  | anything else | fallback card |

  A quoted record becomes a post view (its `value` is the `record`, its
  first `embeds` entry the `embed`, no `viewer`) and goes through `mapPost`.
  The states reuse PR #167's quote card notes, so the card needs no change.
- **Fallback:** a card titled "Not supported here — open on bsky.app" that
  links to the post. It is the answer for an unknown `$type` and for a
  shape that does not match its `$type`.

What fails closed: `mapEmbed` never throws. A bad shape gives the fallback
card. If `mapPost` throws on a quoted record, the quote is `accepted` with
no post, and the card says "The quoted post is not available."

Each card and media URL must be `http:` or `https:`. A `uri` or `thumb` that is not
is dropped (the link card checks it again).

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
