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
| `src/embeds.ts` | `mapEmbed(embed, ctx) → { mediaAttachments, card, quote }` | #179 |
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
