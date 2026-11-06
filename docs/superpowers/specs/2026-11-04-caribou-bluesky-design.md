---
title: Caribou Bluesky support — Design Spec
date: 2026-11-04
status: Accepted (2026-11-04)
---

# Caribou Bluesky support — Design Spec

## 1. Summary

Caribou is a Mastodon client. This spec adds Bluesky as a second network.
Bluesky runs on the AT Protocol ("atproto").

A reader signs in with a Bluesky account next to their Mastodon accounts. They
read their Following feed and notifications, open profiles and threads, and
like, repost, reply, quote, bookmark, follow and post. A feature that one
network lacks is hidden for that network, not shown broken.

The decided shape, in one line each (the owner accepted it on 2026-11-04):

- **Sign-in:** atproto OAuth as a **public browser client** for the first
  release. Tokens and the DPoP key stay in the browser. Caribou's server serves
  the client metadata and resolves handles. It does not proxy data. A
  **client-assertion backend** (5.3, option D) is the planned upgrade if the
  two-week session cap hurts.
- **Model:** a second `CaribouClient` behind **Caribou-owned types** that keep
  Mastodon's field names, plus a `bluesky` field and per-network
  `capabilities`. This is not "only an adapter": section 6.3 lists the seams
  the state layer needs first.
- **Routes:** `/@alice.example.com` is a Bluesky profile. A *local* Mastodon
  username never has a dot. Section 8.4 states the one edge case.
- **SSR:** profiles, threads and feeds come from the public AppView without a
  token. Following, notifications, bookmarks and post search need a token and
  render on the client, as Mastodon `/home` does today.

Round 2 of this spec fixes the review findings on PR #165. The main changes:
day one now includes notifications and SSR, the session expiry keeps drafts,
moderation is kept per surface with label definitions, and the phase sizes are
about twice what round 1 said (section 13). Round 3 makes moderation results plain data for SSR, makes the veil wait for the reader's labels, adds freshness rules to viewer state, and fixes the compose retry. No code ships with this spec.

---

## 2. Scope

### 2.1 Goal: day one

Day one is the end of phase 4 (section 13). It needs phases 0–4 and the quoted
posts work (PR #167). On day one a reader can:

- Sign in with a Bluesky handle (`alice.bsky.social`, `alice.example.com`), a
  DID, or a PDS host, on its own sign-in panel. Keep a Mastodon account signed
  in at the same time.
- Switch between Bluesky and Mastodon accounts with the account switcher.
- Read the **Following** feed with the "N new posts" banner.
- Open a **profile** (posts, replies, media) and a **thread**. A shared link
  works signed out (SSR).
- See text with links, mentions and tags; images with alt text; link cards;
  quoted posts; quoted posts with media.
- See labels and moderation the way the reader set them: blur, warn or hide,
  including labels from labelers they subscribe to.
- **Like, repost, quote, reply, bookmark, follow, mute, block.** Each one is
  optimistic with rollback. Reply and Quote are off on a post whose author
  turned them off.
- **Compose** a post (300 graphemes and 3000 bytes), with up to four images and
  alt text, as a reply or a quote.
- **Delete** an own post, and delete and redraft.
- Read **notifications** with the unread badge.

Not on day one, and **hidden** in the nav for a Bluesky account until built:
Search, Lists, Feeds.

### 2.2 Later (planned)

- **Search** for people and posts; hashtag pages (phase 5).
- Pinned and saved **custom feeds** (phase 5).
- **Lists** (curate lists) and list feeds (phase 5).
- **Muted words**, mapped to the filters screen (phase 6).
- "Act as another account" (#131) between Bluesky accounts (phase 6).
- **Video** playback (phase 6).
- Creating **thread gates** and **post gates** in compose (phase 6).
- **Link cards** made by compose (phase 6).

### 2.3 Non-goals

- **DMs** (`chat.bsky`). Caribou has no DM view for Mastodon either.
- **Moderation lists**, **starter packs**, running a **labeler**.
- A **merged home** with both networks in one feed.
- **Cross-posting** one draft to both networks.
- **Account management**: handle change, email, migration, deletion.
- Our own **AppView**, relay or PDS.
- **Bridged accounts** (Bridgy Fed). A bridged account is an account on the
  other network. Caribou does nothing special.

---

## 3. Context and references

- AT Protocol OAuth: <https://atproto.com/specs/oauth>
- OAuth app architectures: <https://atproto.com/guides/about-oauth>
- Client-assertion backend proposal:
  <https://github.com/bluesky-social/proposals/tree/main/0010-client-assertion-backend>
- Permission scopes: <https://atproto.com/specs/permission>
- Handles: <https://atproto.com/specs/handle>
- Rich text facets: <https://docs.bsky.app/docs/advanced-guides/post-richtext>
- SDK and lexicons: `bluesky-social/atproto` on GitHub —
  `packages/oauth/oauth-client-browser`, `packages/oauth/oauth-provider`,
  `packages/api/src/moderation`, `packages/bsky/lexicons/app/bsky/`
- Caribou v1 spec: `docs/superpowers/specs/2026-04-21-caribou-v1-design.md`
  (sections 5, 7 and 8 are the parts this spec changes)
- Multi-account switcher: #58. Act as another account: #131. Quoted posts:
  #56, PR #167.

### 3.1 Words used here

| word | meaning |
|---|---|
| **DID** | The stable id of an account, like `did:plc:abc123`. It never changes. |
| **Handle** | The name a person shows, like `alice.bsky.social`. It is a domain and it can change. |
| **PDS** | Personal Data Server. It holds one account's records and takes its writes. |
| **AppView** | The service that builds feeds, threads, counts and notifications from all records. Bluesky runs `api.bsky.app` and the token-free `public.api.bsky.app`. |
| **Record** | One item in an account's repo: a post, a like, a follow. A like is a record, not a flag. |
| **AT URI** | The address of a record: `at://did:plc:abc/app.bsky.feed.post/3mzh...`. The last part is the **rkey**. |
| **CID** | A hash of one version of a record. A reply or a like names both the URI and the CID (a "strong ref"). |
| **Facet** | A range in a post's plain text that is a link, a mention or a tag. |
| **Label** | A tag on a post or an account from a moderation service (a **labeler**) or from the author. |
| **DPoP** | A rule that binds a token to a key. Each request carries a fresh proof signed by that key. A stolen token alone is useless. |
| **PAR** | Pushed Authorization Request. The client sends the sign-in request to the server first and gets a short `request_uri` back. |

### 3.2 What we checked by hand (2026-11-04)

From `https://public.api.bsky.app/xrpc/`, with no token:

| endpoint | answer |
|---|---|
| `app.bsky.actor.getProfile` | 200 |
| `app.bsky.actor.searchActors` | 200 |
| `app.bsky.actor.searchActorsTypeahead` | 200 |
| `app.bsky.feed.getAuthorFeed` | 200 |
| `app.bsky.feed.getPostThread` | 200 |
| `app.bsky.feed.getFeed` (a feed generator) | 200 |
| `app.bsky.graph.getLists` | 200 |
| `app.bsky.labeler.getServices?detailed=true` | 200 |
| `app.bsky.feed.searchPosts` | **403** |
| `app.bsky.feed.getTimeline` | **401** (`AuthMissing`) |

The public AppView sends `access-control-allow-origin: *` and
`cache-control: public, max-age=30`. A post view has `bookmarkCount` and
`quoteCount`. `bsky.social` advertises the scopes `atproto`,
`transition:generic`, `transition:email` and `transition:chat.bsky`, and the
client auth methods `none` and `private_key_jwt`. It advertises no granular
scopes yet.

From the lexicons on `main` (`packages/bsky/lexicons/app/bsky/`):

- `feed.post` `text`: `maxGraphemes: 300`, `maxLength: 3000` (bytes).
- `embed.images` `image`: `maxSize: 2000000` ("up to 2 MB, formerly 1 MB").
- `feed.defs#reasonRepost`: requires only `by` and `indexedAt`. `uri` and
  `cid` are optional.
- `feed.defs#viewerState`: `repost`, `like`, `bookmarked`, `threadMuted`,
  `replyDisabled`, `embeddingDisabled`, `pinned`.

From `oauth-provider/src/oauth-constants.ts` on `main` (the provider that
`bsky.social` runs): `TOKEN_MAX_AGE` 60 minutes; `SESSION_LIFETIME` and
`REFRESH_LIFETIME` 2 weeks; `SESSION_LIFETIME_EXTENDED` 2 years and
`REFRESH_LIFETIME_EXTENDED` 3 months (confidential clients).

From `oauth-client-browser/src/browser-oauth-client.ts` on `main`:
`responseMode` defaults to `'fragment'` ("the query params will not be sent to
the server"). `initRestore` restores a stored session or throws. There is no
client-assertion hook (`keyset: undefined`).

From Mastodon's `app/models/account.rb`: local usernames must match
`/\A[a-z0-9_]+\z/i`; remote usernames match `USERNAME_RE`, which allows `.` and
`-` inside.

Not checked, left to phase 0: whether the public AppView still returns the
posts of an account with `!no-unauthenticated` (we had no such account to
probe). Phase 0 found that it does (12.2).

---

## 4. Key decisions — at a glance

| # | decision | decided | other ways |
|---|---|---|---|
| 1 | OAuth client | Public browser client now; client-assertion backend later | BFF; token-mediating backend (5.3) |
| 2 | Where tokens live | Browser IndexedDB, keyed by DID | Caribou server |
| 3 | Model between screens and clients | Caribou-owned types with Mastodon field names + `bluesky` field + `capabilities` | A neutral model with new field names |
| 4 | Client library | `@atproto/api` + `@atproto/oauth-client-browser` | Hand-written XRPC calls |
| 5 | UserKey for Bluesky | `<did>@bsky` | `<handle>@<pds host>` |
| 6 | Profile route | `/@alice.example.com` (a dot and no second `@` means Bluesky) | A prefix, like `/bsky/@alice.example.com` |
| 7 | Post route | `/@<handle or did>/<rkey>` | The full AT URI in the path |
| 8 | Sign-in form | Two panels, Mastodon and Bluesky | One box that guesses |
| 9 | Home for Bluesky | Following feed | A merged feed (non-goal) |
| 10 | `/local` and `/public` for Bluesky | Not shown | Map to "Discover" |
| 11 | Scopes | `atproto transition:generic` | Granular scopes when the PDS has them |
| 12 | Moderation | The SDK's `moderatePost` / `moderateProfile` with label definitions, kept per surface | Map labels onto Mastodon's CW fields |

The owner accepted all of them on 2026-11-04. Section 12.3 records the ones that were open questions.

---

## 5. Sign-in

### 5.1 How atproto OAuth differs from Mastodon's

| | Mastodon today | atproto |
|---|---|---|
| App registration | `POST /api/v1/apps` per server, cached 7 days | None. The `client_id` **is** a URL to a JSON metadata file that Caribou serves. |
| Client secret | Yes, kept on the Caribou server | None. A confidential client signs a JWT with its own key. |
| Where to send the user | The server the user typed | Resolve handle → DID → DID document → PDS → `/.well-known/oauth-protected-resource` → authorization server → its metadata |
| Request | Plain redirect | PAR first, then redirect with `request_uri` |
| PKCE | No | Required, `S256` |
| Token | Bearer, long-lived | DPoP-bound. Refresh token single-use. |
| Callback | `/api/signin/callback` checks the browser's `caribou.signin` cookie, swaps the code on the server, and returns the session in the response body. The token is never in a URL. | The browser swaps the code itself. The SDK reads the callback from the URL fragment by default. |
| After the token | Use it | Check that `sub` (the DID) resolves to a PDS whose authorization server issued the token |

Token lifetimes. The atproto spec gives guidance; each authorization server
sets its own policy. What the spec says, and what `bsky.social` runs (3.2):

| | spec guidance | `bsky.social` today |
|---|---|---|
| Access token | under 30 minutes recommended | 60 minutes |
| Public client session | 2 weeks recommended for untrusted clients | 2 weeks |
| Public client refresh token | same | 2 weeks |
| Confidential client session | may be unlimited | 2 years |
| Confidential refresh token | up to 180 days | 3 months |
| Silent sign-in (no approval screen) | the server *may* allow it for a **confidential** client the user already approved | not measured |

So a public client means **a real re-approval at least every two weeks**. The
browser SDK does not do silent re-auth: `initRestore` restores or throws.

### 5.2 The parts every option shares

1. **Client metadata** at `https://<host>/oauth/client-metadata.json`. The
   `client_id` field must equal that exact URL. Fields: `client_name:
   "Caribou"`, `client_uri`, `redirect_uris: ["https://<host>/signin/bluesky"]`,
   `scope: "atproto transition:generic"`, `grant_types: ["authorization_code",
   "refresh_token"]`, `response_types: ["code"]`, `application_type: "web"`,
   `dpop_bound_access_tokens: true`, and the auth method of the option chosen.
   The host comes from `PUBLIC_BASE_URL`. The health check fails if the served
   `client_id` does not equal the URL it is served from.
2. **A handle resolver** on Caribou's host. A browser cannot read DNS TXT
   records. The SDK's `handleResolver` option takes the URL of a service that
   answers `com.atproto.identity.resolveHandle`. So Caribou serves
   `GET /xrpc/com.atproto.identity.resolveHandle?handle=` and passes its own
   origin as `handleResolver`. The server tries DNS `_atproto.<handle>` and
   `https://<handle>/.well-known/atproto-did`; DNS wins if they differ. This
   keeps the *handle lookup* off a third-party resolver. The next step,
   DID → DID document, still goes from the browser to `plc.directory` (for
   `did:plc`) and then to the PDS. Section 10 has the SSRF guard.

### 5.3 The options

The atproto OAuth guide ("Types of App") names a browser app and three backend
patterns. We compare them on what Caribou cares about.

**A. Public browser client.** `@atproto/oauth-client-browser` runs the flow in
the browser. It makes a non-extractable DPoP key, keeps the session in
IndexedDB, refreshes on its own, and restores a session by DID.

- Session: 2 weeks on `bsky.social`, then a full re-approval.
- Server work: the shared parts in 5.2 only.
- Credentials: in the browser. A script running in the page (XSS) can make
  requests with them while the page is open. It cannot copy the DPoP key out,
  so it cannot use the tokens elsewhere. (Today's Mastodon token in
  localStorage *can* be copied out.)
- SDK: supported. Local dev uses the loopback client (`client_id`
  `http://localhost`): refresh is short (about a day) and silent sign-in is not
  allowed.

**B. Backend-for-frontend (BFF), confidential.** `@atproto/oauth-client-node`
on Caribou's server is the OAuth client. Tokens and DPoP keys stay on the
server; the browser gets a session cookie. The atproto guide calls this the
recommended confidential pattern.

- Session: 2 years on `bsky.social`; refresh tokens 3 months.
- Server work: large. Every Bluesky call goes through Caribou's server, because
  the DPoP key the tokens are bound to lives there. The server stores every
  reader's session and the client signing key; `/data` becomes sensitive; key
  rotation is our job.
- Credentials: never in browser JavaScript. XSS can still act through the
  cookie while the page is open, but nothing can be carried away.
- SDK: supported.

**C. Token-mediating backend (TMB), confidential.** The backend is the OAuth
client and hands access tokens to the browser, which calls the PDS directly.

- With DPoP, the browser needs the session's DPoP private key to use those
  tokens. So the key must be extractable and sent to the browser. That gives up
  the "cannot copy the key out" property of A.
- No SDK support. We drop this option.

**D. Client-assertion backend, confidential.** A Bluesky proposal (0010). The
browser holds the DPoP key and the tokens, as in A. When the browser needs a
token (PAR, code swap, refresh), it asks Caribou's server for a client
assertion: a short JWT signed with Caribou's client key and bound to the
browser's DPoP key thumbprint. The PDS then treats the session as
confidential.

- Session: confidential lifetimes on `bsky.social`, if the provider accepts it
  as such. The provider verifies `private_key_jwt` assertions today
  (`oauth-provider/src/client/client.ts`). We found no check of the proposal's
  DPoP binding there, so the binding is not enforced yet.
- Server work: small. One POST endpoint that checks a DPoP proof and returns
  an assertion, plus the public key in `jwks`. No data proxying, no token
  storage.
- Credentials: as A.
- SDK: **no hook** in `oauth-client-browser` (`keyset: undefined`). We would
  wrap or patch the SDK, or wait for upstream.
- Abuse: anyone can ask our endpoint for an assertion for a DPoP key they
  hold. A DPoP proof shows that they hold the key. It does not show which
  account will approve the sign-in later. So the endpoint must not be read as
  an identity check. It needs CORS to our origin, `no-store`, a nonce and a
  rate limit, and it limits harm only through the DPoP binding.
- **Release gate for D.** The proposal requires the authorization server to
  compare the assertion's `cnf.jkt` with the request's DPoP key. D ships only
  when a test shows `bsky.social` **rejects** an assertion bound to a
  different key, on PAR, the code swap and refresh. A provider that accepts
  the mismatch counts as "not supported", even if it grants long sessions.

| | A public | B BFF | D client-assertion |
|---|---|---|---|
| Re-approval | every 2 weeks | rare | rare (if accepted) |
| Caribou proxies data | no | **yes, all of it** | no |
| Server stores sessions | no | yes | no |
| Upstream credentials in browser JS | yes (non-extractable key) | no | yes (non-extractable key) |
| SDK support today | yes | yes | no |
| Fits v1 "server does exactly three things" | yes | no | yes, with one more small endpoint |
| Work | 5.2 only | L+ (proxy for ~60 client methods, session store, key ops) | M (endpoint, SDK wrap, tests) |

### 5.4 Decision

**A for the first release. D as the upgrade.** B is the most secure. But it
puts Caribou's server in the path of every Bluesky request, and it makes a
second architecture next to Mastodon's browser-direct one. D gives most of B's
lifetime gain without that, once the SDK supports it or we accept a small wrap.

What changed from round 1: round 1 said silent re-auth would soften the
two-week cap. It will not. The browser SDK has no silent re-auth, and the spec
allows silent sign-in only for confidential clients. So the expiry flow (5.6)
must be good on its own, and D is now a named plan (#201). Round 1 also
said a browser-plus-server client is not a pattern the spec describes; the
guide does describe TMB and the client-assertion backend.

### 5.5 Flow (option A)

1. The landing page and the `/?add` form get two panels: **Mastodon** (a
   server) and **Bluesky** (a handle, a DID or a PDS host). We do not guess:
   `alice.example.com` can be a Mastodon server or a Bluesky handle. The panels
   are a real tablist with arrow-key selection, not the link-based
   `caribou-tabs` (which navigates).
2. The browser loads the Bluesky client chunk and calls `client.signIn(input)`.
   The SDK resolves the identity (through our resolver), finds the
   authorization server, sends PAR with PKCE and DPoP, and redirects.
3. The PDS's authorization page asks the reader to approve.
4. The PDS redirects to `/signin/bluesky#code=...&state=...&iss=...`. The code
   is in the **fragment** (the SDK default), so it never reaches our server or
   its logs. The page renders a shell only. The response has `Cache-Control:
   no-store` and `Referrer-Policy: no-referrer`, like today's sign-in complete
   page. `client.init()` swaps the code, checks `sub`, and stores the session.
   The page then removes the fragment with `history.replaceState`.
5. Caribou adds a `UserSession` (5.6) and calls `getProfile` for the account.
6. The page goes to `/home`.

Tests drive the SDK through a real callback against a fixture authorization
server. A test that only inserts a session would pass with the code swap or the
`sub` check broken.

### 5.6 Session shape and the multi-account model (#58)

Today (`packages/state/src/users.ts`) a session has `userKey`, `server`,
`token`, `vapidKey`, `account` and `createdAt`. The token doubles as the
session's identity: `removeSession(userKey, token)` refuses when the stored
token differs, so a 401 from an older token cannot remove the session that
replaced it.

Proposed:

```ts
type UserSession = MastodonSession | BlueskySession

interface SessionBase {
  userKey: UserKey
  // A random id made at each sign-in. It names this sign-in, not a token.
  // The stale-failure guard compares it, for both networks.
  generation: string
  account: Account | null
  createdAt: number
  // Set when the network says the credentials are gone. The session stays,
  // with its prefs and drafts, until the reader signs in again or removes it.
  expired?: true
}

interface MastodonSession extends SessionBase {
  network?: 'mastodon'    // absent on entries stored before this change
  server: string
  token: string
  vapidKey: string
}

interface BlueskySession extends SessionBase {
  network: 'bluesky'
  did: string
  handle: string          // for display; refreshed from getProfile
  pds: string             // from the DID document; can change
  // No token here. The SDK keeps it in IndexedDB under the DID.
}
```

`loadFromStorage` fills a missing `generation` from the token (Mastodon), so
stored sessions keep their guard.

**UserKey** for Bluesky is `<did>@bsky`, for example `did:plc:abc123@bsky`.
The DID never changes. `isUserKey` splits on `@` and wants two parts; a DID
has no `@`, so this passes unchanged. Prefs and drafts keyed by `userKey` keep
working.

**`activeClient` stays synchronous.** It is a `computed` that every consumer
reads at once. For Bluesky it returns a client object at once. The client
holds one promise for `oauthClient.restore(did)`, and every method awaits it. A
`sessionReady` signal lets screens show the splash until it settles. The
Bluesky client chunk is loaded with a dynamic `import()` the first time a
Bluesky session is active.

**Errors are sorted, not lumped.**

| what happened | what Caribou does |
|---|---|
| The SDK says the session is gone (refresh refused, token revoked, `deleted` event) | Mark the session `expired`. Keep prefs, drafts and the page. Show a banner: "Your Bluesky session ended. Sign in again." Signing in with the same DID clears `expired` and makes a new `generation`. |
| Network error, timeout, 5xx | No session change. The request fails like any other, with retry. |
| IndexedDB unavailable (some private windows) | The sign-in panel says Bluesky sign-in needs site storage. No session is added. |

The existing `caribou:unauthorized` path (`components/_unauthorized.ts`) drops
the session, its prefs and **its drafts**, then switches account. That fits a
Mastodon token the reader revoked. It is wrong for an expiry that comes every
two weeks. So Bluesky never sends that event. It sends
`caribou:session-expired { userKey, generation }`. Whether Mastodon should move
to the expired state too is a separate issue.

**Sign-out** of a Bluesky account calls `session.signOut()` (which revokes at
the PDS) and then removes the session, comparing `generation`. The Mastodon
`/api/signout` route is not used.

**The account switcher** lists both kinds. Each row has the network in its
accessible name ("alice.example.social, Bluesky"), not only an icon: the shared
`caribou-icon` is hidden from assistive technology on purpose, and
`alice@example.social` and `alice.example.social` look alike. A switch still
reloads the page (#58). `pathAfterSwitch` changes:

- `/local` and `/public` go to `/home` when the new account is Bluesky.
- A Bluesky profile or post path is kept. A DID and an AT URI are global.

Tests: expiry keeps drafts and location; an old expiry event after re-sign-in
is ignored (`generation`); a network error changes nothing; with a Mastodon
account also signed in, the Mastodon session survives all of these.

---

## 6. The layer between screens and clients

### 6.1 Where Caribou is today

Every network call goes through one interface, `CaribouClient`
(`packages/mastodon-client/src/create-client.ts`): about 60 methods. Stores in
`packages/state` call only that interface.

The types are another matter. The code names `mastodon.v1.Status` about 190
times, `Account` 85, `Relationship` about 60, `List` about 40, `Notification`
about 30. About 46 non-test files (85 with tests) import from `masto` or the
client package. The state package is about 3,200 lines. The client package
exports aliases (`Status`, `Account`, …), but most code names `mastodon.v1.*`.

Store mutations already take the whole status or account
(`toggleFavourite(status)`, `toggleFollow(account)`). The id-only boundary is
the **client interface**: `favourite(statusId: string)`,
`follow(accountId: string)`.

### 6.2 The two options

**(a) Caribou-owned types with Mastodon's field names (decided).** The
client package defines `Status`, `Account`, `Relationship`, `Notification`,
`List`, page results and write inputs as Caribou types. They keep Mastodon's
field names, so a screen that reads `status.favouritesCount` keeps working.
Each type gets an optional `bluesky` field for what Mastodon has no place for.
The types are recursive: `Status.account` is a Caribou `Account`,
`Status.reblog` a Caribou `Status`. A new package,
`@beatzball/caribou-bluesky-client`, maps Bluesky views into them.

**(b) A neutral model with new field names.** `Post`, `Profile`, `Relation`,
`Notice`, `Feed`, named for both networks. Every screen, store, fixture and
SSR serializer moves to the new names.

### 6.3 The seams both options need

Round 1 said option (a) was "mostly adapter work". It is not. The review found
places where the state layer itself assumes Mastodon. These need the same work
under (a) or (b):

1. **Owned recursive types** (above), and client method signatures that name
   them instead of `mastodon.v1.*`.
2. **Client write methods take a ref, not an id.**
   `favourite(ref: StatusRef)` where `StatusRef = { id, bluesky? }`. Bluesky
   needs the post's URI and CID to like it, and the like record's URI to undo.
   Blast radius: the interface, the Mastodon client, and every client mock in
   tests.
3. **Mutation results commit record refs.** Today `toggle` copies back only
   the flag and the count (`mutations.ts`). For Bluesky it must also copy
   `bluesky.likeUri` / `repostUri` from the result, or the next undo has
   nothing to delete. Rollback restores them too.
4. **Viewer state has an owner.** `mergeStatus` (`caches.ts`) keeps old reader
   flags when a token-less copy arrives. Bluesky viewer fields (`likeUri`,
   `repostUri`, `bookmarked`, `replyDisabled`, `embeddingDisabled`) join that
   protected set, and each cached entry records `viewerOf: UserKey | null`. A
   public copy never overwrites viewer fields.

   **Owner copies win only when they are fresh.** Being the owner does not make
   a copy new: a refetch can start before a like and land after it, and the
   AppView can lag behind a write. So each action keeps its flag and its record
   ref together as one **viewer slot** (`like`: `favourited` + `likeUri`;
   `repost`: `reblogged` + `repostUri`; `bookmark`: `bookmarked`), and each
   slot has a local write sequence number. Every owner fetch records the
   sequence number at the time it **started**. The merge rule for each slot:

   - A slot with a write in flight is never overwritten. Rollback or commit
     decides it.
   - A fetch that started before the slot's last write finished does not
     overwrite that slot.
   - For 60 seconds after a write, a fetch that disagrees with it does not
     overwrite the slot (AppView lag). After that, the fresh fetch wins.
   - Otherwise the owner's copy wins, also over an SSR copy whose flags are
     `false`. That is how an SSR entry gets its viewer state.

   Slots are separate, so a like in flight does not block a repost result.
   Tests: refetch starts → like succeeds → old refetch lands → the like and
   its `likeUri` stay → undo deletes the right record; the same for unlike and
   for repost and un-repost; a like and a repost at the same time; a fetch
   that lags the AppView inside and after the 60 s window; signed-out SSR →
   owner refetch fills the slots.
5. **Paging carries an opaque cursor everywhere.** `fetchAccountStatuses`
   returns `Status[]`, and `createProfileStore.loadMore()` sends the last
   status id. Bluesky's `getAuthorFeed` takes an opaque `cursor` that is not a
   post id. So profile pages return a page with `nextCursor`, the store keeps
   it, and SSR hands the first cursor to the client. Timelines already carry
   `nextMaxId`; it is renamed `nextCursor` and treated as opaque.
6. **Feed order is not id order.** `timeline-store.ts` sorts the new-posts
   buffer with `newerFirst`, which compares Mastodon numeric ids. AT URIs sort
   by DID, so the buffer would come out by author. The store gets its order
   from the client: Mastodon keeps `newerFirst`; Bluesky keeps the order the
   feed returned. Tests: many authors, a repost of an old post, and two polls
   whose results overlap; the merged buffer keeps feed order with no
   duplicates.
7. **Polling catch-up without `since_id`.** Bluesky's `getTimeline` has no
   `since_id`. The adapter pages from the top until it meets the known top
   entry, at most 3 pages (about 150 entries). If it does not meet it (more
   posts than that, or the entry left the feed), the banner says "Many new
   posts" and applying it replaces the list instead of merging.
8. **Feed-entry identity.** A repost wrapper's id is `reason.uri` when present.
   The lexicon makes it optional, so the fallback is
   `repost:<by.did>:<post.uri>:<reason.indexedAt>`. It never equals the
   subject post's id or the reader's own repost record URI. A test fixture has
   a valid `reasonRepost` with no `uri`.

Two more seams belong to features, not types:

9. **Resource provenance.** Each cached post and account records its
   `network`. Components ask "can the active account act on *this*
   resource?", not "is there an active client?" (section 11).
10. **Moderation is kept per surface** (section 7.4), not flattened.

### 6.4 Cost, compared again

| | (a) owned types, Mastodon names | (b) neutral model |
|---|---|---|
| Seams 1–10 | needed | needed |
| Renaming fields in ~46 files, fixtures and SSR serializers | no | yes |
| New risk for Mastodon | from the seams | from the seams and every rename |
| Can be staged | yes | yes (alias first, one type at a time) |
| Honest fit for Bluesky | some fields always empty (`editedAt`, `poll`); the `bluesky` field carries the rest | good |
| Size of phase 1 | about 5–6 weeks (section 13) | about 8–10 weeks |

What changed from round 1: round 1 said (b) must land in one go and (a) needs
almost nothing. Both were wrong. (b) can be staged, and (a) needs real state
work. The gap is the renaming, about 3–4 weeks. Moving from (a) to (b) later is
also not "a change to the aliases": every consumer that reads a renamed field
changes then. We chose (a). The renames buy Bluesky nothing on day
one; the seams are what make Bluesky correct. Decision 2 in 12.3.

### 6.5 Mapping (option a)

| Caribou `Status` field | from Bluesky |
|---|---|
| `id` | the AT URI (opaque outside the route adapter) |
| `uri`, `url` | AT URI; `https://bsky.app/profile/<did>/post/<rkey>` |
| `content` | HTML from `record.text` + `record.facets` (7.1) |
| `createdAt` | `record.createdAt`; `indexedAt` as a fallback |
| `account` | `author` → Account |
| `reblog` | a feed entry with `reasonRepost` becomes a wrapper (id per seam 8) |
| `inReplyToId` | `record.reply.parent.uri` |
| counts | `likeCount`, `repostCount`, `replyCount`; `quoteCount` for quotes |
| `favourited`, `reblogged`, `bookmarked` | `viewer.like != null`, `viewer.repost != null`, `viewer.bookmarked` |
| `visibility` | always `public` |
| `sensitive`, `spoilerText` | not used; moderation is separate (7.4) |
| `mediaAttachments` | `embed` images (and video, later) |
| `card` | `embed` external |
| `quote` | `embed` record / recordWithMedia, in the shape PR #167 defines |
| `poll`, `editedAt`, `emojis` | `null`, `null`, `[]` |
| `bluesky` | `{ uri, cid, likeUri, repostUri, replyRef, replyDisabled, embeddingDisabled, labels, moderation: ModerationResult (plain data, 7.4), viewerOf }` |

Account: `id` = DID, `acct` = handle, `displayName`, `note` = description
with detected links, `avatar`, `header` = banner, counts. Relationship from
`viewer.following`, `followedBy`, `muted`, `blocking`, `blockedBy`; the follow
and block record URIs go in its `bluesky` field for undo.

**`capabilities`** on each client:

```ts
interface Capabilities {
  network: 'mastodon' | 'bluesky'
  localTimeline: boolean; publicTimeline: boolean
  visibility: boolean; contentWarningText: boolean
  polls: boolean; edit: boolean; customEmoji: boolean
  followTags: boolean; privateLists: boolean; serverFilters: boolean
  maxChars: number             // graphemes; Mastodon reads it from the server
  maxBytes: number | null      // 3000 for Bluesky
  maxImages: number
  maxImageBytes: number | null // 2_000_000 for Bluesky
}
```

Grapheme counting already exists (`components/_compose-text.ts`, with
`Intl.Segmenter`), so no "count by" switch is needed. Capabilities describe a
**network**. A post's own restrictions (`replyDisabled`, `embeddingDisabled`)
are on the post.

### 6.6 What changes in existing code

| place | change |
|---|---|
| `packages/mastodon-client/src/index.ts`, `create-client.ts` | Owned types; `capabilities`; write methods take refs; page results with `nextCursor`. |
| new `packages/bluesky-client` | Bluesky `CaribouClient`, mappers, facet renderer, embeds, moderation wrapper. Server-safe modules (mappers, renderer) import nothing browser-only. |
| `packages/auth/src/user-key.ts` | `toBlueskyUserKey(did)`, `networkOf(userKey)`. Format unchanged. |
| `packages/state/src/users.ts` | Session union, `generation`, `expired`; `removeSession` compares `generation`; `dropSession` not called on expiry; sync `activeClient` with a restore promise. |
| `components/_unauthorized.ts` | Compares `generation`. New `caribou:session-expired` handler. |
| `packages/state/src/mutations.ts`, `relationships.ts` | Commit record refs from results (seam 3). |
| `packages/state/src/caches.ts` | `viewerOf` and protected Bluesky viewer fields in `mergeStatus` (seam 4). `olderEdit` does nothing for Bluesky. |
| `packages/state/src/profile-store.ts` | Keeps an opaque cursor; SSR handoff (seam 5). |
| `packages/state/src/timeline-store.ts` | Order from the client; catch-up rule (seams 6, 7). |
| `packages/state/src/notification-groups.ts` | Client-side grouping for Bluesky; order by `indexedAt`, not `compareNotificationIds`. |
| `packages/state/src/compose.ts` | Draft contract (7.2). |
| `packages/state/src/prefs.ts` | `DefaultTimeline` gains `following`; `local`/`public` invalid for Bluesky. |
| `components/_switch-account.ts` | Rules in 5.6; route shapes in 8.4 for `readsCookieServer`. |
| `components/_profile-path.ts` | Never add `@<host>` to a Bluesky handle; never emit a bare dotted name for a Mastodon account (8.4). |
| `components/caribou-status-card.ts` | `canAct` from the resource's network and the active account (section 11); post path from the rkey, not the encoded id; Reply/Quote off by `replyDisabled`/`embeddingDisabled` with a reason (test: a restricted post cannot open a composer that can submit); Edit and History hidden for Bluesky. |
| `components/caribou-status-media.ts` | A no-override mode: covered with the label's reason and no Show button (7.4). |
| `components/caribou-profile.ts`, `caribou-profile-header.ts`, `_shell.ts` | Read client and relationships by the profile's network; no Mastodon `server` match for a Bluesky profile. |
| `components/caribou-nav-rail.ts` | Hide Local and Public for Bluesky, and Search and Lists until phase 5. Feeds is a new item, added in phase 5. |
| `components/caribou-compose-dialog.ts` | Hide visibility, CW text and poll by capability; byte limit; image resize; alt text stays in the draft. |
| `server/lib/bluesky-public.ts` (new), `upstream-cache.ts` | SSR fetches; Bluesky TTL constants (8.1). |
| `server/routes/` | `oauth/client-metadata.json`, `xrpc/com.atproto.identity.resolveHandle`. |
| `pages/@[handle].ts`, `pages/@[handle]/[statusId].ts` | Network from the route shape (8.4). |

---

## 7. Rich text, compose, embeds and moderation

### 7.1 Facets to HTML

A Bluesky post is plain text plus facets. Facet ranges are **UTF-8 byte**
offsets, `byteStart` inclusive, `byteEnd` exclusive. JavaScript strings are
UTF-16, so `text.slice()` gives wrong ranges for emoji and non-ASCII letters.

The renderer:

1. Encode the text with `TextEncoder`.
2. Sort facets by `byteStart`. Drop a facet that overlaps the one before it or
   falls outside the text.
3. Walk the bytes. Decode each plain segment, HTML-escape it, and turn `\n`
   into `<br>`.
4. Wrap each facet segment:
   - `#link` → `<a href="<uri>" rel="nofollow noopener noreferrer"
     target="_blank">`. Only `http:` and `https:`; any other scheme renders as
     text. If the visible text looks like a URL with a **different host** than
     `uri`, render the real `uri` as the text instead. A link must not pretend
     to go somewhere else.
   - `#mention` → `<a href="/@<did>">`, from the facet's **DID**. The visible
     text is only presentation; it can be stale or misleading. The profile page
     shows the current handle.
   - `#tag` → `<a href="/tags/<tag>?net=bsky">`. The href is the same for every
     reader, so SSR and hydration agree. The page decides what to show (8.2).
   - One facet with several features: use the first link-like one.
5. Wrap the whole thing in `<p>`.

The output then goes through the **same DOMPurify config** (`PURIFY_OPTS`) as
Mastodon content, on both sides. `ALLOWED_ATTR` stays as it is (round 1's
`title` attribute is dropped; DOMPurify would strip it).

The renderer is a pure function in `packages/bluesky-client` with tests on
emoji, combining marks, overlapping and out-of-range facets, `javascript:`
links, a link whose text names another host, and a mention whose text differs
from its DID (in SSR and in the browser).

The profile description has no facets. Detect links in it with
`RichText.detectFacets` and render the same way.

### 7.2 Compose

**Facets.** Before writing, run `RichText.detectFacets` from `@atproto/api`.
It finds links, `@handle` mentions (resolved to DIDs) and `#tags`.

**Limits.** 300 graphemes **and** 3000 UTF-8 bytes (`feed.post` lexicon). The
counter shows graphemes; the submit button is off when either limit is over.
Tests use long combining sequences, not only plain emoji.

**Images.** At most 4, each at most 2 MB (`embed.images`). Compose resizes and
re-encodes an image that is too large, in the browser, before upload. Alt text
lives in the post's embed, not on the server: there is no `updateMedia`. The
draft keeps it.

**Draft contract.** Today a draft keeps `inReplyToId` and media ids. A Bluesky
draft keeps:

- `reply: { root: StrongRef, parent: StrongRef } | null`
- `quote: StrongRef | null`
- `labels: string[]` (self-labels)
- `media: { blob: BlobRef, mime, size, alt, aspectRatio }[]` — the blob ref
  from `uploadBlob`, so a reload does not re-upload. A PDS may drop an
  unreferenced blob after a while. On "blob not found", compose re-uploads from
  the file if it still has it, or asks the reader to pick it again.
- `rkey`: a TID made when the draft starts.

On reload, compose refetches the reply parent. If it is gone, the draft keeps
its text and says "The post you replied to was deleted."

**No duplicate posts.** The Mastodon draft has an idempotency key. For Bluesky
the draft's `rkey` plays that part: compose writes with
`com.atproto.repo.createRecord` and that `rkey`.

A retry cannot rely on the error. A second `createRecord` with a used `rkey`
gives no "already exists" code: the PDS does not check first, and the repo
layer throws a plain error (`There is already a value at key`, in
`packages/repo/src/mst/mst.ts`), which reaches the client as a 500. So:

1. On submit, the draft **freezes** the exact record it sends (text, facets,
   embed, labels, `createdAt`) and stores it with the `rkey` before the
   request.
2. If the response is lost or is a 5xx, compose calls
   `com.atproto.repo.getRecord(repo, app.bsky.feed.post, rkey)` on the PDS
   (not the AppView, which can lag).
3. Record found, and equal to the frozen record: the post went through. Clear
   the draft and load the post.
4. Record found, but the reader edited the draft since: keep the edits, make
   a new `rkey` for them, and say "Your earlier version was posted." with a
   link.
5. Record not found: retry the same frozen record with the same `rkey`.

Tests: lost response → reload → retry finds the record; lost response → edit
→ retry keeps the edits; record not found → retry posts once.

**Link cards** are phase 6. Phase 4 posts links without a card.

### 7.3 Embeds

| `embed.$type` (view) | renders as |
|---|---|
| `app.bsky.embed.images#view` | media of type `image`: `fullsize`, `thumb`, `alt`, `aspectRatio`. Up to 4. |
| `app.bsky.embed.video#view` | phases 2–5: the thumbnail with a play mark that links to bsky.app. Phase 6: HLS playback (`playlist` is `.m3u8`; Safari plays it natively, others need `hls.js`). |
| `app.bsky.embed.external#view` | `card`: title, description, thumb, uri, through `caribou-status-link-card`. A Tenor GIF is an external embed. |
| `app.bsky.embed.record#view` | a quote, in PR #167's quote card. The inner record can be a post, or a not-found, blocked or detached stub ("Post not found", "Blocked", "Removed by author"). A feed, list, starter pack or labeler renders as a small card linking to bsky.app. |
| `app.bsky.embed.recordWithMedia#view` | a quote plus media. |

An unknown `$type` renders a small "Not supported here — open on bsky.app"
card. It never throws.

### 7.4 Labels and moderation

Mastodon has a free-text content warning the author writes. Bluesky has none.
It has **labels**: self-labels on media (`sexual`, `nudity`, `porn`,
`graphic-media`), labels from labelers, and `!no-unauthenticated` (8.3).

**Inputs.** The SDK's `moderatePost` and `moderateProfile` take
`ModerationOpts`: the reader's DID, their prefs (adult content, per-label
choices, subscribed labelers, from `app.bsky.actor.getPreferences`), and
`labelDefs`, the definitions of each labeler's custom labels. Without a
definition the SDK skips the label. So Caribou also fetches
`app.bsky.labeler.getServices?dids=<subscribed>&detailed=true`, interprets the
definitions, and caches them per account (refresh every hour and on a prefs
change). Every AppView call sends `atproto-accept-labelers` so the AppView
returns those labels.

**Failure policy: fail closed.** If the definitions for a subscribed labeler
cannot load, a label from that labeler covers the post with "Content warning
(labeler unavailable)" and a Retry. It does not show the post as clean.

**Keep the result, per surface, as plain data.** The SDK returns a
`ModerationDecision`, a class instance with a `ui(context)` method. It must not
go into page data: Litro hands `serverData` to the client as JSON, and JSON
drops the method, so the client would get a decision that cannot answer
`ui()`. Instead the mapper turns the decision into plain data right away:

```ts
interface ModerationResult {
  // One entry per context below; each is the SDK's ui(context), flattened.
  contexts: Record<ModerationContext, {
    filter: boolean; blur: boolean; alert: boolean; inform: boolean
    noOverride: boolean
    reasons: { label: string; source: string; name: string }[]
  }>
  // The labelers whose labels this post's data includes (see the veil).
  labelersCovered: string[]
}
```

The post also keeps its raw `labels`, so the client can run moderation again
when prefs or subscriptions change. The class instance never leaves the
mapper. Test: serialized page data → first client render, for a labeled post,
a labeled profile and a labeled quote, with one `noOverride` label. A test
that renders straight from the SDK instance would miss the bug.

The contexts:

| context | where | what it can do |
|---|---|---|
| `contentList` | feeds, profile lists, notifications | filter out, or cover with a reason |
| `contentView` | the focused post in a thread | cover with a reason; never silently drop the post the reader opened |
| `contentMedia` | images, video, cards | blur media |
| `avatar`, `banner` | avatars and headers | blur |
| `profileList`, `profileView` | account rows, profile page | cover or warn |

Each `ui()` has `noOverride`. When it is set, the cover has **no Show
button**. Today `caribou-status-media` always offers "Show sensitive media"; it
gets a no-override mode. The author's own post is still covered, but it is
never filtered out and always has a Show button: the SDK skips `filters` and
`noOverride` for the author, not the blur.

**Hydration and the veil.** The server does not know the reader. SSR runs
moderation with the **logged-out defaults** (adult content off, Bluesky's
labeler only). For a signed-out reader that is final. For a signed-in reader,
their settings can be **stricter** than the defaults (another labeler, "hide"
on a label), so the SSR paint could show what they chose to hide. Caribou
already solves this for Mastodon filters with the reader veil
(`server/lib/reader-veil-head.ts`, `readerChecks` in `reader-view.ts`): cards
stay hidden from first paint until the reader's check settles. Bluesky cards
join it.

Loading the reader's prefs and label definitions is **not enough** to settle.
The SSR data was fetched with Bluesky's labeler only, so a label from a
labeler the reader subscribes to is simply not on that post. The SDK judges
only the labels it is given. So a Bluesky card's check settles only when all
of these hold:

1. The reader's prefs and label definitions are loaded.
2. The post came from a **reader fetch** sent with `atproto-accept-labelers`
   set to the reader's subscribed labelers.
3. The post's `labelersCovered` includes every labeler the reader subscribes
   to.
4. Moderation ran on that data.

This is the same rule as the Mastodon veil: it waits for the post as the
reader's server returns it. If the reader fetch fails, or comes back without
a subscribed labeler, the card stays covered with Retry. If the reader
subscribes to a new labeler later, `labelersCovered` no longer matches, and
the card is covered again until a refetch.

With a Mastodon account active, a Bluesky post's check is the logged-out
default, and it settles at once.

**Compose.** The CW toggle becomes a "Label this media" menu (Adult, Nudity,
Graphic) for Bluesky. It uses the shared button and menu and their focus rules.
Free-text CW is hidden.

**Tests:** a custom label absent from the SDK's built-in table, with and
without its definition loading; a `noOverride` label; the author's own
labeled post (covered, with Show); a "hide" pref that the SSR defaults do not
have, checked through the veil; the veil gap: SSR data with no custom label,
prefs and definitions load first, the reader fetch arrives late with a custom
"hide" label, and the post is never visible in between or when that fetch
fails; list versus focused-thread behavior; a labeled avatar.

---

## 8. SSR and the hydration rule

### 8.1 The rule

The server render must equal the first client render (`apps/caribou/README.md`).
SSR pages fetch public data with no token and hand it to the page as
`serverData`. Reader state comes after hydration.

Bluesky follows the same rule with `server/lib/bluesky-public.ts`, calling
`https://public.api.bsky.app/xrpc/` through `upstream-cache.ts`. That cache
uses fixed TTLs per kind; it does not read `cache-control`. We add Bluesky
constants of 30 seconds, matching the AppView's `max-age`. The server runs the
same mappers, facet renderer and `sanitize` as the browser.

### 8.2 What renders on the server

| page | SSR without a token | note |
|---|---|---|
| Profile `/@alice.example.com` | yes: `getProfile` + `getAuthorFeed` | first cursor handed to the client |
| Thread `/@alice.example.com/<rkey>` | yes: `getPostThread` | |
| A custom feed, a list feed (phase 5) | yes: `getFeed`, `getListFeed` | |
| People search (phase 5) | could: `searchActors` is public | rendered on the client, with the rest of search |
| Hashtag `/tags/<tag>?net=bsky` | **no**: it needs `searchPosts`, which answers 403 | Shell only. With a Bluesky account active, the client searches. Otherwise the page says "Sign in with Bluesky to see posts with this tag" and links to `bsky.app/hashtag/<tag>`. |
| Post search | no | 403 |
| Following, notifications, bookmarks | no | need a token |

Viewer fields are empty in SSR data. After hydration, the active Bluesky
account refetches the same items and merges them with `viewerOf` set (seam 4).

### 8.3 `!no-unauthenticated`

An account with this self-label asked that logged-out viewers not see it. If
the public AppView still returns its data (phase 0 checks), Caribou must not
show it signed out:

- SSR never renders that account's profile or posts. The profile renders the
  shell with "This account asked to be seen only by signed-in readers."
- In a thread, such a post renders as that notice; the rest renders.
- With a Bluesky account active, the client renders it normally.
- With only a Mastodon account active, it stays hidden: the reader is not
  signed in to Bluesky.

The SSR test asserts the notice **and** that the account's display name,
handle text and post text appear nowhere in the HTML.

### 8.4 Telling the networks apart in a route

Mastodon's rule for **local** usernames is `[a-z0-9_]+`: no dot. Remote
usernames may have dots and hyphens (3.2), for example accounts from Pleroma,
Misskey or a Bluesky bridge.

Route rules, checked in this order:

1. `/@name@host` (a second `@`): Mastodon, remote account. Checked first.
2. `/@did:...`: Bluesky, by DID.
3. `/@name` with a dot: **Bluesky** handle.
4. `/@name` with no dot: Mastodon, local to the cookie's server.
5. `/@<handle or did>/<id>`: a Bluesky post when rule 2 or 3 matched. We do
   not tell posts apart by the id's shape. Caribou already supports encoded
   non-numeric ActivityPub ids, and a post rkey is normally a 13-character TID
   but may be other characters.

**The edge case.** `profilePath` (`components/_profile-path.ts`) builds a bare
`/@name` when it knows no host. For a remote Mastodon account with a dot in its
name, that path now means a Bluesky handle and lands on the wrong page. Caribou
almost always knows the host, so this is rare. The fix is in `profilePath`:
when there is no host, take it from the account's `url`, and never emit a bare
dotted name for a Mastodon account. Tests cover the precedence and this case.

**Links Caribou builds** for Bluesky use the author's handle when the AppView
gives a valid one, and the DID when the handle is `handle.invalid`. Mentions
use the DID (7.1). A handle link can break or point at someone else after a
handle change; the DID link cannot. So "Copy link" copies the DID form
(`https://bsky.app/profile/<did>/post/<rkey>`). A page opened by DID replaces
the address bar with the handle form **after hydration**, in `firstUpdated`,
never in `render`.

**Dev server.** In `litro dev`, Vite's middleware may treat a last path segment
with a dot as a file. Production is fine (Nitro serves only files that exist).
Phase 0 checks dev.

---

## 9. Feature map

| Mastodon feature | Bluesky | day one? |
|---|---|---|
| Home timeline | Following feed, `app.bsky.feed.getTimeline` | yes |
| Local timeline | not available | — hidden |
| Public (federated) timeline | not available. Closest: a feed like "Discover" | — hidden |
| Custom feeds | `getFeed`; pinned feeds from prefs (`savedFeedsPrefV2`) | phase 5 |
| Post view and thread | `getPostThread` | yes |
| Reply | post with `reply: { root, parent }` (strong refs) | yes |
| Reply turned off by the author | `viewer.replyDisabled`; Reply is off with "The author limited replies" | yes |
| Create a reply limit | thread gate record | phase 6 |
| Favourite | like record; undo deletes it | yes |
| Boost | repost record; undo deletes it | yes |
| Quote | post with `embed.record` / `recordWithMedia` | yes (needs PR #167) |
| Quote turned off by the author | `viewer.embeddingDisabled`; Quote is off with a reason | yes |
| Create a quote limit | post gate record | phase 6 |
| Bookmark | `app.bsky.bookmark.createBookmark` / `deleteBookmark` / `getBookmarks`; private | yes |
| Follow | follow record. Public. | yes |
| Follow request | not available; every account is open | — |
| Follow a hashtag | not available | — hidden |
| Hashtag timeline | `searchPosts` with `tag`, `sort=latest`; token needed | phase 5 |
| Lists | curate lists + list item records. **Public.** Members need not be followed. `getListFeed`. | phase 5, hidden until then |
| Moderation lists | `modlist` | non-goal |
| Notifications | `listNotifications`; unknown reasons skipped | yes |
| Unread badge | `getUnreadCount` and `updateSeen`, two new client methods | yes |
| Grouped notifications | not on the server; grouped on the client | yes |
| Search people | `searchActors`, public, no token | phase 5, hidden until then |
| Search posts | `searchPosts`, token needed | phase 5 |
| Polls | not available | — hidden |
| Content warning text | not available; labels (7.4) | — label menu |
| Sensitive media | self-labels | yes |
| Visibility | not available; every post is public | — hidden |
| Edit, edit history | not available | — hidden |
| Delete; delete and redraft | `deleteRecord`; then compose with the text | yes |
| Pin a post | profile `pinnedPost` | later |
| Image upload | `uploadBlob` (2 MB each), `embed.images`, alt in the record | yes |
| Video upload | video service | phase 6 |
| Custom emoji | not available | — |
| DMs | `chat.bsky` | non-goal |
| Mute | `muteActor`; private | yes |
| Block | block record; **public** | yes |
| Mutes and blocks in settings | `getMutes`, `getBlocks` | yes |
| Keyword filters | muted words (`mutedWordsPref`), applied by the client | phase 6 |
| Report | `com.atproto.moderation.createReport` | later |
| Push, streaming | not for third-party clients | — polling |

Two privacy notes in the UI: the create-list dialog says lists are public; the
block confirm says blocks are public.

---

## 10. Security

- **CSP.** Caribou's pages send **no** Content-Security-Policy today
  (`theme-head.ts`, `root-forward-head.ts`, README). Only the Mastodon sign-in
  complete page has one. The v1 spec's 12.2 CSP is still open work. When it
  lands, it must allow the PDS hosts (any host), `public.api.bsky.app`,
  `api.bsky.app`, `video.bsky.app` and `cdn.bsky.app`. Nothing in this spec
  relies on a CSP until then.
- **Handle resolver (SSRF).** Our server fetches
  `https://<handle>/.well-known/atproto-did` on a host the reader picks.
  - Valid handle syntax only; HTTPS on port 443 only.
  - Bind the check to the connection: resolve the host, refuse private,
    loopback, link-local and other special addresses (IPv4 and IPv6), and
    connect to **that vetted address** with the original host name for TLS.
    Do not resolve twice.
  - Each redirect (at most 3) goes through the same check.
  - 3 s total, 2 KB body, a cap on concurrent lookups and a rate limit per IP.
  - Answer only a DID. Cache answers under 10 minutes.
  - Test with a resolver whose answer changes between the check and the
    connection, and with a redirect to a private address.
- **Client metadata.** Static JSON; `client_id` must equal the URL; health
  check (5.2).
- **Tokens.** IndexedDB, keyed by DID; DPoP key non-extractable (5.3).
- **`sub` check.** The SDK does it. The test uses a fixture whose DID resolves
  to a PDS that is **not** the issuer, and asserts that sign-in fails and no
  session is stored.
- **Rendering.** Facet HTML is built by escaping, then DOMPurify runs. Only
  `http`/`https` links; mentions by DID (7.1).
- **Moderation.** The SDK's functions with label definitions; fail closed
  (7.4).
- **Callback.** Code in the fragment; `no-store`; `no-referrer` (5.5).

---

## 11. Mixed accounts

A reader can have both kinds signed in, side by side. One is active at a time.

**Every resource knows its network** (seam 9). A component decides "can I act
here?" from the resource's network and the active account's network, not from
"is there a client". Today `caribou-status-card` sets `canAct` when a client
exists and the page names no other instance. A Bluesky card has no instance, so
without this change a Mastodon reader would get live buttons on a Bluesky post
that call the Mastodon client. The same goes for relationships in
`caribou-profile-header`, paging in `caribou-profile`, and the server match in
`_shell.ts`.

| active account → resource | read | actions | client used for reads |
|---|---|---|---|
| Mastodon → Mastodon | yes | yes (same server, as today) | active client |
| Bluesky → Bluesky | yes | yes | active client |
| Mastodon → Bluesky | yes | none; "Sign in with a Bluesky account to reply" | a token-free Bluesky read client (public AppView) |
| Bluesky → Mastodon | yes | none; "Sign in with a Mastodon account to reply" | token-free Mastodon reads from the post's server |
| signed out → either | yes | none | token-free read client |

`canAct` is reader state, so it is set after the first render, as today. The
first render uses only route-derived data.

| part | Mastodon active | Bluesky active |
|---|---|---|
| Nav rail | as today | Home (Following), Notifications, Bookmarks. Search and Lists from phase 5; Feeds, a new item, in phase 5. |
| Home | Mastodon home | Following feed |
| Compose | as today | 300 graphemes / 3000 bytes, 4 images, no visibility, no poll, label menu |
| Account switcher | both kinds, network in each accessible name | same |
| Settings → Account | Mastodon details | handle, DID, PDS host, sign out |

**"Act as another account" (#131).** The picker lists only accounts on the
post's network. Between Bluesky accounts there is no "resolve the post on the
other server" step: an AT URI is the same for every account. The #131 cache
rule holds: the other account's like must not set `favourited` in the current
account's view. `viewerOf` (seam 4) is how.

**The status cache** holds both kinds. A Mastodon id and an AT URI never
collide. A switch reloads the page (#58).

**Tests** cover all five rows above, signed out included. They assert the
request's destination host and the links built, not only disabled buttons.

---

## 12. Risks, unknowns, decisions

### 12.1 Risks

| risk | how we handle it |
|---|---|
| The atproto libraries are large. | Phase 0 measures. A dynamic `import()` only when a Bluesky account is active or a Bluesky page opens. Mastodon-only readers pay nothing. |
| The two-week re-approval annoys readers. | Expiry keeps drafts, prefs and the page (5.6). Option D (5.3) is the upgrade. |
| Moderation done wrong shows harmful media. | SDK functions, label definitions, fail closed, the veil, `noOverride` (7.4). |
| `!no-unauthenticated` ignored in SSR. | Test that the content is absent (8.3). |
| A Mastodon-active reader gets live buttons on a Bluesky post. | Resource provenance (section 11) and the five-row test. |
| Feed order or paging breaks only after page 2 or after a poll. | Seams 5–8; tests with three pages, cursors unrelated to ids, many authors, a repost of an old post, a gap larger than a page. |
| One AppView, run by one company. | The AppView URLs are config (`BLUESKY_APPVIEW`, `BLUESKY_PUBLIC_APPVIEW`). |
| The public AppView rate-limits our server (all signed-out SSR comes from one IP). | 30 s cache; on 429, fall back to client render. The limit is not documented. |
| Lexicons change. | Unknown `$type`s and notification reasons render a fallback or are skipped. Never throw. |
| `transition:generic` goes away. | Move to granular scopes when `bsky.social` advertises them. The scope lives in the client metadata only. |
| The quote work (PR #167) slips. | Day one waits for it, or ships quotes as a link card. |

### 12.2 Unknowns to settle in phase 0

- The gzipped size of `@atproto/api` + `@atproto/oauth-client-browser` in a lazy
  chunk.
- Whether the browser SDK works with Vite and Lit SSR without patches.
- Whether the public AppView returns `!no-unauthenticated` accounts' posts.
- Whether `litro dev` serves `/@alice.example.com` as a route.
- The public AppView's rate limit per IP.
- Whether `bsky.social` grants confidential lifetimes to an option-D client, and whether it rejects an assertion bound to another DPoP key (the release gate in 5.3; a
  small manual test with a hand-made assertion).

**Phase 0 results (2026-11-05, #170).** The spike code is on the branch
`spike-bluesky-170-code`. It is for reference only and is not merged.

| unknown | answer |
|---|---|
| Lazy chunk size | **181.6 KB gzipped** (942.9 KB minified, 145.8 KB brotli). This is over the 100 KB line in decision 5, so the owner decides again (12.3). |
| SDK with Vite and Lit SSR | Works without patches. It needs one Vite setting (below). The build passes, SSR pages render, and the server bundle does not load the libraries. |
| `!no-unauthenticated` on the public AppView | **The AppView returns everything.** `getProfile`, `getAuthorFeed` and `getPostThread` all answer 200 with full text. So Caribou must hide it (8.3). |
| `litro dev` and a dotted route | Works. `/@alice.example.com`, `/@alice.example.com/<rkey>`, `/@did:plc:...` and handles that end like a file (`.ts`, `.md`, `.js`, `.css`, `.json`, `.png`) all render the profile page. |
| Public AppView rate limit | **Not advertised.** No `ratelimit-*` or `retry-after` headers, on 200 or 403. 15 requests in a row, past the CDN cache, all answered 200. |
| Option-D key binding | **Not run.** It needs a registered confidential client (below). |
| Loopback sign-in | The loopback client resolves the handle and sends PAR with PKCE and DPoP. `bsky.social` accepts it and shows its approval page. The callback and the Following fetch need a person to approve; see the PR. |

Versions measured: `@atproto/api` 0.30.3, `@atproto/oauth-client-browser`
0.5.14, Vite 8.3.2.

**The chunk, in parts.** Each library built alone, minified and gzipped:
`@atproto/api` 157.2 KB, `@atproto/oauth-client-browser` 62.6 KB. They share
about 15 KB. So `@atproto/api` is about three quarters of the chunk. The OAuth
library alone is under the line. Hand-written XRPC calls (decision 4, other way)
plus the OAuth library would come to about 63 KB plus our own code.

**The Vite setting.** Without it, rolldown (Vite's bundler) puts its own runtime
helpers inside the atproto chunk. `app-main` uses one of those helpers, so it
imports the chunk statically, and every page downloads 182 KB. A
`codeSplitting` group for `@atproto` moves the libraries into their own chunk
and fixes this. Rolldown does not pass its runtime module to a group's `test`,
so a group for the runtime itself does not work. A test must check that a
Mastodon page does not request the Bluesky chunk.

**`!no-unauthenticated`, how we found accounts.** We watched profile records
on the public Jetstream firehose
(`wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.actor.profile`)
and kept those whose `labels.values` held `!no-unauthenticated`. Two accounts
showed up within 15 profile updates. The AppView puts the label on
`author.labels` of each post and on the profile's `labels`, so the server can
see it without a token. We do not name the accounts.

**Rate limit.** The public AppView sits behind a CDN (BunnyCDN). It caches
for 30 seconds, so repeated SSR of the same page does not reach the AppView.
The limit stays unknown. Keep the plan in 12.1: the 30 s cache, and a client
render on 429.

**What option D needs.** `bsky.social` advertises `private_key_jwt` with ES256
and accepts client metadata documents. A loopback client is always public, so
the test cannot run from local dev. It needs:

1. A public HTTPS host that serves `client-metadata.json` with
   `token_endpoint_auth_method: "private_key_jwt"`, an ES256 key in `jwks`,
   and a redirect URI on that host.
2. A test account on `bsky.social`, and a person to approve once.
3. A script that makes two DPoP keys, signs a client assertion with `cnf.jkt`
   set to key 1, and sends PAR, the code swap and a refresh with DPoP proofs
   from key 2.
4. The pass mark from 5.3: each of the three requests is rejected. A control
   run with matching keys must succeed.
5. Lifetimes: the token response does not state the session or refresh
   lifetime. Checking the 2-year session means refreshing past 2 weeks. So
   lifetimes can only be checked over time, not in one sitting.

### 12.3 Decisions (owner, 2026-11-04)

The owner took the recommended answer to each open question.

1. **OAuth:** a public browser client for the first release (re-approve every
   two weeks). The client-assertion backend (option D) is the later upgrade,
   behind its release gate (5.3). Not the BFF.
2. **Model:** Caribou-owned types with Mastodon field names (option a). The
   seams in 6.3 are done first.
3. **Profile route:** `/@alice.example.com`, with the `profilePath` fix. The
   rare wrong page for a hostless remote Mastodon name with a dot is accepted
   (8.4).
4. **Local and Public:** hidden for Bluesky. Feeds come in phase 5.
5. **Client library:** `@atproto/api`, if its lazy chunk is under about 100 KB
   gzipped (measured in phase 0). If it is larger, the owner decides again.
   **Open again:** phase 0 measured 181.6 KB (12.2).
6. **Signed-out SSR:** yes, for Bluesky profiles and threads, honoring
   `!no-unauthenticated`.
7. **Video:** day one ships without playback (thumbnail and link only).
   Playback is phase 6.

The sign-in form was decided in round 2: two panels (5.5).

---

## 13. Phased plan

Sizes: **S** up to 3 days, **M** about a week, **L** about two weeks. A
phase's estimate is the sum of its issues, as a range for integration and
review. Each phase ships on its own and leaves main working.

| phase | what ships | issues | estimate | depends on |
|---|---|---|---|---|
| 0 | Spike and measurements | 1 S | 3 days | — |
| 1a | Type and paging seams (no visible change) | 1 S, 3 M | 3–4 weeks | — |
| 1b | Session and provenance seams (no visible change) | 2 M | 2 weeks | 1a |
| 2a | Bluesky client, rendering, moderation (behind a flag) | 1 S, 1 M, 2 L | 5–6 weeks | 0, 1a |
| 2b | Sign-in, switcher, Following, profile, thread (behind the flag) | 1 S, 3 M | 3–4 weeks | 1b, 2a |
| 3 | SSR for profiles and threads | 2 S, 1 M | 2 weeks | 2b |
| 4 | Actions, compose, notifications. **Flag off: day one.** | 1 S, 2 M, 1 L | 4–5 weeks | 2b, 3, PR #167 |
| 5 | Search, hashtags, feeds, lists | 1 S, 3 M | 3–4 weeks | 4 |
| 6 | Independent items | 1 S, 4 M | 4–5 weeks in total, any order | 4 |

**Day one is about 20–24 weeks of work from phase 0** (the sums of the low and the high ends in the table; overlap can shorten it). Phase 0 can run beside
1a, and parts of 2a beside 1b. Round 1 said phase 2 was "L" and implied about
10 weeks to day one. It counted a phase as its biggest issue, not the sum, and
it missed the seams.

### Phase 0 — spike (S)

Add the two libraries on a branch. Build and record the lazy chunk's size.
Sign in through the loopback client; fetch Following; check Lit SSR still
builds. Probe the other unknowns in 12.2. Write the numbers into 12.2.

### Phase 1a — type and paging seams

Owned recursive types and imports (seam 1); write methods take refs and
mutations commit record refs (seams 2, 3); opaque cursors for timelines and
profiles with the SSR handoff (seam 5); order from the client (seam 6);
`capabilities`, with the nav, compose and card reading them. No behavior change
for Mastodon; tests stay green.

### Phase 1b — session and provenance seams

`generation`, `expired`, the sorted error handling and the event split (5.6).
Resource `network`, `viewerOf` merge rules (seam 4), network-aware `canAct`,
links and reads (seam 9, section 11).

### Phase 2a — client and rendering

`packages/bluesky-client` read methods and mappers, with catch-up and feed
identity (seams 7, 8). Facet renderer. Embeds. Moderation with label
definitions, per-surface decisions, `noOverride` and the veil.

### Phase 2b — sign-in and reading

Server metadata and resolver with the SSRF guard. Sign-in panels, callback,
restore, expiry, sign-out. Switcher. Following with polling, profile tabs,
thread. Client render only.

### Phase 3 — SSR

`bluesky-public.ts`, route rules and the `profilePath` fix (8.4), profile and
thread SSR, `!no-unauthenticated`, Bluesky TTLs. Integration tests on SSR
output; a hydration e2e on a fixture server, not the live AppView.

### Phase 4 — day one

Like, repost, bookmark, follow, mute, block, with record refs and rollback;
Reply and Quote off by the post's flags. Compose with the draft contract,
limits, resize, labels, reply and quote. Delete and redraft. Notifications with
client grouping, `getUnreadCount` and `updateSeen`. Turn the flag off.

### Phase 5 — discovery

Search (people and posts); hashtag page; pinned feeds on Home; lists with the
public note.

### Phase 6 — independent items

Muted words; #131 for Bluesky; video; gates in compose; link cards in compose.

### 13.1 Issues to file

Filed on 2026-11-04. Tracking issue: #169.

| # | title | size | phase |
|---|---|---|---|
| #170 | `bluesky: spike — bundle size, loopback sign-in, phase-0 unknowns` | S | 0 |
| #171 | `refactor: Caribou-owned Status/Account/Relationship/List/Notification types` | M | 1a |
| #172 | `refactor: CaribouClient write methods take refs; mutations commit what the server returns` | M | 1a |
| #173 | `refactor: opaque paging cursors for timelines and profiles, with the SSR handoff` | S | 1a |
| #174 | `refactor: CaribouClient capabilities; nav, compose and card read them; timeline order from the client` | M | 1a |
| #175 | `state: session generation and an expired state that keeps drafts` | M | 1b |
| #176 | `state: resource network, viewer slots with freshness rules, network-aware actions and links` | M | 1b |
| #177 | `bluesky: client package with read methods, mappers, catch-up and feed identity` | L | 2a |
| #178 | `bluesky: facets to HTML renderer` | S | 2a |
| #179 | `bluesky: embeds — images, external, record, recordWithMedia, video thumbnail` | M | 2a |
| #180 | `bluesky: moderation with label definitions, plain-data per-surface results and a label-aware reader veil` | L | 2a |
| #181 | `server: atproto client metadata and handle resolver with a connection-bound SSRF guard` | M | 2b |
| #182 | `bluesky: sign-in panels, callback, restore, expiry, sign-out` | M | 2b |
| #183 | `bluesky: account switcher network names and switch rules` | S | 2b |
| #184 | `bluesky: Following feed, profile and thread views` | M | 2b |
| #185 | `bluesky: SSR for profiles and threads; route rules; profilePath fix` | M | 3 |
| #186 | `bluesky: honor !no-unauthenticated in SSR` | S | 3 |
| #187 | `bluesky: SSR cache TTLs and 429 fallback` | S | 3 |
| #188 | `bluesky: like, repost, bookmark, follow, mute, block; reply and quote limits` | M | 4 |
| #189 | `bluesky: compose — draft contract, limits, image resize, labels, reply, quote` | L | 4 |
| #190 | `bluesky: delete and redraft` | S | 4 |
| #191 | `bluesky: notifications with client grouping and the unread badge` | M | 4 |
| #192 | `bluesky: search for people and posts` | M | 5 |
| #193 | `bluesky: hashtag page` | S | 5 |
| #194 | `bluesky: pinned feeds on Home` | M | 5 |
| #195 | `bluesky: lists (curate lists) with the public-list note` | M | 5 |
| #196 | `bluesky: muted words in the filters screen` | M | 6 |
| #197 | `bluesky: act as another Bluesky account (#131)` | M | 6 |
| #198 | `bluesky: video playback` | M | 6 |
| #199 | `bluesky: thread gate and post gate in compose` | S | 6 |
| #200 | `bluesky: link cards in compose` | M | 6 |
| #201 | `auth: client-assertion backend (option D), when the SDK allows and the provider passes the key-binding gate` | M | after 4 |
