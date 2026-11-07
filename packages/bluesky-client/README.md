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
- **The SDK decides.** It runs `moderatePost` or `moderateProfile` with
  these inputs. Caribou does not judge a label itself, with the two
  exceptions below.
- **Plain data out.** The result has all seven contexts. Each is the SDK's
  `ui(context)` as booleans plus `reasons`. The `ModerationDecision` never
  leaves `moderate()`. A JSON round trip gives the same object.
- **`labelersCovered`** is `opts.labelersCovered`, or `[]` when the caller
  does not know. `[]` never settles the veil for a reader with labelers.

Fail-closed rules:

| gap | what Caribou does |
|---|---|
| `prefs` is `null` (missing or failed to load) | Strict prefs: adult content off, every built-in label `hide`, and every labeler named on the subject counts as subscribed. A label then hides all it could hide. |
| `labelDefs` is `null`, or has no entry for a subscribed labeler | A label from that labeler that the SDK cannot define covers its target. Reason name: "Content warning (labeler unavailable)". |
| The labeler's definitions loaded, but do not define this value | The same cover. Reason name: "Content warning (unknown label)". |

The fail-closed cover:

- A content label (on the post) blurs `contentList`, `contentView` and
  `contentMedia`. An account label blurs every context. A profile label
  (on the profile record) blurs `avatar` and `banner`.
- It sets `noOverride`: no Show button. The card offers Retry, which loads
  the definitions again (spec 7.4). `isLabelerUnavailable(reason)` tells the
  card which reasons are these.
- It never sets `filter`. A post the reader cannot judge stays in place as
  a cover with Retry. It is never dropped without a word.
- It skips the reader's own post or profile only for `noOverride`, as the
  SDK does: the author still sees the cover, with Show.
- It skips negated labels (`neg: true`) and self-labels. A self-label can
  only use a built-in value, and the SDK knows all of those.
- It reads the post's own labels and its author's. A quoted post is
  moderated on its own, through `ctx.moderatePost`, by the embed mapper.

Other rules:

- **`noOverride`** comes from the SDK (a `no-override` label, an adult label
  with adult content off, or a block). The card and `caribou-status-media`
  then show no Show button.
- **Logged-out defaults** are `LOGGED_OUT_PREFS`: adult content off,
  `DEFAULT_LABEL_SETTINGS`, Bluesky's labeler only. The server uses them.
- **`!no-unauthenticated`** (spec 8.3): `isNoUnauthenticated(author)` says
  whether the author asked to be hidden from signed-out readers. The server
  calls it per post (a repost in an author feed has another author) and
  renders the notice, never the post. The SDK also covers such a post with
  `noOverride` whenever `userDid` is `undefined`. A reader with only a
  Mastodon account active is signed out of Bluesky: `userDid` is `undefined`.
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
- Otherwise it is settled only when all of these hold:
  1. The reader's prefs and label definitions are loaded, for every
     subscribed labeler.
  2. The post came from a fetch as this reader (`viewerOf` is the reader's
     UserKey).
  3. `labelersCovered` has every labeler in the reader's prefs.
  4. Moderation ran on that data (the reader fetch maps with the reader's
     `moderatePost`, so 2 implies it).
- A new subscription later breaks rule 3, and the card is covered again
  until a refetch.

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
