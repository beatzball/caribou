# @beatzball/caribou-mastodon-client

> A thin wrapper over `masto` that adds in-flight dedup, error normalization,
> and a stable surface for the rest of Caribou.

**Status:** Extractable with renaming — the dedup + error layer is generic.

## Purpose

`masto` is a complete Mastodon REST client, but raw consumption has three
problems Caribou hits everywhere: (1) two components mounting at the same
time both fire the same fetch, (2) errors come back as a mix of
`HttpError`, `TypeError("fetch failed")`, and unknown shapes that every
caller would have to discriminate on, (3) auth-expiry needs a single
"kick the user back to signin" hook instead of being open-coded. This
package fixes all three behind one interface (`CaribouClient`). It also
defines Caribou's own data types (`Status`, `Account`, ...), so the rest
of Caribou never names masto's types.

## Position in the stack

- **Depends on:** `masto`, `@beatzball/caribou-auth` (UserKey)
- **Depended on by:** `@beatzball/caribou-state` (every store), the SSR
  routes in `apps/caribou/server/`
- **Boundary it owns:** all network I/O against a Mastodon instance
  *for an authenticated user*. Public/unauthenticated SSR fetches go
  through the server-side `mastodon-public` lib, not this package.

## Public API

- `CaribouClient` — interface: `fetchTimeline`, `fetchStatus`,
  `fetchThread`, `lookupAccount`, `fetchAccountStatuses`
- `createCaribouClient(userKey, sessionSource)` — factory
- `TimelineKind` — `'home' | 'local' | 'public' | 'bookmarks' | { type: 'hashtag', tag } | { type: 'list', id }`
- `CaribouError` — class with `code: CaribouErrorCode` and optional `retryAfter`
- `CaribouErrorCode` — `'unauthorized' | 'not_found' | 'rate_limited' | 'unreachable' | 'server_error' | 'unknown'`
- `normalizeError(err)` — coerces masto / fetch / unknown errors into a `CaribouError`
- `createDedup()` — generic key-keyed in-flight Promise dedup
- `SessionSource` — interface for credential supply + 401 callback
- `Status`, `Account`, `Relationship`, `List`, `Notification`, and the types
  they hold — Caribou's own data types (see below)
- `CaribouClient.capabilities` — what the client's network can do
  (`Capabilities`). The Mastodon client has `MASTODON_CAPABILITIES`. A
  screen hides a control the network lacks; it does not show it broken.
  Capabilities need the active account, which the server does not know:
  read them in `firstUpdated()` or later, never in the first render.
- `resourceNetwork(resource)` — `'bluesky'` when a post, account or
  relationship has a `bluesky` field, else `'mastodon'`. Every cached
  resource says its network this way, at no cost to Mastodon objects.
- `canActOn(client, resource)` — true only when the client's network is the
  resource's. A screen asks this, never just "is there a client" (spec
  section 11). A Mastodon resource also needs the client's server; the
  screen checks that as before.
- `Capabilities.readLagMs` — how long a read can lag behind the reader's own
  write: 0 for Mastodon, 60 000 for Bluesky. The state package's slot rule
  uses it.
- `CaribouClient.timelineOrder(kind)` — how the timeline store orders
  new posts: a compare function, or null to keep the order the feed sent.
  Mastodon (`mastodonTimelineOrder`) sorts by id, newest first, except
  bookmarks. With null, a check (`sinceId`: the top shown post) must
  answer every entry above that post, paging from the top until it meets
  it, and end with it. An answer that never meets it becomes the store's
  `gap`, which replaces the list when applied.

Subpath export: `@beatzball/caribou-mastodon-client/sanitize-opts` →
`PURIFY_OPTS` (DOMPurify config shared by client and server sanitizers).

## How to use the owned types

Import data types from this package, never from `masto`:

```ts
import type { Status, Account } from '@beatzball/caribou-mastodon-client'
```

- **Mastodon's field names.** `status.favouritesCount`,
  `account.displayName` and the rest read as they always have.
- **Recursive.** `Status.account` is a Caribou `Account`, `Status.reblog`
  and `Quote.quotedStatus` are Caribou `Status`es, and
  `Notification.status` is a Caribou `Status`.
- **A network's extra data goes in its own field.** `Status.bluesky`, `Account.bluesky` and
  `Relationship.bluesky` hold what Mastodon has no place for (record URIs,
  labels, moderation). A Mastodon object never has them. Do not add a new
  top-level field for one network.
- **`src/types.ts` imports nothing.** A client for another network can
  map into these types without pulling in masto.
- **The Mastodon mapping costs nothing at run time.** masto's objects
  already have these shapes. `src/masto-mapping.ts` checks that at compile
  time, so a masto upgrade that changes a shape fails `pnpm typecheck`
  there.
- **Only two files may name masto's types:** `src/create-client.ts` and
  `src/masto-mapping.ts`. The test `owned-types-boundary.test.ts` fails if
  any other TypeScript file in `apps/` or `packages/` (`.d.ts` included)
  names `mastodon.v1.*`, `mastodon.v2.*` or `mastodon.rest.*`, or reaches
  `masto` or a `masto/...` subpath by any import, export, `import()` or
  `require`. It parses each file, so line breaks and aliases do not hide one.
- **The corrections are locked in.** `owned-types-contract.test.ts` checks
  in `tsc` that the nullable fields accept `null`, that `application` and
  `quoteApproval` can be left out, and that `viewerOf` takes a UserKey, not
  a bare DID. A shape that goes back fails `pnpm typecheck`.
- **Pages carry an opaque cursor.** `fetchTimeline`, `fetchAccountStatuses`,
  `fetchMutes` and `fetchBlocks` answer a `Page<T>`: the items and a
  `nextCursor`, null on the last page. Pass it back as `cursor`. Never make
  one from an item's id: a Mastodon timeline's cursor happens to be its last
  status id, but bookmarks, mutes and blocks page by another id, and
  Bluesky pages by a token of its own.
- **masto's own declarations can be wrong.** masto puts poll `emojis` on
  each option; the API puts them on the poll. `src/masto-mapping.ts` fixes
  masto's declaration there, with a note. Fix the next one the same way,
  never with a cast.
- **Need a field that is not here?** Add it to `src/types.ts` with
  Mastodon's name and shape. The mapping check tells you if masto disagrees.

## How it works

**Dedup is keyed by request shape.** Every method computes a string key
that uniquely identifies the request (`status:${id}`,
`acct-statuses:${accountId}:${tab}:${cursor}:${limit}`) and runs through
`createDedup().run(key, fn)`. Two simultaneous calls with the same key
share one in-flight promise; the entry clears on settlement, so the
*next* call hits the network. This is per-client, not global — each
`CaribouClient` instance gets its own dedup map, which is fine because
clients are session-scoped.

**Error normalization happens at the boundary.** Every method goes
through `run(key, fn)`, which catches and runs `normalizeError`. Callers
always see `CaribouError` with a known code. The `unauthorized` branch
also fires `session.onUnauthorized()` before re-throwing, so consumers
can wire global signout-and-redirect once instead of at every callsite.

**The session is pulled, not pushed.** `createCaribouClient` takes a
`SessionSource` that has a `get()` returning current credentials.
Tokens are read fresh per request, which means a token rotation in
the parent session signal is picked up on the next fetch with no
cache invalidation.

## Gotchas

- **`CaribouClient` is tied to a single `userKey`.** It does *not*
  re-read the userKey from `SessionSource`. If the session source
  switches accounts, you need a new client (which is exactly what
  `state.activeClient` does — recomputed on `activeUser` identity change).
- **Dedup keys collapse query identity by `JSON.stringify`.**
  `fetchTimeline` builds the key from `JSON.stringify(params)`. JS
  property iteration order is insertion-order, so callers that build
  the params object differently (`{ cursor, limit }` vs `{ limit, cursor }`)
  get different keys for the same logical request. This is rare but
  real if a refactor reorders fields.
- **`fetchAccountStatuses` for `tab: 'replies'` sends no params.** The
  Mastodon default for the account-statuses endpoint already shows
  replies, so the implementation just omits both `excludeReplies` and
  `onlyMedia`. If Mastodon ever changes the default, the `replies` tab
  will break silently.
- **`normalizeError` only flags `unreachable` for `TypeError("fetch failed"|"network"|"Failed to fetch")`.**
  Other transport errors (DNS failure surfaces in older runtimes, edge
  proxy reset) fall through to `'unknown'`. Adjust the regex if a new
  runtime surfaces a phrase we haven't seen.
- **No retry layer.** Dedup prevents redundant requests; it doesn't
  retry failed ones. Callers that want retry-with-backoff have to layer
  it on top.

## Externalization potential

**Extractable with renaming.** The interesting pieces — `createDedup`,
`normalizeError`, the `run`/`session.onUnauthorized` pattern — are
generic. The Mastodon coupling is in `CaribouClient`'s method shape and
`TimelineKind`'s domain values. A v2 split would be:

- `@org/dedup` — the `createDedup` module, ~20 lines
- `@org/oauth-error-normalizer` — `normalizeError` plus the `CaribouError` shape
- `@beatzball/caribou-mastodon-client` — keeps the masto-flavored
  `CaribouClient` interface + factory

Worth doing only if a second consumer appears. Today it'd be premature.

## Alternatives considered: masto vs. raw fetch

`masto` was chosen over hand-rolled fetch wrappers for: type coverage of
the entire v1 API, cookie-free auth (`accessToken` config), and a
`Method`/`Paginator` model that maps cleanly onto our async-function
return types. Trade-offs against the alternatives:

| Approach | What we'd gain | What we'd give up |
|---|---|---|
| `masto` (chosen) | Comprehensive types, paginator types, no maintenance burden on path strings | A non-trivial dep (~50kb min+gz). Awkward seams: `Method<T, P>` is directly callable but `Paginator` is `PromiseLike` not `Promise`, which we work around with `async (c) => …`. |
| Raw `fetch` + hand-typed responses | Smallest bundle. Total control over retry/dedup. No PromiseLike awkwardness. | Re-implementing every endpoint shape and response type. Drift risk vs. server schema. The dedup + error layer in this package would still be needed. |
| `openapi-typescript` + `openapi-fetch` against Mastodon's spec | Generated types, no hand-typing | Mastodon's OpenAPI spec is incomplete and out-of-date upstream; gains are illusory. |
| `@elenajs/mastodon-rest` (hypothetical) | A Caribou-aligned client | Doesn't exist. |

The migration cost is mostly in the response-type surface. If we ever
hit a wall with `masto` (e.g. a Mastodon API change that ships before
masto picks it up), the `run(key, fn)` boundary makes a per-method swap
to raw fetch tractable without rewriting the client.

## See also

- `packages/state/src/users.ts` — wires `SessionSource` from the
  active-user signal
- `apps/caribou/server/lib/mastodon-public.ts` — the
  unauthenticated counterpart for SSR
