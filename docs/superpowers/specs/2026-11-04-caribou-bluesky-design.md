---
title: Caribou Bluesky support — Design Spec
date: 2026-11-04
status: draft, for owner review
---

# Caribou Bluesky support — Design Spec

## 1. Summary

Caribou is a Mastodon client. This spec adds Bluesky as a second network.
Bluesky runs on the AT Protocol ("atproto").

A reader signs in with a Bluesky account next to their Mastodon accounts. They
read their Following feed, open profiles and threads, and like, repost, reply,
quote, follow and post. Screens stay the same where the two networks match.
A feature that one network lacks is hidden for that network, not shown broken.

The recommended shape, in one line each:

- **Sign-in:** atproto OAuth as a **public browser client**. Tokens and the
  DPoP key stay in the browser, like the Mastodon token does today. Caribou's
  server serves the client metadata and resolves handles. It does not proxy
  data.
- **Model:** a second `CaribouClient` that returns **Mastodon-shaped objects**
  plus a small `bluesky` extension field. Each client declares what it can do
  (`capabilities`). The neutral model can grow out of this later.
- **Routes:** `/@alice.example.com` is a Bluesky profile. A Mastodon username
  never has a dot, so the dot tells the two apart.
- **SSR:** profiles, threads and feeds come from the public AppView without a
  token. The Following feed, notifications, bookmarks and search need a token
  and render on the client, as they do for Mastodon.

No code ships with this spec. Section 13 lists the phases and issues.

---

## 2. Scope

### 2.1 Goal: day one

A reader can do these things on the first Bluesky release (end of phase 4 in
section 13):

- Sign in with a Bluesky handle (`alice.bsky.social`, `alice.example.com`), a
  DID, or a PDS host. Keep a Mastodon account signed in at the same time.
- Switch between Bluesky and Mastodon accounts with the account switcher.
- Read the **Following** feed with the "N new posts" banner.
- Open a **profile** (posts, replies, media) and a **thread**.
- See text with links, mentions and tags; images with alt text; link cards;
  quoted posts; quoted posts with media.
- See labels and moderation the way the Bluesky app shows them: blur, warn or
  hide.
- **Like, repost, quote, reply, bookmark, follow, mute, block.** Each one is
  optimistic with rollback, like today.
- **Compose** a post (300 characters, counted as graphemes), with up to four
  images and alt text, as a reply or a quote.
- **Delete** an own post.
- Read **notifications** with the unread badge.

### 2.2 Later (planned)

- Pinned and saved **custom feeds** (phase 5).
- **Lists** (curate lists) and list feeds (phase 5).
- **Search** for posts and people; hashtag pages through search (phase 5).
- **Muted words**, mapped to the filters screen (phase 6).
- "Act as another account" (#131) between Bluesky accounts (phase 6).
- **Video** playback (HLS) (phase 6).
- **Thread gates** (who can reply) and **post gates** (quotes off) in compose
  (phase 6).

### 2.3 Non-goals

- **DMs** (`chat.bsky`). Caribou has no DM view for Mastodon either.
- **Moderation lists**, **starter packs**, running a **labeler**.
- A **merged home** with both networks in one feed.
- **Cross-posting** one draft to both networks.
- **Account management**: handle change, email, migration, deletion. The
  reader uses the Bluesky app or their PDS for that.
- Our own **AppView**, relay or PDS.
- **Bridged accounts** (Bridgy Fed). A bridged account is just an account on
  the other network. Caribou does nothing special.

---

## 3. Context and references

- AT Protocol OAuth: <https://atproto.com/specs/oauth>
- Permission scopes: <https://atproto.com/specs/permission>
- Handles: <https://atproto.com/specs/handle>
- Rich text facets: <https://docs.bsky.app/docs/advanced-guides/post-richtext>
- Browser OAuth client: `@atproto/oauth-client-browser` (in the
  `bluesky-social/atproto` repo)
- Caribou v1 spec: `docs/superpowers/specs/2026-04-21-caribou-v1-design.md`
  (sections 5, 7 and 8 are the parts this spec changes)
- Multi-account switcher: #58. Act as another account: #131.

### 3.1 Words used here

| word | meaning |
|---|---|
| **DID** | The stable id of an account, like `did:plc:abc123`. It never changes. |
| **Handle** | The name a person shows, like `alice.bsky.social`. It is a domain and it can change. |
| **PDS** | Personal Data Server. It holds one account's records and takes its writes. |
| **AppView** | The service that builds feeds, threads, counts and notifications from all records. Bluesky runs `api.bsky.app` and the token-free `public.api.bsky.app`. |
| **Record** | One item in an account's repo: a post, a like, a follow. A like is a record, not a flag. |
| **AT URI** | The address of a record: `at://did:plc:abc/app.bsky.feed.post/3mzh...`. The last part is the **rkey**. |
| **CID** | A hash of one version of a record. A reply or a like names both the URI and the CID. |
| **Facet** | A range in a post's plain text that is a link, a mention or a tag. |
| **Label** | A tag on a post or an account from a moderation service (a **labeler**) or from the author. |
| **DPoP** | A rule that binds a token to a key. Each request carries a fresh proof signed by that key. A stolen token alone is useless. |
| **PAR** | Pushed Authorization Request. The client sends the sign-in request to the server first and gets a short `request_uri` back. |

### 3.2 What we checked by hand (2026-11-04)

From `https://public.api.bsky.app/xrpc/`, with no token:

| endpoint | answer |
|---|---|
| `app.bsky.actor.getProfile` | 200 |
| `app.bsky.feed.getAuthorFeed` | 200 |
| `app.bsky.feed.getPostThread` | 200 |
| `app.bsky.feed.getFeed` (a feed generator) | 200 |
| `app.bsky.graph.getLists` | 200 |
| `app.bsky.feed.searchPosts` | **403** |
| `app.bsky.feed.getTimeline` | **401** |

The public AppView sends `access-control-allow-origin: *` and
`cache-control: public, max-age=30`. A post view now has `bookmarkCount` and
`quoteCount`. `bsky.social` advertises the scopes `atproto`,
`transition:generic`, `transition:email` and `transition:chat.bsky`, and the
client auth methods `none` and `private_key_jwt`.

---

## 4. Key decisions — at a glance

| # | decision | recommended | other way |
|---|---|---|---|
| 1 | OAuth client type | Public browser client | Confidential client with a server session (BFF) |
| 2 | Where tokens live | Browser IndexedDB, keyed by DID | Caribou server, behind a cookie |
| 3 | Model between screens and clients | Mastodon-shaped objects + `bluesky` field + `capabilities` | New neutral model with two adapters |
| 4 | Client library | `@atproto/api` + `@atproto/oauth-client-browser` | Hand-written XRPC calls |
| 5 | UserKey for Bluesky | `<did>@bsky` | `<handle>@<pds host>` |
| 6 | Profile route | `/@alice.example.com` (a dot means Bluesky) | A prefix, like `/bsky/@alice.example.com` |
| 7 | Post route | `/@alice.example.com/<rkey>` | The full AT URI in the path |
| 8 | Home for Bluesky | Following feed | A merged feed (non-goal) |
| 9 | `/local` and `/public` for Bluesky | Not shown | Map to "Discover" |
| 10 | Scopes | `atproto transition:generic` | Granular scopes now |

Each one is argued in the sections below. Section 12.3 asks the owner to confirm
the ones that cost the most to change later.

---

## 5. Sign-in

### 5.1 How atproto OAuth differs from Mastodon's

| | Mastodon today | atproto |
|---|---|---|
| App registration | `POST /api/v1/apps` per server, cached 7 days | None. The `client_id` **is** a URL to a JSON metadata file that Caribou serves. |
| Client secret | Yes, kept on the Caribou server | None. A confidential client signs a JWT with its own key instead. |
| Where to send the user | The server the user typed | Resolve handle → DID → DID document → PDS → `/.well-known/oauth-protected-resource` → authorization server → its metadata |
| Request | Plain redirect | PAR first, then redirect with `request_uri` |
| PKCE | No | Required, `S256` |
| Token | Bearer, long-lived | DPoP-bound. Access token under 30 minutes. Refresh token single-use. |
| Session cap | None | Public client: 2 weeks. Confidential client: no cap, each refresh token up to 180 days. |
| After the token | Use it | Check that `sub` (the DID) resolves to a PDS whose authorization server issued the token |

### 5.2 Option A — public browser client (recommended)

`@atproto/oauth-client-browser` runs the whole flow in the browser. It makes a
non-extractable DPoP key (the page can use it but cannot read it out), stores
the session in IndexedDB, refreshes on its own, and restores a session by DID.

What Caribou's server does:

1. **Serves the client metadata** at
   `https://<host>/oauth/client-metadata.json`. The `client_id` field must equal
   that exact URL. Fields: `client_name: "Caribou"`, `client_uri`,
   `redirect_uris: ["https://<host>/signin/bluesky"]`,
   `scope: "atproto transition:generic"`,
   `grant_types: ["authorization_code", "refresh_token"]`,
   `response_types: ["code"]`, `token_endpoint_auth_method: "none"`,
   `application_type: "web"`, `dpop_bound_access_tokens: true`. The host comes
   from `PUBLIC_BASE_URL`, like the Mastodon redirect URI does.
2. **Resolves handles.** A browser cannot read DNS TXT records. The server
   answers `GET /api/atproto/resolve-handle?handle=` with the DID. It tries DNS
   `_atproto.<handle>` and `https://<handle>/.well-known/atproto-did`, and DNS
   wins if they differ. This keeps the reader's handle and IP away from a third
   party resolver. See section 10 for the SSRF guard.

What it does not do: hold tokens, proxy data, or keep sessions. The v1 rule
"server responsibilities — exactly three" (v1 spec 5.2) stays true, with two
small static-ish endpoints added to the OAuth part.

Cost:

- **The reader signs in again every two weeks.** The browser client cannot
  extend this. The library does silent re-auth where the authorization server
  allows it, which helps when the reader is still signed in at their PDS.
- An XSS bug can use the DPoP key while the page is open. It cannot copy the
  key out. This is the same class of risk as the Mastodon token in
  localStorage today, and a bit better.
- Local dev needs the loopback client (`client_id` `http://localhost`,
  redirect on `http://127.0.0.1:<port>`). Its refresh tokens are short.

### 5.3 Option B — confidential client with a server session

`@atproto/oauth-client-node` runs on Caribou's server. The server holds an
ES256 key, publishes its public half in `jwks`, and signs a client assertion
on each token request. Tokens and the DPoP key stay on the server. The browser
gets a session cookie.

Good: sessions do not expire every two weeks. Credentials can be revoked
server-side.

Cost:

- **Every Bluesky call goes through Caribou's server.** A DPoP key must not
  leave the device it was made for. So the browser cannot call the PDS itself.
  This turns the server into a data proxy, which the v1 spec rules out.
- The server now stores secrets and sessions for every reader. The `/data`
  volume becomes sensitive. Key rotation becomes our job: if a key leaves
  `jwks`, every session on it dies.
- Polling, timelines and compose all go through our server. That is load and
  latency we do not have today.
- Two code paths: Mastodon direct from the browser, Bluesky through the server.

A middle way exists in theory. The browser keeps the DPoP key and signs the
proof. The server only adds the client assertion to the token request. No
library does this, and it is not a pattern the spec describes. We do not
plan on it.

### 5.4 Recommendation

**Option A for the first release.** It fits Caribou's shape: the browser
talks to the network, and the server only helps with sign-in. Revisit Option B
if the two-week sign-in turns out to annoy readers. Section 12.3, question 1.

### 5.5 Flow (option A)

1. On the landing or `/?add` form, the reader types a handle, a DID or a PDS
   host. The form already takes a Mastodon server. A value that looks like a
   handle with no Mastodon instance behind it, or that starts with `did:`, goes
   the Bluesky way. See section 12.3, question 2, for whether to show two tabs
   instead.
2. The browser calls `client.signIn(input)`. The library resolves the
   identity (through our resolver), finds the authorization server, sends PAR
   with PKCE and DPoP, and redirects.
3. The PDS's authorization page asks the reader to approve.
4. The PDS redirects to `/signin/bluesky?code=...&state=...&iss=...`. This page
   renders only a shell. The browser calls `client.init()`, which swaps the code
   for tokens, checks `sub`, and stores the session in IndexedDB.
5. Caribou adds a `UserSession` (5.6) and calls `getProfile` for the account.
6. The page goes to `/home`, as Mastodon's `/signin/done` does.

The code and state are in the query string, not the fragment. That differs
from Caribou's Mastodon rule (v1 spec 5.5). It is safe here because the code
needs the PKCE verifier and the DPoP key, which only this browser has. The
page still clears the query with `history.replaceState` at once.

### 5.6 Session shape and the multi-account model (#58)

Today (`packages/state/src/users.ts`):

```ts
interface UserSession {
  userKey: UserKey        // `${handle}@${server}`
  server: string
  token: string
  vapidKey: string
  account: mastodon.v1.Account | null
  createdAt: number
}
```

Proposed:

```ts
type UserSession = MastodonSession | BlueskySession

interface MastodonSession {
  network?: 'mastodon'    // absent on stored entries from before this change
  userKey: UserKey
  server: string
  token: string
  vapidKey: string
  account: Account | null
  createdAt: number
}

interface BlueskySession {
  network: 'bluesky'
  userKey: UserKey        // `${did}@bsky`
  did: string
  handle: string          // for display; re-checked on load
  pds: string             // from the DID document; can change
  account: Account | null // Mastodon-shaped, see section 6
  createdAt: number
  // No token here. The OAuth library keeps it in IndexedDB under the DID.
}
```

The **UserKey** for Bluesky is `<did>@bsky`, for example
`did:plc:abc123@bsky`. Reasons:

- The DID never changes. A handle and a PDS host can.
- `isUserKey` splits on `@` and wants two parts. A DID has no `@`, so this
  passes unchanged.
- Prefs (`caribou.prefs.<userKey>`) and every other per-user key keep working.

`activeClient` picks the client by `network`. For Bluesky it calls
`client.restore(did)` once and wraps the session in the Bluesky
`CaribouClient`. If restore throws (expired or revoked), it fires the same
`caribou:unauthorized` event as a Mastodon 401, so the existing "sign in
again" path runs.

**Sign-out** of a Bluesky account calls `session.signOut()` (which revokes the
token at the PDS) and then `removeSession`. The Mastodon sign-out route
(`/api/signout`) is not used.

**The account switcher** lists both kinds. Each row gets a small network mark
(a Mastodon or Bluesky glyph) next to the handle, because `alice@example.social`
and `alice.example.social` look alike. A switch still reloads the page, as
decided for #58. `pathAfterSwitch` (`components/_switch-account.ts`) changes:

- `/local` and `/public` are not "neutral" when the new account is Bluesky.
  They go to `/home`.
- A Bluesky profile `/@alice.example.com` is kept, like `/@name@host` is
  today. A handle is global.
- A Bluesky post `/@alice.example.com/<rkey>` is **also kept**. An AT URI is
  global, unlike a Mastodon status id. A Mastodon account cannot act on it,
  but it can still read it (section 8).

---

## 6. The layer between screens and clients

### 6.1 Where Caribou is today

Every network call goes through one interface, `CaribouClient`
(`packages/mastodon-client/src/create-client.ts`): about 60 methods. Stores in
`packages/state` call only that interface. That is the seam.

The types are another matter. The app and packages name `mastodon.v1.Status`
about 190 times, `Account` 85, `Relationship` 62, `List` 40, `Notification` 34.
About 44 files import from `masto` or the client package. The state package is
about 3,200 lines. `packages/mastodon-client/src/index.ts` already exports
aliases (`Status`, `Account`, `Relationship`, `List`), but most code names
`mastodon.v1.*` directly.

### 6.2 Option (a) — Bluesky in Mastodon shapes (recommended)

A new package, `@beatzball/caribou-bluesky-client`, implements `CaribouClient`.
It turns each Bluesky view into the Mastodon shape the stores already use.

```ts
// A Mastodon-shaped status that came from Bluesky.
interface BlueskyExtra {
  uri: string                 // at://did/app.bsky.feed.post/rkey
  cid: string
  likeUri: string | null      // viewer.like: needed to unlike
  repostUri: string | null    // viewer.repost: needed to un-repost
  bookmarked: boolean
  labels: Label[]             // raw labels, for the moderation decision
  moderation: ModerationUi    // blur / warn / hide, computed once
  replyRef: { root: StrongRef; parent: StrongRef } | null
}
type Status = mastodon.v1.Status & { bluesky?: BlueskyExtra }
```

Mapping, field by field:

| Mastodon field | from Bluesky |
|---|---|
| `id` | the AT URI. Unique across all accounts. |
| `uri`, `url` | AT URI; `https://bsky.app/profile/<handle>/post/<rkey>` |
| `content` | HTML built from `record.text` + `record.facets` (section 7) |
| `createdAt` | `record.createdAt` (the author's claim); `indexedAt` as a fallback |
| `account` | `author` → Account (below) |
| `reblog` | a feed item with `reason: reasonRepost` becomes a wrapper status whose `id` is the repost's URI, `account` the reposter, `reblog` the post |
| `inReplyToId` | `record.reply.parent.uri` |
| `favouritesCount`, `reblogsCount`, `repliesCount` | `likeCount`, `repostCount`, `replyCount` |
| `favourited`, `reblogged`, `bookmarked` | `viewer.like != null`, `viewer.repost != null`, `viewer.bookmarked` |
| `visibility` | always `public` |
| `spoilerText`, `sensitive` | from the moderation decision on labels (section 7.4) |
| `mediaAttachments` | `embed` images (and video, later) |
| `card` | `embed` external |
| `quote` | `embed` record / recordWithMedia (shape from the quotes work in `feat-quotes`) |
| `poll`, `editedAt`, `emojis`, `tags` | `null`, `null`, `[]`, from tag facets |

Account: `id` = DID, `acct` = handle, `username` = first label of the
handle, `displayName`, `note` = description as plain text with links,
`avatar`, `header` = banner, counts from `followersCount`, `followsCount`,
`postsCount`. Relationship: from `viewer.following`, `viewer.followedBy`,
`viewer.muted`, `viewer.blocking`, `viewer.blockedBy`; the follow and block
record URIs go in a `bluesky` field for undo.

**`capabilities`.** Each client says what it supports:

```ts
interface Capabilities {
  network: 'mastodon' | 'bluesky'
  localTimeline: boolean; publicTimeline: boolean
  visibility: boolean; contentWarningText: boolean
  polls: boolean; edit: boolean; customEmoji: boolean
  followTags: boolean; tagTimeline: boolean
  privateLists: boolean; serverFilters: boolean
  maxChars: number; charCount: 'chars' | 'graphemes'
  maxImages: number
}
```

Screens read `activeClient.capabilities` to hide a button or a nav item. A
client method a network lacks throws `CaribouError` with code `unsupported`.
That is a bug signal: the UI should have hidden it.

Cost of (a):

- **Small to start.** No screen or store changes their types. Most work is
  the adapter and the `capabilities` checks.
- **The shape lies a little.** `visibility: 'public'` is true. `editedAt: null`
  is true. But a Bluesky like needs the like record's URI to undo it, and the
  Mastodon shape has no place for that. The `bluesky` field holds it, and the
  mutations in `packages/state/src/mutations.ts` must pass the whole status
  down, not only the id. That is a real change to five or six functions.
- **Two kinds of id in one cache.** A Mastodon id and an AT URI never collide.
  Fine.
- **Risk of drift.** A screen can forget a capability check. The test matrix
  (section 13, phase 1) runs key component tests against both a Mastodon and a
  Bluesky fixture.

### 6.3 Option (b) — a neutral model with two adapters

Define Caribou's own `Post`, `Profile`, `Relation`, `Notice`, `Feed` types.
Both clients map into them. Screens and stores use only these.

Cost of (b):

- **Large.** Every one of the ~190 `Status` references and the rest change.
  Every store, every component, every fixture and every SSR serializer. A
  rough size: 3–5 weeks before the first Bluesky post shows. It must land in
  one go or behind a long-lived branch, while other work keeps changing the
  same files.
- **Mastodon gets no new feature from it.** It is pure risk for the Mastodon
  side.
- Good: the model fits both networks honestly. Network-only data has a proper
  home. It is the right end state if a third network ever comes.

### 6.4 Recommendation

**Option (a) now, with a path to (b).** Do this in phase 1:

1. Make every file import `Status`, `Account`, `Relationship`, `List`,
   `Notification` from `@beatzball/caribou-mastodon-client`, not
   `mastodon.v1.*` from `masto`. This is mechanical and safe.
2. Make those aliases Caribou-owned types (`mastodon.v1.Status & { bluesky?: ... }`).

After that, moving to a neutral model is a change to the aliases, one type at
a time, not a change to 44 files at once.

### 6.5 What changes in existing code

| place | change |
|---|---|
| `packages/mastodon-client/src/index.ts` | Aliases become Caribou types with the optional `bluesky` field. Export `Capabilities`. |
| `packages/mastodon-client/src/create-client.ts` | `CaribouClient` gains `capabilities`. Mastodon client fills it from the instance (char limit, etc.). |
| new `packages/bluesky-client` | The Bluesky `CaribouClient`, facet renderer, embed mapper, moderation wrapper. |
| `packages/auth/src/user-key.ts` | Helpers `toBlueskyUserKey(did)`, `networkOf(userKey)`. Format unchanged. |
| `packages/state/src/users.ts` | `UserSession` union; `activeClient` picks by network; restore Bluesky session; `loadFromStorage` defaults `network` to `mastodon`. |
| `packages/state/src/mutations.ts` | Like, repost, bookmark, follow, mute, block take the status or account, not only its id, so the adapter can find the record URI. |
| `packages/state/src/timeline-store.ts` | Polling: Bluesky has no `since_id`. The adapter fetches the first page and returns only items newer than the known top item. The store's contract (`sinceId` in, newer items out) stays. `nextMaxId` carries Bluesky's opaque `cursor`. |
| `packages/state/src/notification-groups.ts` | Bluesky has no server-side grouping. The adapter groups likes, reposts and follows on the client into the same `GroupedNotificationsPage` shape. `compareNotificationIds` cannot compare Bluesky ids; compare by `indexedAt` for Bluesky. |
| `packages/state/src/compose.ts` | Character count by graphemes when `charCount` is `graphemes`. No visibility, no CW text, no poll for Bluesky. |
| `packages/state/src/prefs.ts` | `DefaultTimeline` gains `following` for Bluesky; `local` and `public` are invalid there. Feed prefs come from the PDS, not localStorage. |
| `packages/state/src/caches.ts` | `olderEdit` and edit fields do nothing for Bluesky. `readerFiltered` gets Bluesky muted words later (phase 6). |
| `components/_switch-account.ts` | Rules in 5.6. |
| `components/caribou-nav-rail.ts` | Hide Local and Public for Bluesky. Show Feeds (phase 5). |
| `components/caribou-compose-dialog.ts` | Hide visibility, CW text and poll by capability. |
| `components/caribou-status-card.ts` | Moderation blur/warn from `bluesky.moderation`. Hide Edit and History. |
| `server/lib/page-data-types.ts`, `mastodon-public.ts` | A `bluesky-public.ts` next to it for SSR (section 8). |
| `server/routes/` | `oauth/client-metadata.json`, `api/atproto/resolve-handle`. |
| `pages/@[handle].ts`, `pages/@[handle]/[statusId].ts` | Pick the network from the handle shape (section 8.4). |

---

## 7. Rich text and embeds

### 7.1 Facets to HTML

A Bluesky post is plain text plus facets. There is no HTML. Facet ranges are
**UTF-8 byte** offsets, `byteStart` inclusive, `byteEnd` exclusive. JavaScript
strings are UTF-16, so `text.slice()` gives wrong ranges for any emoji or
non-ASCII letter.

The renderer:

1. Encode the text to bytes with `TextEncoder`.
2. Sort facets by `byteStart`. Drop any facet that overlaps the one before it,
   or that falls outside the text.
3. Walk the bytes. Decode each plain segment with `TextDecoder` and
   HTML-escape it. Turn `\n` into `<br>`.
4. Wrap each facet segment:
   - `#link` → `<a href="<uri>" rel="nofollow noopener noreferrer" target="_blank">`.
     Only `http:` and `https:` URIs. Any other scheme renders as plain text.
   - `#mention` → `<a href="/@<handle>">` when the segment text is
     `@<handle>`; else `<a href="/@<did>">`. The profile route accepts a DID
     and shows the handle.
   - `#tag` → `<a href="/tags/<tag>">`. On Bluesky this page is a search
     (section 9).
   - If one facet has more than one feature, use the first link-like one.
5. Wrap the whole thing in `<p>`.

The output then goes through the **same DOMPurify config** (`PURIFY_OPTS`)
as Mastodon content, on the server and in the browser. The renderer builds
safe HTML on its own. The second pass is defense in depth, and it keeps one
rule: everything in `content` has been through DOMPurify.

A link facet's text may differ from its URI (a shortened label). Show the
text. Put the full URI in `title`.

The renderer lives in `packages/bluesky-client`. It is a pure function with
unit tests on emoji, combining marks, overlapping and out-of-range facets,
and `javascript:` links.

The profile description has no facets. Detect links and mentions in it with
`@atproto/api`'s `RichText.detectFacets` and render the same way.

### 7.2 Writing facets

Compose sends plain text. Before `createRecord`, run
`RichText.detectFacets` (from `@atproto/api`). It finds links, `@handle`
mentions (resolved to DIDs) and `#tags`, with the right byte ranges. Link
cards: fetch the link's title and image (the Bluesky app uses its own card
service; we could do it on our server) and attach an `external` embed. Phase
4 ships without auto cards; phase 6 adds them.

### 7.3 Embeds

| `embed.$type` (view) | renders as |
|---|---|
| `app.bsky.embed.images#view` | `mediaAttachments` of type `image`: `fullsize` as `url`, `thumb` as `previewUrl`, `alt` as `description`, `aspectRatio` as meta. Up to 4. |
| `app.bsky.embed.video#view` | Phase 2–5: the thumbnail with a play mark that links out. Phase 6: HLS playback (`playlist` is an `.m3u8`; Safari plays it natively, others need `hls.js`). |
| `app.bsky.embed.external#view` | `card`: title, description, thumb, uri. `caribou-status-link-card` renders it. A GIF from Tenor is an external embed; treat it as a card. |
| `app.bsky.embed.record#view` | a quote. The inner record can be a post (`viewRecord`), or a not-found, blocked or detached stub. A stub renders as a small grey box: "Post not found", "Blocked", "Removed by author". The inner record can also be a feed, a list, a starter pack or a labeler: a small card with name and link to bsky.app. |
| `app.bsky.embed.recordWithMedia#view` | a quote plus media, both of the above. |

Image and avatar URLs point at Bluesky's CDN (`cdn.bsky.app`). The CSP
`img-src` must allow it. A post from another AppView would use its own CDN,
so keep `img-src https:`, as today.

### 7.4 Labels, content warnings and moderation

Mastodon has a free-text content warning that the author writes. Bluesky has
none. It has **labels**:

- **Self-labels** the author sets: `sexual`, `nudity`, `porn`,
  `graphic-media`. They are about the media, not the text.
- **Labels from labelers.** Bluesky's own moderation service, plus any the
  reader subscribes to. A label can mean blur the media, blur the whole post,
  warn, or hide.
- **`!no-unauthenticated`**: the author asks that logged-out viewers not see
  their content (section 8).

Rules:

- Call `moderatePost` and `moderateProfile` from `@atproto/api` with the
  reader's label prefs (`app.bsky.actor.getPreferences`: adult content on or
  off, per-label choices, subscribed labelers). Do not write our own label
  logic. Getting it wrong shows adult or harmful media to someone who opted
  out.
- Send the `atproto-accept-labelers` header with the reader's labelers on
  each AppView call, so the AppView applies them.
- Map the decision to Caribou's existing UI: "blur media" → `sensitive: true`;
  "warn on post" → `spoilerText` set to the label's display name ("Graphic
  media", "Adult content"); "hide" → drop from the list, like a filtered
  status (`filteredById` with `hide`).
- The compose dialog's CW toggle becomes a "label this media" picker for
  Bluesky (adult, nudity, graphic). Free-text CW is hidden.

---

## 8. SSR and the hydration rule

### 8.1 The rule

The server render must equal the first client render (`apps/caribou/README.md`).
Today SSR pages fetch public Mastodon data with no token
(`server/lib/mastodon-public.ts`) and hand it to the page as `serverData`.
Reader-only state (favourited, following) comes after hydration, in
`firstUpdated` or a store effect.

Bluesky follows the same rule with a new `server/lib/bluesky-public.ts`. It
calls `https://public.api.bsky.app/xrpc/` through the existing
`upstream-cache.ts` (the AppView already says `max-age=30`). It runs the same
mappers and the same facet renderer as the browser, then `sanitize`. So the
HTML is the same bytes on both sides.

### 8.2 What renders on the server

| page | SSR from the public AppView | why |
|---|---|---|
| Profile `/@alice.example.com` | yes: `getProfile` + `getAuthorFeed` | public |
| Thread `/@alice.example.com/<rkey>` | yes: `getPostThread` | public |
| A custom feed (phase 5) | yes: `getFeed` | public |
| A list feed (phase 5) | yes: `getListFeed` | public |
| Hashtag `/tags/<tag>` | **no** | it is `searchPosts`, which answers 403 without a token |
| Search | no | 403 without a token |
| Following (home) | no | needs a token (401) |
| Notifications, bookmarks | no | need a token |

The "no" pages render the shell and a splash, and the client fills them. That
is what Mastodon `/home` does today.

Viewer fields (`viewer.like`, `viewer.following`) are empty in SSR data. The
client fetches the same items with the reader's token after hydration and
merges them into the cache (`mergeStatus`). The first client render uses the
SSR data, so it matches.

Moderation in SSR uses the **default** label prefs (adult content off,
Bluesky's labeler only), because the server does not know the reader. After
hydration the client re-runs moderation with the reader's prefs. A reader who
turned adult content on sees the blur lift after load. That is a re-render
after hydration, which the rule allows.

### 8.3 `!no-unauthenticated`

An account with the `!no-unauthenticated` self-label has asked that logged-out
viewers not see it. The public AppView still returns its data. Caribou must
honor the request:

- SSR never renders that account's profile or posts. It renders the shell
  with "This account asked to be seen only by signed-in readers."
- A thread with such a post renders the post as that notice; the rest of the
  thread renders.
- The client renders it normally once a Bluesky account is active.

This needs an integration test (SSR output for a fixture account with the
label).

### 8.4 Telling the networks apart in a route

The `caribou.instance` cookie picks the Mastodon server for SSR today. For
Bluesky the route itself says which network:

- `/@alice` (no dot, no `@`): Mastodon, local to the cookie's server. A
  Mastodon username is letters, digits and `_` only.
- `/@alice@example.social`: Mastodon, a remote account.
- `/@alice.example.com` (a dot, no `@`): **Bluesky** handle.
- `/@did:plc:abc123` (starts with `did:`): **Bluesky** DID. The client
  replaces the URL with the handle once known.
- `/@alice.example.com/<rkey>`: a Bluesky post. An rkey is 13 base32 letters,
  a Mastodon id is digits. The handle already says Bluesky.

The hashtag page `/tags/<tag>` is the same route for both networks. It uses
the active account's network, and a signed-out reader gets Mastodon (the
cookie server), as now.

`pathAfterSwitch` and `readsCookieServer` learn these shapes.

---

## 9. Feature map

| Mastodon feature | Bluesky | day one? |
|---|---|---|
| Home timeline | Following feed, `app.bsky.feed.getTimeline` | yes |
| Local timeline | not available | — hidden |
| Public (federated) timeline | not available. Closest: a feed like "Discover" | — hidden (12.3, q. 4) |
| Custom feeds | `getFeed`; pinned feeds from prefs (`savedFeedsPrefV2`) | phase 5 |
| Status / post view | `getPostThread` (or `getPosts`) | yes |
| Thread (ancestors, descendants) | `getPostThread` with `depth` and `parentHeight` | yes |
| Reply | `app.bsky.feed.post` with `reply: { root, parent }` (URI + CID each) | yes |
| Who can reply | thread gate record (`app.bsky.feed.threadgate`) | phase 6 |
| Favourite | like record (`app.bsky.feed.like`); undo deletes that record | yes |
| Boost | repost record (`app.bsky.feed.repost`); undo deletes it | yes |
| Quote | post with `embed.record` or `embed.recordWithMedia`; post gate can turn quotes off | yes |
| Bookmark | `app.bsky.bookmark.createBookmark` / `deleteBookmark` / `getBookmarks`; private | yes |
| Follow | follow record (`app.bsky.graph.follow`). Public. | yes |
| Follow request (locked account) | not available. Every account is open. | — |
| Follow a hashtag | not available | — hidden |
| Hashtag timeline | `searchPosts` with `tag`, `sort=latest`. Needs a token. | phase 5 |
| Lists | curate lists (`app.bsky.graph.list`, purpose `curatelist`) + list item records. **Lists are public.** Members need not be followed. List feed: `getListFeed`. | phase 5 |
| List replies policy, exclusive lists | not available | — |
| Moderation lists | `modlist` lists to mute or block many at once | non-goal |
| Notifications | `listNotifications`; unread by `updateSeen` / `getUnreadCount`. Reasons: like, repost, follow, mention, reply, quote, and newer ones (like-via-repost, repost-via-repost, subscribed-post, verified, starterpack-joined). Unknown reasons are skipped. | yes |
| Grouped notifications | not on the server; group on the client (6.5) | yes |
| Search accounts | `searchActors` (token) | phase 5 |
| Search posts | `searchPosts` (token) | phase 5 |
| Search hashtags | not a separate thing; post search with `#` | phase 5 |
| Polls | not available | — hidden |
| Content warning (text) | not available; labels instead (7.4) | — label picker |
| Sensitive media | self-labels `sexual`, `nudity`, `porn`, `graphic-media` | yes |
| Visibility (unlisted, followers, direct) | not available; every post is public | — hidden |
| Edit | not available (records can be rewritten, but the AppView and apps do not support edits) | — hidden |
| Edit history | not available | — hidden |
| Delete | `deleteRecord` on the post | yes |
| Delete and redraft | delete + reopen compose with the text | yes |
| Pin a post | profile record `pinnedPost` | later |
| Media upload | `uploadBlob`, then reference in `embed.images`. Max 4 images. Alt text in the record. | yes |
| Video upload | the video service (`app.bsky.video.uploadVideo`, service auth) | phase 6 |
| Alt text edit after posting | not available (no edits) | — |
| Custom emoji | not available | — |
| DMs | `chat.bsky` through the PDS with `atproto-proxy`, needs `transition:chat.bsky` | non-goal |
| Mute | `app.bsky.graph.muteActor`; private | yes |
| Block | block record (`app.bsky.graph.block`); **public** | yes |
| Mutes and blocks lists in settings | `getMutes`, `getBlocks` | yes |
| Filters (keywords) | muted words (`mutedWordsPref`); applied by the client | phase 6 |
| Report | `com.atproto.moderation.createReport` | later |
| Push notifications | not part of atproto for third-party clients | — |
| Streaming | not available for a client (the firehose is for services) | — polling, as now |

Two privacy differences need a line of UI text:

- **Lists are public on Bluesky.** The create-list dialog says so.
- **Blocks are public on Bluesky.** The block confirm says so.

---

## 10. Security

- **Handle resolver (SSRF).** `GET /api/atproto/resolve-handle` makes our
  server fetch `https://<handle>/.well-known/atproto-did`, where the reader
  picks the host. Guard it: only valid handle syntax; HTTPS on port 443;
  resolve the host first and refuse private, loopback and link-local
  addresses; follow at most a few redirects and re-check each; 3-second
  timeout; read at most 2 KB; answer only with a DID. Rate limit per IP. Cache
  answers under 10 minutes (the spec's limit for auth flows).
- **Client metadata.** A static JSON response. `client_id` must exactly equal
  the URL. If `PUBLIC_BASE_URL` is wrong, sign-in fails with a clear error.
  Add it to the health check.
- **Token storage.** IndexedDB, keyed by DID. DPoP key non-extractable. Same
  XSS exposure class as today's localStorage token; the CSP work in v1 spec
  12.2 applies to both.
- **`sub` check.** The library does it. A test must prove that a mismatch
  fails sign-in (mock the resolver).
- **Rendering.** Facet HTML is built by escaping, and then DOMPurify runs.
  Only `http`/`https` links.
- **Moderation.** Use `@atproto/api`'s moderation functions. Do not
  hand-roll.
- **CSP `connect-src`.** Today it allows any host. Bluesky adds the PDS (any
  host), `public.api.bsky.app`, `api.bsky.app` and `video.bsky.app`. No
  change needed while `connect-src` stays open.

---

## 11. Mixed accounts

Yes: a reader can have both kinds signed in, side by side. The `users` map
holds both. One is active at a time.

| part | with a Mastodon account active | with a Bluesky account active |
|---|---|---|
| Nav rail | as today | Home (Following), Notifications, Search, Bookmarks, Lists, Feeds (phase 5). No Local, no Public. |
| Home | Mastodon home | Following feed |
| Compose | as today | 300 graphemes, 4 images, no visibility, no poll, label picker instead of CW text |
| A Bluesky profile or post | readable (public AppView, no actions) | readable, all actions |
| A Mastodon profile or post | all actions | readable through the cookie server, no actions |
| Account switcher | both kinds, each with a network mark | same |
| Settings → Account | Mastodon details | handle, DID, PDS host, "sign out" |

**Reading the other network.** A Mastodon reader who opens a Bluesky link
sees the post, read-only, with "Sign in with a Bluesky account to reply". The
reverse is the same. This needs no new code beyond the SSR path, which is
token-free.

**"Act as another account" (#131).** The account picker lists only accounts on
the post's network. A Mastodon account cannot like a Bluesky post. Between
Bluesky accounts it is simpler than Mastodon: an AT URI is the same for every
account, so there is no "resolve the post on the other server" step. The
cache rule from #131 still holds: the other account's like must not set
`favourited` in the current account's view.

**The status cache.** It is shared and holds both kinds. A Mastodon id is
digits; a Bluesky id is an AT URI. They do not collide. A switch reloads the
page today, so no cross-account viewer state stays behind.

---

## 12. Risks, unknowns, open questions

### 12.1 Risks

| risk | how we handle it |
|---|---|
| `@atproto/api` and `@atproto/oauth-client-browser` are large. They could double the client bundle. | Phase 0 measures it. Load the Bluesky client with a dynamic `import()` only when a Bluesky account is active or a Bluesky page opens. Mastodon-only readers pay nothing. |
| The two-week session cap annoys readers. | Silent re-auth where possible. A clear "sign in again" prompt that keeps the page. Option B (5.3) is the fallback. |
| Moderation done wrong shows harmful media. | Use the library's `moderatePost`. Tests with labeled fixtures. Default to "warn" when unsure. |
| `!no-unauthenticated` ignored in SSR. | Integration test (8.3). |
| One AppView, run by one company. | The AppView URL is config (`BLUESKY_APPVIEW`, default `https://api.bsky.app`, public `https://public.api.bsky.app`). |
| The public AppView rate-limits our server, since all logged-out SSR comes from one IP. | `upstream-cache.ts` with the AppView's `max-age`. Watch for 429 and fall back to client render. Rate limits are not documented; this is an unknown. |
| Lexicons change. New notification reasons, new embed types. | Map known types; skip or show a "not supported here" card for unknown ones. Never crash on an unknown `$type`. |
| Mastodon shapes hide a Bluesky difference and a screen does the wrong thing. | `capabilities` checks; component tests run with both fixtures. |
| `transition:generic` goes away. | Move to granular scopes (`repo:app.bsky.feed.post`, `blob:image/*`, `rpc:...`) when Bluesky's PDS supports them. The scope lives in one place: the client metadata. |
| Lit SSR and the atproto libraries in the server bundle. | The server needs only the mappers and the facet renderer, not the OAuth client. Keep those in a module with no browser-only imports. |
| Handle resolution through our server adds a dependency at sign-in. | Fallback: try `com.atproto.identity.resolveHandle` on `bsky.social` if our resolver fails, and say so in the privacy page. |

### 12.2 Unknowns to settle in phase 0

- The real bundle cost of the two libraries, gzipped.
- Whether `@atproto/oauth-client-browser` works with Vite and Lit SSR without
  patches (it touches `indexedDB` and `crypto.subtle` at import or at use?).
- Whether silent re-auth works with `bsky.social` from a third-party client.
- The public AppView's rate limit per IP.

### 12.3 Questions for the owner

Each has a recommended answer. A "yes" to all of them means this spec stands
as written.

1. **Public browser client (tokens in the browser, re-sign-in every two weeks)
   or confidential client (tokens on our server, every call proxied)?**
   Recommended: public browser client. It keeps the server out of the data
   path.
2. **One sign-in box that guesses the network, or two tabs ("Mastodon",
   "Bluesky")?** Recommended: two tabs. `alice.example.com` could be a Mastodon
   server or a Bluesky handle; guessing is fragile.
3. **Mastodon shapes plus `capabilities` (option a), or a new neutral model
   (option b)?** Recommended: (a), with the alias clean-up in phase 1 so (b)
   stays possible.
4. **Hide Local and Public for Bluesky, or map Public to Bluesky's
   "Discover" feed?** Recommended: hide. Feeds come in phase 5 and Discover is
   one of them.
5. **Profile route `/@alice.example.com`, or a prefix like `/bsky/...`?**
   Recommended: `/@alice.example.com`. It reads the way people write handles,
   and the dot rule is safe.
6. **Use `@atproto/api` (rich text, moderation, types) or write the XRPC calls
   by hand?** Recommended: `@atproto/api`, if phase 0 shows the cost is under
   about 100 KB gzipped behind a dynamic import. Moderation is the reason.
7. **Render signed-out Bluesky profiles and threads on our server at all?**
   Recommended: yes, honoring `!no-unauthenticated`. It is what makes a shared
   link work.
8. **Ship day one without video playback (thumbnail and link only)?**
   Recommended: yes. HLS is its own piece of work.

---

## 13. Phased plan

Each phase ships on its own and leaves main working. Sizes: **S** is a few
days, **M** about a week, **L** two weeks or more.

| phase | what ships | size | depends on |
|---|---|---|---|
| 0 | Spike and measure. No user-visible change. | S | — |
| 1 | Neutral seams in the Mastodon code. No user-visible change. | M | — |
| 2 | Bluesky sign-in and read-only Following, profile, thread. | L | 0, 1 |
| 3 | Bluesky SSR for profiles and threads. | M | 2 |
| 4 | Bluesky actions and compose. **Day one is here.** | L | 2 |
| 5 | Notifications, search, hashtags, feeds, lists. | L | 4 |
| 6 | Muted words, act as another account, video, gates, link cards. | M | 4 |

### Phase 0 — spike (S)

- Add `@atproto/api` and `@atproto/oauth-client-browser` on a branch. Build.
  Record the gzipped size of the lazy chunk.
- Sign in with a test account through the loopback client. Fetch the
  Following feed. Check Lit SSR still builds.
- Write the numbers into section 12.2 of this spec.

Ships: the measurements and a go/no-go on decision 6. No code merges unless
it is the metadata route.

### Phase 1 — seams (M)

- Import the type aliases from the client package everywhere (6.4 step 1).
- Caribou-owned aliases with the optional `bluesky` field (6.4 step 2).
- `capabilities` on `CaribouClient`; the Mastodon client fills it.
- Nav rail, compose and status card read capabilities instead of assuming
  Mastodon.
- Mutations take the status or account, not only the id.
- `UserSession` gains `network` (defaults to `mastodon`).

Ships: a refactor with no behavior change. Tests stay green.

### Phase 2 — sign-in and reading (L)

- `packages/bluesky-client`: identity, OAuth wrapper, `CaribouClient` with
  read methods, mappers, facet renderer, embeds (images, external, record,
  recordWithMedia; video as thumbnail), moderation.
- Server: `oauth/client-metadata.json`, `api/atproto/resolve-handle` with the
  SSRF guard.
- Sign-in: the Bluesky tab, `/signin/bluesky`, session restore, sign-out.
- Switcher network marks; `pathAfterSwitch` rules.
- Following feed with polling; profile tabs; thread view. Client render only.
- Behind a setting or a query flag until phase 4, so readers do not meet a
  read-only network.

### Phase 3 — SSR (M)

- `server/lib/bluesky-public.ts`; route detection (8.4); profile and thread
  SSR; `!no-unauthenticated` handling; default-prefs moderation in SSR.
- Integration tests on SSR output; e2e hydration test for a Bluesky thread
  (fixture server, not the live AppView, so CI does not hit Bluesky).

### Phase 4 — actions and compose (L)

- Like, repost, bookmark, follow, mute, block, with rollback.
- Compose: graphemes count, facets, images and alt text, reply, quote, label
  picker, delete and redraft.
- Remove the flag. **First Bluesky release.**

### Phase 5 — notifications and discovery (L)

- Notifications with client grouping and the unread badge.
- Search (people, posts) and hashtag pages through search.
- Pinned feeds as tabs on Home, from the reader's prefs.
- Lists: view, create, add and remove members, list feed, the "lists are
  public" note.

### Phase 6 — the rest (M)

- Muted words in the filters screen.
- #131 between Bluesky accounts.
- Video playback.
- Thread gate and post gate in compose.
- Link cards in compose.

### 13.1 Issues to file

One issue each. Titles as they would be filed:

1. `bluesky: spike — measure atproto client bundle and loopback sign-in` (S, phase 0)
2. `refactor: import Status/Account/Relationship/List types from the client package` (S, phase 1)
3. `refactor: Caribou-owned status and account types with a network extension` (S, phase 1)
4. `refactor: CaribouClient capabilities; screens hide what a network lacks` (M, phase 1)
5. `refactor: mutations take the status or account, not only its id` (S, phase 1)
6. `state: UserSession carries a network` (S, phase 1)
7. `bluesky: client package with read methods and mappers` (L, phase 2)
8. `bluesky: facets to HTML renderer` (S, phase 2)
9. `bluesky: embeds — images, external, record, recordWithMedia, video thumbnail` (M, phase 2)
10. `bluesky: labels and moderation with the reader's prefs` (M, phase 2)
11. `server: atproto client metadata and handle resolver with SSRF guard` (S, phase 2)
12. `bluesky: sign-in, session restore and sign-out (public browser client)` (M, phase 2)
13. `bluesky: account switcher network marks and switch rules` (S, phase 2)
14. `bluesky: Following feed, profile and thread views` (M, phase 2)
15. `bluesky: SSR for profiles and threads from the public AppView` (M, phase 3)
16. `bluesky: honor !no-unauthenticated in SSR` (S, phase 3)
17. `bluesky: like, repost, bookmark, follow, mute, block` (M, phase 4)
18. `bluesky: compose — graphemes, facets, images, reply, quote, labels` (M, phase 4)
19. `bluesky: delete and redraft` (S, phase 4)
20. `bluesky: notifications with client-side grouping` (M, phase 5)
21. `bluesky: search and hashtag pages` (M, phase 5)
22. `bluesky: pinned feeds on Home` (M, phase 5)
23. `bluesky: lists (curate lists) with the public-list note` (M, phase 5)
24. `bluesky: muted words in the filters screen` (S, phase 6)
25. `bluesky: act as another Bluesky account (#131)` (S, phase 6)
26. `bluesky: video playback` (M, phase 6)
27. `bluesky: thread gate and post gate in compose` (S, phase 6)
28. `bluesky: link cards in compose` (S, phase 6)
