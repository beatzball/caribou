# @beatzball/caribou-bluesky-client

> Bluesky for Caribou: a `CaribouClient` for Bluesky, and mappers from
> AppView JSON into Caribou's own types.

**Status:** Phase 2a. The read client and mappers (#177), facets (#178),
embeds (#179) and moderation (#180) are in.
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
| `src/no-unauthenticated.ts` | `isNoUnauthenticated(actor)`, `isProvenVisible(actor)` (the signed-out allow-list), plain data so mappers can call them; the root and `./moderation` export both | #179, #180, #186 |
| `src/signed-out.ts` | `signedOutProfilePage`, `signedOutThread`, `signedOutLabelDefs` and the guards (`guardActor`, `guardFeedEntry`, `guardThreadNode`, `signedOutStatus`, `hiddenAccount`); `./moderation` re-exports it | #186, #187 |
| `src/moderation.ts` | `moderate(subject, userDid, prefs, labelDefs) → BlueskyModerationResult` | #180 |
| `src/map/labels.ts` | `mapLabels(labels) → BlueskyLabel[]` | #177 |
| `src/client.ts` | `createBlueskyClient(opts) → CaribouClient` (read methods), `BLUESKY_CAPABILITIES` | #177 |
| `src/errors.ts` | `normalizeXrpcError(err) → CaribouError` | #177 |
| `src/browser.ts` | the SDK classes, the client and the OAuth glue, for the lazy chunk | #177, #182 |
| `src/oauth.ts` | sign-in, callback, restore and sign-out over the browser SDK (browser only) | #182 |
| `src/muted-words.ts` | `checkMutedWordEdit`, `applyMutedWordEdit`: the edit a muted-words write applies (browser only, through `./oauth`) | #196 |
| `src/syntax.ts` | `isValidHandle`, `isValidDid`, `isValidRecordKey` from `@atproto/syntax`, for the server's route check | #185 |
| `src/compose.ts` | `countPost`, `postFits`, `nextRkey`, `detectFacets` over the SDK's `RichText` and `TID` (browser only, through `./browser`) | #189 |
| `src/actions.ts` | `createActions`: like, repost, bookmark, follow, mute, block and their undos (the client spreads them in) | #188 |
| `src/lists.ts` | `createLists`: the reader's curate lists, their members and the list feed's URI (the client spreads them in) | #195 |
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

### Labeler coverage (`answerCoverage`, #233)

`labelersCovered` (rule 3 above) says which labelers' labels an answer
carries. The signed-in client sets it on every decision it makes.

**A browser cannot read `atproto-content-labelers`.** The AppView
(`public.api.bsky.app`) sends it but no `access-control-expose-headers`.
The PDS (`bsky.social`, `*.host.bsky.network`) forwards it but exposes only
`RateLimit-*` (checked on 2026-11-08 with `curl -H "Origin: …"`, #233). A
cross-origin `fetch` reads only the CORS-safelisted headers and the exposed
ones. So in a real browser the header is never there.

The rule, for one answer:

1. **The header is there** (any case): coverage is the labelers it lists
   (`parseContentLabelers`). An empty value covers none.
2. **The header is not there:** coverage is the labelers the request sent
   in `atproto-accept-labelers`, because the request succeeded. Only the
   first `ACCEPTED_LABELERS_LIMIT` (20) distinct DIDs, in the order sent,
   count. The SDK sends `Agent.appLabelers` (Bluesky's, `;redact`) first,
   then `agent.labelers` (`configureLabelers`). This holds only for the
   signed-in agent, whose reads go through its PDS to the AppView. No read
   through `answer()` may go to the public host (`public.api.bsky.app`): it
   answers 200 and ignores the request header. An agent with no session
   (no `did`) counts as sending none.
3. **A failed request** gives no answer, so it gives no coverage.
4. **A labeler that is not covered keeps the cover** (fail closed), as
   before.

Why 20: the AppView source does not cap the list it accepts
(`packages/bsky/src/util.ts` `parseLabelerHeader` and
`packages/bsky/src/hydration/hydrator.ts` `createContext`, in
`bluesky-social/atproto` at `0849c24`). The only limit on record is the
Bluesky app's `MAX_LABELERS = 20` (`bluesky-social/social-app`,
`src/lib/constants.ts`), which it checks when a reader subscribes. Caribou
counts no labeler past it. So a reader with more than 20 distinct labelers
(Bluesky's included) has every Bluesky post and profile covered, and Retry
does not help: veil rule 3 needs every subscribed labeler covered. The
Bluesky app does not let a reader subscribe to more.

What the request sent is read twice: when the read starts and when its
answer lands. Only a labeler in both counts, so a `configureLabelers` call
during the read (`reloadModeration`) never adds coverage.

The AppView also drops a requested labeler that does not exist or is taken
down (`createContext`). Coverage from rule 2 still names it. That labeler
has no `getServices` view, so it has no label definitions, and veil rule 1
keeps the cover.

**Definitions are checked again** (`recheckLabelers`), so a labeler taken
down after its definitions loaded loses them. A check asks `getServices`
for the labelers the prefs name. A labeler it has no view for loses its
definitions at once, and veil rule 1 covers again. A failed check changes
nothing (a 401 ends the session). The definitions load or are checked:

- on every account restore and every `reloadModeration` (a cover's Retry);
- when the app comes back to the foreground, unless a load or check ran in
  the last minute (`FOREGROUND_RECHECK_MIN_MS`);
- every 10 minutes while the page is visible (`LABELER_RECHECK_MS`, in
  `apps/caribou/components/_bluesky-session.ts`).

Until a check succeeds, the content can show. See "Known gap: a labeler
dropped after its definitions loaded" at the end of this section.

**Known gap: PDS read-after-write.** Just after the reader posts a reply or
a quote, the AppView may not have indexed it yet. The PDS then builds the
answer itself and fetches the parents or the quoted post from the AppView
without `atproto-accept-labelers` (`packages/pds/src/api/app/bsky/feed/getPostThread.ts`
and `packages/pds/src/read-after-write/viewer.ts` in `bluesky-social/atproto`
at `0849c24`). The AppView then applies its default labelers only. Caribou
cannot see this (`Atproto-Upstream-Lag` is not exposed either), so rule 2
counts the reader's own labelers as covered for those posts. It lasts only
until the AppView indexes the new post, and it touches only the post the
reader just replied to or quoted.

**Each answer carries its own coverage.** A result built from several
answers keeps only the labelers every one of them covered: a catch-up
(several `getTimeline` or `listNotifications` pages), several `getPosts`
batches, the pages a bookmarks read skips past. In notifications the
authors take the `listNotifications` answers' coverage, and the posts take
the `getPosts` answers'.

It applies to every signed-in read that moderates: `home` (`getTimeline`),
`fetchAccountStatuses` (`getAuthorFeed`), `fetchThread`
(`getPostThread`), `fetchStatus` and `fetchStatuses` (`getPosts`),
`bookmarks` (`getBookmarks`), `lookupAccount` and `verifyCredentials`
(`getProfile`), `fetchMutes` and `fetchBlocks`, and `fetchNotifications`.
An agent without `labelers` or without a session sent none, so rule 2
covers none.

#### Known gap: a labeler dropped after its definitions loaded

Tracked in #240. The owner accepted it on 2026-11-09.

- **What:** after a subscribed labeler is taken down or deactivated,
  content that only it would have labeled can show uncovered. This lasts
  until the next **successful** definitions check. The schedule above is
  what the app tries, not a limit: if `getServices` keeps failing, the
  window has no upper limit.
- **Why it is accepted:** a browser cannot read `atproto-content-labelers`
  (curl proof in #233), so Caribou cannot see that an answer dropped the
  labeler. The AppView serves that labeler's labels to no client, so the
  Bluesky app shows the same content.
- **Why the stricter rule fails:** "keep the cover when the applied
  labelers are unknown" covers everything, always, in a browser. That is
  the #233 bug.
- **How to close it later:**
  1. Bluesky exposes the header through CORS. Then rule 1 in
     `content-labelers.ts` (`answerCoverage`) applies to every answer, and
     the rule-2 fallback can go.
  2. A server-side read path that can read the header. The reads in
     `client.ts` then take the coverage it passes on, in place of
     `answerCoverage`'s fallback.
  3. A definitions check before each content read (`oauth.ts`
     `recheckLabelers`, and the schedule in
     `apps/caribou/components/_bluesky-session.ts`). This narrows the
     window but does not prove coverage for an answer.
- **The test that records it:** `src/__tests__/oauth.test.ts`, "accepted
  gap: a labeler taken down after its definitions loaded …". If the window
  is closed, change it to expect the cover at once.

#### A gone labeler (#238)

A labeler in the reader's prefs can be gone: deleted, taken down, or not a
labeler. `getServices` then answers with no view for it. It has no
definitions, so veil rule 1 covers every Bluesky post and profile, and
Retry does not help. Caribou does not remove it on its own.

- **Which labelers are missing** (`goneLabelers(prefs, labelDefs)`, in
  `./moderation`): each DID in `prefs.labelers` with no entry in
  `labelDefs`, in prefs order, once each. Bluesky's own labeler is never
  listed: a reader cannot unsubscribe from it. Prefs or definitions not
  loaded (`null`): none. A failed `getServices` is not "missing".
- **Gone is two misses in a row.** Each published load or check counts a
  miss for every missing labeler, and clears the count of every labeler
  it has a view for. A labeler is `gone` (offered for removal) only after
  two misses in a row: the first load plus one Retry or recheck. So a
  labeler the AppView has not indexed yet is not offered at once. The
  cover is there from the first miss. `restoreClient` gives the list as
  `gone`, and `reloadModeration`, `recheckLabelers` and
  `removeGoneLabeler` return it.
- **The cover stays** until the reader removes the labeler or it comes
  back. Nothing here changes the veil.
- **One at a time (rule Q).** Each restored client runs every moderation
  load and check through one serial queue: the restore's load, Retry
  (`reloadModeration`), a removal (its "is it back" check, its write and
  its reload, as one job), and every definitions check
  (`recheckLabelers`: the 10-minute one, the foreground one). Nothing
  overlaps, so no answer is published against prefs it did not read, and
  no older prefs read calls `configureLabelers` last. A load or a check
  that is asked for while one of the same kind waits in the queue (not
  yet started) joins that one. One that is asked for while its kind runs
  is queued after it, because the running one may have read old prefs.
- **Removal** (`removeGoneLabeler(did)`, only after the reader confirms):
  1. A DID not in `gone` when asked (Bluesky's labeler, a labeler that is
     not gone, a DID not in the prefs): refused, no request. When the job
     starts, a DID no longer gone (a load in front of it saw it) is not
     checked or written: the answer is `back` if the prefs still name it,
     else `absent`.
  2. `getServices` for that DID once more. A view: the labeler is back.
     Nothing is written; the definitions are checked again
     (`recheckLabelers`), and the answer is `back`. A failed request
     throws, and nothing is written. A 401 here or in the write also ends
     the session ("401").
  3. The write is the SDK's `updatePreferences`: it reads the prefs again,
     under the agent's prefs lock, and puts back what the edit returns.
     The edit takes out only that DID from each `labelersPref`. Every other
     pref, and its order, stays as read. If the fresh read does not have
     the DID (another app removed it), nothing is written (`absent`).
     `putPreferences` has no swap check, so a write from another app
     between the read and the put can still be lost. The Bluesky app's
     own writes have the same window.
  4. Then a full load, in the same job, so `prefs`, `labelDefs` and
     `gone` come from the server. The answer is `removed`. A Retry asked
     for during the removal runs after it.

#### Muted words (#196)

Bluesky's keyword filter is the reader's `mutedWordsPref`. Each word has a
`value`, `targets` (`content`: text and tags; `tag`: tags only), an
`actorTarget` (`all`, or `exclude-following`: only people the reader does
not follow) and an optional `expiresAt`.

1. **Read.** The words are the SDK's `prefs.mutedWords` (`getPreferences`,
   from the last valid `mutedWordsPref`). They come with the moderation
   load, so every load, Retry and write that reloads gives the new list.
2. **Apply.** `moderate()` passes the reader's prefs to `moderatePost`, so
   a match is a `mute-word` cause on every post the reader's client maps:
   timeline, thread, profile, search, hashtag, feeds, notifications and
   quoted posts. The SDK hides it in `contentList` (filter and blur) and
   covers it in `contentView` (blur, with Show). It never hides the
   reader's own posts. Signed out, there are no muted words.
3. **Expiry.** The SDK skips a word whose `expiresAt` is past. Nothing
   deletes an expired word: not a read, not a write of another word.
4. **Who.** The SDK skips an `exclude-following` word on a post by an
   account the reader follows.
5. **Write** (`editMutedWords(edit)`): add one word, or remove one. One
   job in the moderation queue (rule Q above), so two quick edits run one
   after the other and neither is lost. The write is the SDK's
   `updatePreferences`: a fresh read under the agent's prefs lock, then a
   put of what the edit returns. The edit changes only the last
   `mutedWordsPref`, or adds one at the end when there is none. Every other
   pref (also types Caribou does not know), its order, and every other
   muted word (also an item the SDK cannot read) stay as read. Then a full
   load, in the same job, whatever the outcome: after `exists` or `absent`
   too, the fresh read may show words the held prefs lack (another app's
   change), so the answer's `prefs` are the server's. `wordsChanged` says
   whether the loaded words differ from the ones held before the job.
   Nothing else in the queue runs until that load is done.
6. **Add.** The value is `sanitizeMutedWordValue` of the input (trimmed,
   one leading `#` dropped). Refused with no request when it is empty, or
   when `targets` is empty or names something other than `content` and
   `tag`, or `actorTarget` is not `all` or `exclude-following`, or
   `expiresAt` is not a future time. A new word gets a TID `id`. A word
   with the same value (case does not count) in the fresh read that still
   mutes (no `expiresAt`, or a future one): nothing is written, the answer
   is `exists`. If every word with that value has expired, the first of
   them is replaced in place by the new word (`added`); the others stay.
7. **Remove.** By `id`; a word with no `id` (an old app wrote it) by its
   `value`. Not in the fresh read: nothing is written, `absent`.
8. **A pref Caribou cannot edit.** A `mutedWordsPref` with no `items`
   array: the write throws and writes nothing.
9. **Failures.** A failed read or put throws, and nothing changes here. A
   401 also ends the session ("401"). When the put worked but the load
   after it failed, the answer says so (`reloadFailed: true`) and `prefs`
   is `null` (fail closed, as for any failed load).

## Signed-out pages (`src/signed-out.ts`, #186, #187)

A signed-out profile page or thread from the public AppView, with no
token. One copy for two callers: the app's server (SSR) and the app's
browser fallback when the server was rate limited. It runs moderation, so
it comes through `./moderation`.

- The caller gives a `SignedOutSource`: `xrpc(method, params, call)` (one
  AppView call; `call` is `profile`, `authorFeed`, `thread` or `labelDefs`,
  so the server can pick a TTL) and `clean` (its DOMPurify for a post's and
  an account's HTML).
- `mustPropagate(err)`, when given, marks errors that must reach the caller
  from any call. The server passes its rate-limit check: **a rate limit is
  never turned into "no data"**, so a 429 on the label definitions fails
  the page (which the app defers) instead of rendering it with every label
  covered. Any other label-definition failure is `null`.
- Every author slot is checked by name with `isProvenVisible` before
  mapping (profile, feed author, reposter, thread posts); a failed one
  becomes a hidden marker. `mapEmbed` checks quotes and record cards.
  After mapping, `signedOutStatus` keeps only the id, time and reply link
  of a hidden item. A hidden profile's feed is never fetched.
- Moderation uses `LOGGED_OUT_PREFS` and Bluesky's label definitions;
  `signedOutLabelDefs` answers `null` when they cannot load (fail closed).
- Any other failure throws; the caller decides (the server defers on a
  429).

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
- **Writes:** like, repost, bookmark, follow, mute and block are in
  "Actions (#188)" below; compose is in "Compose".
- **Search and the hashtag timeline:** see "Search (#192, #193)".
- **Tag follow:** `fetchTag`, `followTag` and `unfollowTag` throw
  `CaribouError('not_found')` "Bluesky cannot follow a tag". Bluesky has
  no such feature; the tag page hides Follow by `capabilities.followTags`.
- **Lists:** see "Lists (#195)" below. The list timeline is
  `getListFeed`, paged and caught up like Home.
- **Not here yet:** `local` and `public` timelines,
  polls and edit throw
  `CaribouError('not_found')` naming the issue that adds them. A screen
  hides those by `capabilities`.
- **Errors (`normalizeXrpcError`):** 401 → `unauthorized` (and
  `onUnauthorized()`), 404 or an XRPC `NotFound` / "not found" 400 →
  `not_found`, 429 → `rate_limited` with `retryAfter` from
  `ratelimit-reset`, 5xx → `server_error`, no answer → `unreachable`.
- **Dedup:** two equal reads in flight share one request.

## Search (#192, #193)

Both reads go through the reader's PDS with the token, like every other
signed-in read, so they carry labeler coverage (`answer()`).

`search({ q, type, limit, cursor })`:

| `type` | call | answer |
|---|---|---|
| none | `searchActors` and `searchPosts`, at once | `accounts` and `statuses`; `hashtags` `[]` |
| `accounts` | `searchActors` | `accounts` only |
| `statuses` | `searchPosts` | `statuses` only |
| `hashtags` | none | all empty: Bluesky has no hashtag search |

- `q` is trimmed. An empty `q` makes no call and answers all empty.
- `limit` goes to both calls as it came (the AppView takes 1 to 100).
  `resolve` is ignored.
- `cursor` is the next page of one kind. It needs `type` `accounts` or
  `statuses`; without one it is ignored.
- `bluesky.accountsCursor` and `bluesky.statusesCursor` are where the next
  page starts, as the AppView sent them, or `null` when that kind ends.
  An empty page ends its kind, even with a cursor. A kind not asked is
  `null`.
- Each actor maps with `mapAccount` and gets `moderation.profile(view)`;
  each post maps with `mapPost` and the reader's `moderatePost`. One bad
  post is dropped, not the page.
- If either call fails, the search fails.

Hashtag timeline (`fetchTimeline({ type: 'hashtag', tag })`):

- `searchPosts` with `q=#<tag>` and `sort=latest`, the query bsky.app's
  hashtag page sends. `cursor` and `limit` pass through. An empty page ends
  the list.
- `sinceId` (a poll) is a catch-up by the seam 7 rule: pages from the top,
  at most 3 of 50, until it meets that post.

Errors from these reads keep their code, with a message a screen can show:
`rate_limited` → "Bluesky is getting too many requests. Wait a minute,
then try again."; `unreachable` → "Could not reach Bluesky."; any other →
the read's own message. A 401 still calls `onUnauthorized`.

## Actions (#188, spec 6.3 and 9)

The client's `favourite`, `reblog`, `bookmark`, `follow`, `mute`, `block`
and their undos live in `src/actions.ts`. The state layer
(`packages/state`, "Bluesky acks") does the optimistic update, the
rollback, the in-flight guard and the account check.

- **What a write answers.** An ack, never a post or a relationship
  (`StatusWriteAck`, `RelationshipWriteAck`). A status ack says whether the
  action is on and the record it made. A relationship ack says the flags
  it set and the record refs it made or removed. Nothing is read back after
  a write: the AppView can lag 60 s behind it, and a failed read must not
  turn a done write into a rollback.
- **Records.** Like → `app.bsky.feed.like`, repost →
  `app.bsky.feed.repost` (subject: the post's strong ref, URI and CID);
  follow → `app.bsky.graph.follow`, block → `app.bsky.graph.block`
  (subject: the DID). Each is written to the reader's repo with
  `createRecord`. The ack carries the new record's URI.
- **No record.** Bookmark → `app.bsky.bookmark.createBookmark` /
  `deleteBookmark` (private). Mute → `app.bsky.graph.muteActor` /
  `unmuteActor` (private; it hides notifications too, so the ack sets
  `mutingNotifications`).
- **An undo deletes exactly one record: the one the ref names.** The URI
  must be in the reader's own repo and the action's collection. Anything
  else is refused (`CaribouError`, nothing deleted). An undo never guesses
  a record.
- **An undo with no ref reads it first.** When the ref has no record (the
  post came from a read with no viewer state), the client reads the
  reader's own view: `getPosts` for a like or repost, `getProfile` for a
  follow or block. It deletes the record that read names. When the read
  names none, nothing is deleted and the ack says "off": the server has
  nothing to undo. When the post is gone, the undo fails `not_found`.
- **A block leaves the follow.** Bluesky keeps the reader's follow
  record when they block. The ack sets only `blocking` and `blockUri`.
- **A blocked profile read leaves the follow unknown (R2-1).** While
  either side blocks, the AppView hides `viewer.following`, but the
  follow record stays. So `mapRelationship` leaves `following` and
  `followUri` out then. A read without them never says "not followed".
  For a list's block the AppView puts the list's URI in
  `viewer.blocking`; `blockUri` keeps only an `app.bsky.graph.block`
  URI.
- **An ack is partial.** It names only the fields the write changed. The
  state layer never stores it as a whole relationship (state README,
  "Bluesky acks", A1).
- **A list's block or mute is refused (A3).** `mapRelationship` keeps the
  list's URI (`bluesky.blockingByList`, `bluesky.mutingByList`; `null`
  when none). Unblock and Unmute refuse when the ref names a list, or
  when the ref does not say and the profile read finds one. Nothing is
  deleted or sent. The error carries `userMessage`: "This block comes
  from a list. Remove the account from the list, or unsubscribe from
  it." (or "This mute …"). A personal block that a list also covers is
  refused too: a personal undo would leave the account blocked.
- **One record per click intent, even when an answer is lost.** For a
  like, repost, follow or block, the client picks the rkey
  (`compose.nextRkey`, a TID) and keeps it by collection and subject
  until a write answers. If the answer was lost, the next write of the
  same intent first reads that record (`getRecord`). Found: it answers
  that record and writes nothing. Not found: it writes with the same
  rkey. Any other failure of that read writes nothing (the outcome is
  still unknown). Without `compose` the PDS picks the rkey, as before.
- **A post with no URI and CID** is refused (`not_found`) before any
  request.
- **No dedup.** Two clicks that reach the client are two requests. The
  state layer's in-flight guard is what stops a double click.
- **Errors** are normalized as for reads; a 401 calls `onUnauthorized`.

## Feeds (#194, spec 9)

Read only. Caribou never writes the reader's feed prefs.

- **Saved feeds (`blueskySavedFeeds()`).** The list comes from
  `getPreferences().savedFeeds`. The SDK reads `savedFeedsPrefV2` there,
  and the old `savedFeedsPref` only when there is no V2. The answer keeps
  the stored order. Each item keeps its pref `id` and `pinned`.
- **What is kept.** A `timeline` item (Following), and a `feed` item whose
  value is an `at://<did>/app.bsky.feed.generator/<rkey>` URI. A `list`
  item waits for lists (#195). An unknown type, or a bad URI, is left out.
  A second item with the same value is left out.
- **At most 200.** The prefs have no limit. The client keeps the first 200
  kept items (`SAVED_FEEDS_MAX`), in the reader's order, and leaves out the
  rest.
- **Names.** Feed items get their name, description, avatar and creator
  handle from `getFeedGenerators`, 25 per request, one request at a time. A feed the AppView does
  not return is still in the answer with `available: false` and its rkey
  as its name: the reader saved it, so the screen says it is gone instead
  of dropping it. If `getPreferences` or `getFeedGenerators` fails, the
  call fails (errors as for reads).
- **A feed's posts.** `fetchTimeline({ type: 'feed', uri })` →
  `app.bsky.feed.getFeed`. Paging and moderation are the same as for
  Following: the posts go through the same mapper and the reader's
  moderation. Catch-up reads one page, not three
  (`FEED_CATCH_UP_MAX_PAGES`): a custom feed may reorder, so the known top
  is rarely further down. A miss is a gap ("Many new posts"). A pin reason or another unknown reason is a plain entry.
- **A feed that fails.** `UnknownFeed` (the feed is gone) is `not_found`
  with the message "This feed is gone. Its owner may have deleted it." Any
  other failure except a 401 keeps its code with the message "This feed
  did not load. Try again later." A 401 is as for reads. The screen shows
  the message in the feed's place, never an empty page.

## Notifications (#191, spec 9)

`src/map/notification.ts` maps one AppView notification; `fetchNotifications`
in `src/client.ts` reads a page. Both are server-safe.

- **Read:** `listNotifications({ reasons, cursor, limit })`. The filter
  `types` maps to `reasons`: `mention` → `mention`, `reply`, `quote`;
  `favourite` → `like`; `reblog` → `repost`; `follow` → `follow`. No
  `types` (the "All" list) sends no `reasons`: the AppView sends every
  reason, and the client skips the ones it does not know (below).
- **Reasons to types:**

  | reason | Caribou `type` | `status` |
  |---|---|---|
  | `like` | `favourite` | the liked post (`reasonSubject`) |
  | `repost` | `reblog` | the reposted post (`reasonSubject`) |
  | `follow` | `follow` | none |
  | `mention`, `reply`, `quote` | `mention` | the post itself (`uri`) |

  A reply and a quote show as their post, as a Mastodon mention does.
- **Skipped, never thrown:** the reason table is a `Map`, so a reason named
  like an `Object` member (`constructor`, `toString`, `__proto__`) is
  unknown, not a type. Any other reason (`like-via-repost`,
  `repost-via-repost`, `starterpack-joined`, `verified`, `unverified`,
  `subscribed-post`, `contact-match`, and any reason added later); a
  `like` or `repost` with no `reasonSubject`; a notification whose post
  `getPosts` did not return (deleted, blocked, taken down); one with no
  author DID or no valid `indexedAt`; one whose mapper throws (`onMapError`
  hears of it, with the notification's URI).
- **Posts:** the client reads every post the page names with `getPosts`, 25
  URIs per request, each URI once. They map with `mapPost`, so each one has
  its `network`, `viewerOf` and moderation, as in a feed (spec 11, seam 4).
- **Labeler coverage (spec 7.4, rule 3 of the veil):** the rule in
  "Labeler coverage" above (`answerCoverage`: the header when it can be
  read, else what the request sent, at most 20). Authors take the
  `listNotifications` answers' coverage; posts take the `getPosts`
  answers'. Several answers (a catch-up, several `getPosts` batches) keep
  only the labelers every one of them covered. The moderation source takes
  it as `coverage` (`BlueskyModerationSource.post(view, coverage)` /
  `profile(view, coverage)`); the signed-in client's source is
  `readerModerationSource` (`./moderation`), which `restoreClient` uses.
- **Fields:** `id` = the notification's `uri` (the like, repost, follow or
  post record). `createdAt` = `indexedAt`. `account` = the author, with its
  moderation. `groupKey` = the `uri` (the store groups Bluesky
  notifications itself). `bluesky` = `{ uri, reason, reasonSubject,
  indexedAt, isRead }`.
- **Order:** as the AppView sent it, newest first. The store sorts by
  `indexedAt`.
- **Paging:** `nextCursor` is the AppView `cursor`, passed back as it came.
  An empty AppView page ends the list (`null`). A page whose every
  notification was skipped is empty **with** its cursor: it is not the end.
- **Seen hint:** each page has `bluesky: { newestAt, newestUri, unread }`:
  the newest `indexedAt` on the AppView page, skipped ones included, the URI
  of that notification (the raw top), and whether any notification on it
  has `isRead: false`. The store uses it for
  `updateSeen` (`packages/state` README, "Notifications").
- **Catch-up (`sinceId`, `sinceAt`):** no `since_id` here either. As for the
  timeline (seam 7), the client pages from the top, at most 3 pages of 50,
  until it meets the anchor: the notification whose `uri` is `sinceId`, or
  the first one whose `indexedAt` is older than `sinceAt` (the anchor's
  time). The time matters: an unlike or an unfollow deletes the anchor, and
  without it a small account would read its whole list on every poll, and a
  large one would see a false gap. One at the same time as the anchor is
  read; the store drops the ones it holds. The time stop trusts the AppView
  to send the list newest first by `indexedAt`, as it does: one newer row
  below an older one would not be read until a reload. Matched before any
  skip. Met: the
  answer is everything above it and `nextCursor` is `null`. Not met:
  everything it read, and the cursor after the last page (`null` when the
  list ended). The store calls that a gap.
- **Unread badge:** `getUnreadCount()` →
  `app.bsky.notification.getUnreadCount`, the server's count (a missing or
  bad count is 0). `updateSeen(seenAt)` →
  `app.bsky.notification.updateSeen({ seenAt })`. It is a write: it is never
  deduped and never retried here. Mastodon's client has neither method; it
  keeps a local marker.
- **No server groups:** `fetchGroupedNotifications` and
  `fetchNotificationGroupAccounts` answer `not_found`. The store never asks
  them for Bluesky.

## Sign-in and sessions (`src/oauth.ts`, #182, spec 5.5 and 5.6)

Browser only. It loads through `./browser`, in the lazy chunk.

- **One OAuth client per page.** `loadOAuthClient(config)` makes the SDK's
  `BrowserOAuthClient` once, with `responseMode: 'fragment'` and
  `handleResolver` set to Caribou's own origin (spec 5.2). The app reads the
  `client_id` from one place (`apps/caribou/components/_bluesky.ts`): on a
  loopback host (`127.0.0.1`, `localhost`, `[::1]`) it is the loopback
  client, else `<origin>/oauth/client-metadata.json`. The scope is
  `atproto transition:generic`.
- **What the reader types.** A DID (`did:plc:…`, `did:web:…`), a handle
  (`alice.example.com`, a leading `@` is dropped) or a PDS host
  (`https://pds.example.com`; a host with no scheme is read as a handle, as
  the SDK reads it). Empty or anything else: "Enter a Bluesky handle, a DID
  or a server address", and nothing is sent.
- **Site storage first.** Before it sends anything, `beginSignIn` opens
  IndexedDB. When that fails (some private windows), it throws
  `StorageUnavailable`; the panel says Bluesky sign-in needs site storage.
- **The expected DID.** For a DID it is that DID. For a handle, `beginSignIn`
  resolves it through Caribou's resolver (the same one the SDK uses). For a
  PDS host there is none. It goes into the SDK's `state`, which comes back
  on the callback.
- **A callback with no parameters** (a bookmark, a reload after a used
  callback) throws `NoCallbackParams` before the SDK is asked: "This
  sign-in link was already used or has expired."
- **Back from the authorization page.** The SDK's redirect rejects with
  "User navigated back" when the page is still there after 5 s.
  `beginSignIn` throws `SignInCancelled` for it: "Sign-in was cancelled."
- **The callback calls `initCallback()` once** and acts on its result. That
  is what `init()` does on a callback URL; `init()` is not used, because on a
  URL without callback parameters it restores the SDK's last session, which
  can be another account. A second call on the same load would find the
  state used up (the spike's "Not signed in", spec 12.2). The SDK swaps the
  code, checks that the issuer is the DID's own authorization server, and
  removes the fragment.
- **The `sub` check.** When there is an expected DID and the session's DID
  differs, `completeSignIn` throws `SignInMismatch`. A failed attempt never
  changes another account's session. The SDK cannot be made to check
  before it stores: its callback revokes the DID's earlier session and
  stores the new one before it returns. So `completeSignIn` takes
  `isKnown(did)`. When the DID is not a Caribou account, it revokes the new
  session (`oauth.revoke(did)`); `SignInMismatch.kept` is false. When it
  is one, the new session stays as that account's session and `kept` is
  true; the app renews that entry (state rule 11).
- **After the swap.** `completeSignIn` reads the profile with `getProfile`
  and the PDS from the token's audience, and answers `{ did, handle, pds,
  profile }`. A failed profile read does not fail the sign-in: the handle
  is then the one typed, or the DID.
- **401.** The client's `onUnauthorized` is wired to `onExpired`. The SDK
  deletes a session only on a 401 with a `DPoP`/`Bearer` challenge naming
  `invalid_token`; any other 401 is also the end of the session for
  Caribou. Transport errors are not 401s. The moderation loads
  (`getPreferences`, `getServices`, at restore and in `reloadModeration`)
  follow the same rule: a 401 calls `onExpired`, and the input is still
  `null` (fail closed); a network error or a 5xx is only `null`.
- **Restore.** `restoreClient(oauth, did, opts)` calls `oauth.restore(did)`
  (by Caribou's stored DID, never the SDK's own last-session pointer),
  makes an `Agent`, loads the reader's moderation prefs and label
  definitions, and builds the client with `createBlueskyClient`. When the SDK
  says the session is gone (`TokenRefreshError`, `TokenRevokedError`,
  `TokenInvalidError`) it throws `SessionGone`. (On the SDK's
  `AuthMethodUnsatisfiableError`, which it does not export, the SDK deletes
  the stored session; that call fails as a plain error and the next restore
  is `SessionGone`.) Any other error is passed on as it is (a network error).
- **Moderation inputs.** Prefs from `getPreferences`; definitions from
  `getLabelerServices` for every subscribed labeler plus Bluesky's. Either
  that fails is `null`, which `moderate()` treats as missing (fail closed).
  `restoreClient` answers them with the client, for the reader veil, and
  `reloadModeration()`, which loads both again (a cover's Retry), and
  `recheckLabelers()`, which checks the definitions again ("Labeler
  coverage"); the client's later decisions use the new ones.
- **The deleted event.** One listener per DID and sign-in (`opts.key`): a
  restore for a new sign-in drops the listeners of earlier ones. The SDK's
  `onSessionDeleted` (here or in another tab) makes the client check: it calls
  `oauth.restore(did, false)`, and only when that says the session is gone
  does it call `onExpired`. The event can be late: a restore that started
  before a new sign-in to the same DID stored its tokens reports the
  session deleted, and the new sign-in must not be marked expired. A 401 on
  a request never sends `caribou:unauthorized`.
- **Sign-out.** One rule: **once sign-out starts for a DID, the SDK's
  session store refuses every write for that DID until a new sign-in for
  that DID starts.** Every SDK write of a session (the callback, every
  refresh) goes through `sessionGetter.setStored`. `guardSessionStore`
  wraps that one method on the page's client: a write for a DID in the
  signing-out set is dropped, anything stored for it is deleted, and the
  dropped tokens are revoked at the server, best effort. A delete always
  works. `signOut(oauth, did)`:
  1. adds the DID to the set;
  2. reads the stored session and deletes it (`getStored`, `delStored`; no
     per-DID lock, so nothing pending can hold it);
  3. starts the server revoke of the read tokens and does not wait for it.
  It answers after step 2; only step 2 can throw (the store failed), and
  then the caller must not show the account as signed out.
  `allowSessionWrites(did)` takes the DID out of the set. `beginSignIn`
  calls it for the expected DID. A sign-in always leaves the page for the
  authorization server, and the set lives in the page, so the callback
  page starts with an empty set. Same tab only; other tabs are #214. These
  reach SDK internals (`sessionGetter`, `serverFactory`); a missing one
  throws, so an SDK upgrade that moves them fails the tests. Nothing else
  is aborted: other accounts' requests go on.

## Compose (#189, spec 7.2)

The client's write side for a new post. The draft and the retry rules are
in `packages/state` README, "Bluesky drafts"; the dialog's in the app
README, "Bluesky compose".

**Counting (`src/compose.ts`).** `countPost(text)` is the SDK's `RichText`:
`graphemes` is `graphemeLength`, `bytes` is `length` (UTF-8). The PDS checks
`app.bsky.feed.post` with the same `graphemeLen`, so the counter, the Post
button and the server agree. `postFits` is true at 300 graphemes **and**
3000 bytes or fewer. A link counts as its whole text: Bluesky does not
shorten it, and phase 4 sends no link card. Tests: plain text, a family
emoji (1 grapheme, 25 bytes), a flag, a letter with 50 combining marks (1
grapheme, 101 bytes), 30 of those (under 300 graphemes, over 3000 bytes),
CJK (3 bytes each), a link.

**Record keys.** `nextRkey()` is the SDK's `TID.nextStr()` (`@atproto/common-web`).

**Facets.** `detectFacets(agent, text)` is `RichText.detectFacets`: links,
mentions and tags, with byte offsets. The SDK gives a mention whose handle
does not resolve an empty DID, and the PDS would refuse the whole post for
it, so that mention is dropped and its text stays plain. A failed lookup
never fails a post.

**The client methods.** Optional on `CaribouClient`; only this client has them.

| method | call | answer |
|---|---|---|
| `blueskyNextRkey()` | `nextRkey` | a TID |
| `blueskyDetectFacets(text)` | `detectFacets` with the session's agent | facets as plain JSON |
| `blueskyUploadBlob(file)` | `com.atproto.repo.uploadBlob`, `encoding` = the file's type | the blob ref as JSON: `{ $type: 'blob', ref: { $link }, mimeType, size }` |
| `blueskyCreatePost(record, rkey)` | `com.atproto.repo.createRecord` on the reader's repo, collection `app.bsky.feed.post`, that `rkey` | `{ uri, cid }` |
| `blueskyCreatePost(record, rkey, gates)` | with limits (#199): one `com.atproto.repo.applyWrites` on the reader's repo: create the post, then the thread gate, then the post gate, all at that `rkey` | the post's `{ uri, cid }` |
| `blueskyGetOwnGates(rkey)` | `com.atproto.repo.getRecord` of `app.bsky.feed.threadgate` and `app.bsky.feed.postgate` at that `rkey`, on the PDS (#199) | `BlueskyGates`: no thread gate is `replies: null`, a post gate with `#disableRule` is `quotes: false`. `RecordNotFound` is "no record"; any other error throws. A list in the reader's repo is read back by its id; another repo's list or an unknown rule keeps its raw value, so it never equals a sent limit |
| `blueskyGetOwnPost(rkey)` | `com.atproto.repo.getRecord` on the reader's repo, on the PDS (the agent's own host, not the AppView, which can lag) | `{ uri, cid, value }`, or `null` for `RecordNotFound` |

**Reply and quote limits (#199).** `gates` is `BlueskyGates` (rules in
the `packages/state` README, "Reply and quote limits"). `null`, or
`{ replies: null, quotes: true }`, is no limit: the call is the
`createRecord` above, unchanged.

- `replies` not `null`: an `app.bsky.feed.threadgate` with `post` = the
  new post's URI (`at://<DID>/app.bsky.feed.post/<rkey>`), `allow` = the
  rules in order (`#mentionRule`, `#followingRule`, `#followerRule`,
  `#listRule` with `list` = `at://<DID>/app.bsky.graph.list/<id>`; an id that is not a TID is refused, nothing written), `[]` for nobody, and the post's `createdAt`.
- `quotes: false`: an `app.bsky.feed.postgate` with that `post`,
  `embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }]` and
  the post's `createdAt`.
- One `applyWrites` call, post first. One call is one commit: the PDS keeps
  all of it or none. The answer is the first result's `uri` and `cid`.
- Errors are as for `createRecord`: a missing blob is `BlueskyBlobNotFound`.
- Reading limits is unchanged: `viewer.replyDisabled` and
  `viewer.embeddingDisabled` from the AppView.

- Writes and `getOwnPost` skip the read dedup: two sends are two requests.
- Errors go through `normalizeXrpcError`; a 401 calls `onUnauthorized`.
- **`getOwnPost` answers `null` only for the XRPC error `RecordNotFound`.**
  Anything else throws: a network error, a timeout, a 5xx, a 404, a 400
  such as `AccountDeactivated` or `AccountTakedown`, or a 400 whose message
  says "not found". An unknown answer is never read as "not there", or a
  retry could send on it.
- **A used `rkey`** gives a plain 500 from the PDS (spec 7.2: the repo layer
  throws "There is already a value at key"). The client does not try to
  read it; it is `server_error`, and the retry rule finds the record.
- **A missing blob** (`BlobNotFound`, or "Could not find blob") is
  `BlueskyBlobNotFound`, a `CaribouError('not_found')` with the blob's
  `cid` when the message names it. The root exports it, so the app can tell
  it apart without the SDK.
- The Mastodon-shaped `createStatus`, `uploadMedia`, `fetchMedia`,
  `waitForMedia`, `updateMedia` and `fetchInstance` answer `not_found`
  naming the Bluesky method to use. Alt text has no server call: it goes in
  the post's embed.
- `restoreClient` passes the helpers in as `compose`, so `client.ts` keeps no
  runtime import of the SDK.

## Delete (#190)

Bluesky has no edit. Delete removes the post record; a redraft reads the
record first and writes a new one (rules in `packages/state` README,
"Bluesky delete and redraft").

| method | call | answer |
|---|---|---|
| `blueskyDeletePost(uri)` | `com.atproto.repo.deleteRecord` on the reader's repo, collection `app.bsky.feed.post`, the URI's rkey | nothing, when the record is gone |
| `blueskyGetBlob(cid)` | `com.atproto.sync.getBlob` with the reader's DID, on the PDS | the blob's bytes as a `Blob`, typed from the answer (the caller types it from the record) |

- **Only the reader's own post.** The URI must be
  `at://<the session's DID>/app.bsky.feed.post/<rkey>`. Any other URI is
  refused with `CaribouError('not_found')` before any request: a delete
  never goes to someone else's repo, a like or a repost record.
- **Only `getRecord` decides a delete in doubt** (as R1 does for a create).
  An answered 4xx refusal is thrown as it is: the record is still there.
  After anything else (no answer, a timeout, a 5xx), the client reads the
  record (`blueskyGetOwnPost`): `RecordNotFound` → the delete happened,
  and the call resolves; found → the delete's error is thrown; the read
  fails → `BlueskyDeleteUnknown` (a `CaribouError('unknown')`, root export)
  is thrown, and the caller must not say "not deleted".
- A delete of a record that is already gone succeeds (the PDS answers it
  as done). So a second click, or a retry after a lost answer, is safe.
- Writes skip the read dedup. Errors go through `normalizeXrpcError`; a
  401 calls `onUnauthorized`.
- `deleteStatus` (Mastodon's) answers `not_found` naming
  `blueskyDeletePost`, like `createStatus`. `fetchStatusSource` does the
  same, naming `blueskyGetOwnPost`: the record is the source.

## Lists (#195, spec 9)

`src/lists.ts`. Only the reader's own **curate** lists
(`app.bsky.graph.defs#curatelist`). Moderation lists (`modlist`) and
starter-pack lists (`referencelist`) are out of scope: they are never shown,
changed or deleted here. **Every Bluesky list is public:** anyone can see its
name and who is in it. The app says so in the New list and Edit list dialogs.

**Where reads go.** The lists and their members are records in the reader's
own repo, so they are read from the **PDS** with
`com.atproto.repo.listRecords` and `getRecord`, not from the AppView. The
PDS reads its own writes at once; the AppView can lag 60 s, and the state
layer replaces its cache with each read, so a lagging read would take a new
list or member off the screen. Only profiles (`getProfiles`) and the list
feed (`getListFeed`) come from the AppView.

| method | call | answer |
|---|---|---|
| `fetchLists()` | `listRecords` on `app.bsky.graph.list`, every page | the curate lists, newest first |
| `fetchList(id)` | `getRecord` | the list; `not_found` for `RecordNotFound` or another purpose |
| `createList(input)` | `createRecord` with a client-picked rkey | the new list |
| `updateList(id, input)` | `getRecord`, then `putRecord` with `swapRecord` | the list as saved |
| `deleteList(id)` | `applyWrites`: every item of the list, then the list | nothing |
| `fetchListAccounts(id)` | `listRecords` on `app.bsky.graph.listitem`, then `getProfiles` (25 each) | the members, newest first |
| `addListAccounts(id, dids)` | one `listitem` record per DID, client-picked rkeys | nothing |
| `removeListAccounts(id, dids)` | `applyWrites`: delete every item of the list for those DIDs | nothing |
| `fetchAccountLists(did)` | the `listitem` records whose subject is the DID | the curate lists that hold it |

- **Ids.** A list's id is its record key (a TID: the lexicon says
  `key: 'tid'`). Its URI is `at://<reader DID>/app.bsky.graph.list/<rkey>`.
  A record whose key is not a TID, or whose `name` is not a non-empty
  string, is not a valid list and is left out. A member's id is its DID.
- **Mapping.** `title` is `name`. Bluesky has no replies policy and no
  "exclusive": `repliesPolicy` is `'list'` and `exclusive` is `false`, and
  `updateList` ignores both. The app does not offer them.
- **Only the reader's repo.** Every read and write names the session's DID
  as `repo`. An item of another list, or of another collection, is never
  touched.
- **The name.** Trimmed. Empty, or over 64 UTF-8 bytes (the lexicon's
  `maxLength`), is refused before any request (`CaribouError('unknown')`
  with `userMessage`).
- **Rename keeps the rest.** `updateList` reads the record and writes it
  back with only `name` changed: a description, an avatar or fields
  Caribou does not know stay. `swapRecord` is the read's CID, so a change
  made elsewhere in between fails the save (`InvalidSwap`) instead of
  being lost.
- **Members need not be followed.** Unlike Mastodon, any account can join.
- **One record per intent (spec 7.2, R1; Actions).** `createList` and
  `addListAccounts` pick the rkey (`compose.nextRkey`, a TID) and keep it
  by intent (the name; the list and the DID) until a write answers. After
  no answer, a timeout or a 5xx, the client reads that rkey back
  (`getRecord`): found → the write went through, and the call answers it;
  `RecordNotFound` → the error is thrown, and the next write of the same
  intent uses the same rkey; the read fails → `BlueskyWriteUnknown` (a
  `CaribouError('unknown')`, root export) is thrown, and the rkey stays
  kept. An answered 4xx is thrown as it is and forgets the rkey. Without
  `compose` the lists cannot be written (`not_found`).
- **Removal removes them all (A3).** `removeListAccounts` checks the
  list is a curate list of the reader's first, like every other write, and
  deletes every
  item record of that list for the DID, not one guessed one: a list can
  hold the same account twice when another app added it again. None found
  is done: the account is already not a member.
- **Delete takes the items with it.** Deleting a list record leaves its
  items behind as stray public records, so `deleteList` deletes them too,
  in `applyWrites` batches of at most 200 writes, the list last. With 199
  items or fewer it is one atomic call (more in L2 below).
- **Only `getRecord` / `listRecords` decide a write in doubt.** After a
  rename, a single-call delete or a removal that got no answer, a timeout or a 5xx, the
  client reads the PDS: the name is the new one / the list is gone / no
  item is left → done; otherwise the write's error is thrown; the read
  fails → `BlueskyWriteUnknown`.
- **Paging.** `listRecords` 100 per page, at most 50 pages (5,000
  records). The scan says whether it read to the end. The item scan is
  over every list item in the repo, all lists together, so the cap is the
  reader's total items, not one list's.
- **A complete inventory, or no destructive write (L1).** `deleteList`,
  `removeListAccounts` and the read that decides a removal in doubt refuse
  when the item scan was cut: nothing is written, and the error says "This
  list is too large to change here. Use bsky.app." (`userMessage`, which the
  state layer toasts). A cut scan never decides a write: a removal whose
  deciding read was cut is `BlueskyWriteUnknown`. `fetchListAccounts` and
  `fetchAccountLists` refuse the same way ("This list is too large to show
  here. Use bsky.app."), so no screen shows a partial set as whole.
- **A partly done delete says so (L2).** With more than 199 items the
  delete is several `applyWrites` calls, the list record in the last one.
  When a call after the first fails (an answered refusal or a lost answer),
  or the first one's answer is lost, earlier items may be gone while the
  list stays. The client reads the list record: gone → done; still there →
  `BlueskyListPartlyDeleted` (a `CaribouError('unknown')`, root export,
  with `userMessage` "Some members were removed, but the list was not
  deleted. Delete it again to finish." when an earlier call answered, or
  "Some members may have been removed, …" when only the first call was in
  doubt); the read fails →
  `BlueskyWriteUnknown`. A single call is atomic: its answered refusal, or
  a lost answer with the list still there, is the plain error.
- **Sweep after delete (L5).** Another tab or app can add a member while
  a delete runs. So after the list record is gone, the client scans the
  items once more and deletes every item that still names the deleted
  list. One sweep, no loop; L1 applies (a complete scan only). When the
  sweep fails or is cut, the list is still gone, and the call throws
  `BlueskyListPartlyDeleted` with `listGone: true` and `userMessage` "The
  list was deleted, but some of its members may remain on Bluesky." When
  the sweep's own delete gets no clear answer, the client reads once more:
  no item left → done, as if nothing failed; items left, or that read
  fails → the same warning.
- **Accepted limit: an item moved between the scan and the delete (L3).**
  The rkeys come from the scan; `applyWrites` deletes what is at them when
  it runs. Bluesky apps create and delete list items; they do not update
  them. Both limits need another app writing to the same list while
  Caribou deletes it:
  - **A move during a delete can delete the moved item.** If another app
    changes an item to name another list between the scan and the delete,
    the delete removes it, and the other list loses that member.
  - **An add during the sweep can stay behind.** An item added after the
    sweep's scan stays as a stray public record naming the deleted list.

  `swapCommit` would guard both, but it would also fail the delete on any
  unrelated write to the repo (a like), so Caribou does not use it. An
  item added after the first scan and before the sweep is handled (L5).
- **A duplicate add heals on remove.** `addListAccounts` does not check
  for an item already there: the picker's box comes from the last read,
  and a stale read can add the same DID twice. Remove deletes every item
  for the DID, so the duplicate goes with it.
- **Cost.** Every member write, `fetchListAccounts` and
  `fetchAccountLists` scan the whole item collection (and the picker reads
  the lists too). Up to 50 requests each on a very large repo.
- **A member the AppView does not know** (deleted, taken down, not yet
  indexed) is still listed, so it can be removed: an account whose `acct`
  is the DID, no name, no avatar and **no** `moderation`. The app covers
  a Bluesky account with no `moderation` (fail closed).
- **Moderation.** Members carry `moderation.profile(view, coverage)` like
  every account; the list feed's posts carry the post decision like Home.
- Reads share the dedup; writes do not. Errors go through
  `normalizeXrpcError`; a 401 calls `onUnauthorized`.

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
  bsky.app". `embedUrl` = `playlist` when it is an http(s) URL, else `''`.
  `playlist` is HLS (`.m3u8`, spec 7.3); the app plays it in
  `<caribou-bluesky-video>` (app README, "Bluesky video"). A card with an
  empty `embedUrl` keeps the play mark that links to bsky.app.
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
  seen only by signed-in readers." The SDK filters the outer post from
  signed-out lists (`contentList.filter`) but leaves its thread view alone,
  so `mapEmbed` hides the quoted post itself, on every surface. A reader
  with a Bluesky account active sees the quote.
- **The signed-out allow-list (spec 8.3):** in a signed-out copy, a quoted
  post shows only when `isProvenVisible(author)`: the author object is
  there with a `did:` DID, a string handle and a `labels` array, and no
  `!no-unauthenticated`. Otherwise the quote is the hidden quote above. A
  missing author, a partial one, or labels null or not an array count as
  hidden (fail closed).
- **A record card's creator (spec 8.3):** in a signed-out copy, a feed,
  list, starter pack or labeler whose creator is not `isProvenVisible` (the
  label, or a missing or partial creator) becomes a card with the note "This account asked
  to be seen only by signed-in readers." (`NO_UNAUTHENTICATED_NOTE`), which
  links to `https://bsky.app`. Nothing of the record is kept: no name,
  description, image or handle. A reader with a Bluesky account active
  sees the card.
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
one fallback `card`, not two (known by how it was built, not by its title). If `mapPost`
throws on a quoted record, the quote is `accepted` with no post, and the
card says "The quoted post is not available."

Each card and media URL must be `http:` or `https:`, and is normalized
(`URL.href`, as the app's `_http-url.ts` does). A `uri` or `thumb` that is
not is dropped (the link card checks it again).

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
  fetches no script with atproto code in it, and once a Bluesky sign-in
  starts the code arrives in `bsky-*.js`. It fails without the group.

## The server-safe rule

`src/index.ts` and every module it reaches import `@atproto/*` for **types
only** (`import type`). So the server render and any client code can import
the package root without pulling in the SDK. Mappers and the facet renderer
are pure functions.

`./moderation`, `./syntax` and `./browser` are the SDK doors. The server may import
`./moderation` and `./syntax` (SSR runs moderation with logged-out defaults,
and checks a route's syntax). The client loads `./moderation` and
`./browser` lazily, and never `./syntax`. `src/oauth.ts` is browser only
and loads through `./browser`; so does `src/muted-words.ts`, through it.

`src/__tests__/server-safe.test.ts` fails on a runtime `@atproto` import in
any module other than the doors, `src/oauth.ts` and `src/muted-words.ts`: a value import, a side-effect import, or a
dynamic `import()`. A lazy load of the SDK belongs in a door too, so the
server-safe modules stay pure and the chunk rule has one place to look.

## When the chunk loads

Bluesky is on for everyone in the app; there is no browser flag. The app
loads the `bsky` chunk only when a Bluesky account restores, a reader
starts a Bluesky sign-in, or a public Bluesky page is deferred after an
AppView 429 (the browser then runs moderation itself). A Mastodon page
never requests it.

## Fixtures

Real AppView JSON shapes, under `src/__fixtures__/`, with placeholder
accounts only (`alice.example.com`, `did:plc:alice`). Never a real account.
