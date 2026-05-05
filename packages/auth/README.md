# @beatzball/caribou-auth

> Pure helpers for the Mastodon OAuth client-credentials + authorize flow.

**Status:** Coupled by design — Mastodon-specific OAuth conventions baked in.

## Purpose

The four small modules here handle the parts of Mastodon's OAuth dance that
are pure functions: building the authorize URL, generating an opaque CSRF
state token, parsing the post-callback URL fragment, and minting the
canonical `user@host` key Caribou uses to identify a session. Everything
that talks to a server lives elsewhere (the SSR routes do the
`POST /api/v1/apps` and the token exchange); this package is the glue
that's the same regardless of who runs it.

## Position in the stack

- **Depends on:** nothing — only browser globals (`crypto`, `URL`, `URLSearchParams`)
- **Depended on by:** `@beatzball/caribou-mastodon-client` (UserKey type),
  `@beatzball/caribou-state` (UserKey + isUserKey), `apps/caribou-elena`
  (signin flow uses every export)
- **Boundary it owns:** the deterministic, network-free pieces of OAuth.
  No fetch calls, no storage, no side effects beyond `crypto.getRandomValues`.

## Public API

- `UserKey` — branded template-literal type `` `${string}@${string}` ``
- `toUserKey(handle, server)` — construct a `UserKey`
- `isUserKey(value)` — type guard, validates shape (non-empty handle, non-empty server, exactly one `@`)
- `parseUserKey(key)` — split into `{ handle, server }`; throws on invalid
- `generateState()` — 32 bytes from `crypto.getRandomValues` → unpadded base64url
- `buildAuthorizeUrl({ server, clientId, redirectUri, scope, state })` — composes the `/oauth/authorize` URL
- `parseCallbackFragment(fragment)` — pulls `token`, `server`, `userKey`, `vapidKey` out of a `#…` callback hash; returns `null` if any required field is missing or malformed

## How it works

**`force_login=true` is non-negotiable.** `buildAuthorizeUrl` sets it
unconditionally because Mastodon will otherwise re-authorize the *active
browser-session* account silently if the user has already approved the
OAuth app. The visible symptom: signing out of Caribou and signing in
again with the same domain transparently puts the previous account back.
Setting `force_login` forces Mastodon's account picker every time, which
is what users expect when they explicitly click "sign in".

**Base64url without padding.** `generateState()` produces a token safe
to drop straight into a URL query — Mastodon echoes it back unchanged in
the callback, so any `+`/`/`/`=` characters would round-trip through
URL-encoding and break exact-string comparison.

**`parseCallbackFragment` returns `null` on any defect.** Missing field,
malformed user-key, or empty fragment — the caller gets `null` and
should redirect to signin. There's no partial-success path. This keeps
the failure mode at one boundary (the route handler that calls it)
instead of fanning out into validation logic everywhere downstream.

## Gotchas

- **Server input is sloppy on purpose.** `buildAuthorizeUrl` strips
  `https?://` from the server arg, so a user who pastes
  `https://fosstodon.org` into a signin form gets the same URL as
  `fosstodon.org`. But it doesn't strip trailing slashes or paths —
  `fosstodon.org/` will produce `https://fosstodon.org//oauth/authorize`.
  Caller is expected to clean the host first.
- **`generateState` requires Web Crypto.** `crypto.getRandomValues` has
  no fallback — server-side calls must run in Node 19+ (where `crypto`
  is global) or arrange a polyfill. The base64 encoding *does* fall
  back: it prefers `btoa` (browsers), drops to `Buffer.from(...).toString('base64')`
  in Node, so the encoding step works in either environment. Tests use
  happy-dom, which provides both.
- **`UserKey` does not validate domain shape.** `isUserKey` only checks
  for `handle@host` with both halves non-empty. `foo@`, `@bar`, and
  `foo@bar@baz` are rejected; `foo@!` is accepted. Domain syntax checks
  belong upstream of this package.

## Externalization potential

**Coupled by design.** The Mastodon-isms — `force_login=true`, the
`#token=…&server=…&userKey=…&vapidKey=…` callback fragment shape,
`acct`-style `user@host` keys — are everywhere. A generic OAuth helper
would need to strip these, at which point you have a worse `oauth4webapi`.
The value is in matching the Mastodon callback contract exactly; lifting
it elsewhere would mean re-deriving that contract from scratch.

## See also

- `apps/caribou-elena/server/api/oauth/*` — the SSR routes that
  pair with this package (token exchange, app registration)
- `packages/state/src/users.ts` — consumes `UserKey` for session storage
