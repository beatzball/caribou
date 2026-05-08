# @beatzball/caribou-auth

## 0.0.2

### Patch Changes

- [`8b4d3e1`](https://github.com/beatzball/caribou/commit/8b4d3e100088c798ab6a94bf36421c4b2d06197c) Thanks [@beatzball](https://github.com/beatzball)! - `buildAuthorizeUrl()` now sets `force_login=true` on the Mastodon `/oauth/authorize` URL.

  Without it, an active Mastodon session cookie + a previously-authorized OAuth app caused the authorize endpoint to silently auto-redirect with a token for the existing session. Consumers (such as caribou-elena) that clear local state on sign-out couldn't actually switch to a different Mastodon account on the same instance — the picker round-tripped to the OAuth flow and came back with the same account. Forcing `force_login=true` makes Mastodon always show the login/account picker.

## 0.0.1

### Patch Changes

- [#3](https://github.com/beatzball/caribou/pull/3) [`becf5d0`](https://github.com/beatzball/caribou/commit/becf5d0c55b79af4915e00f022d7a6073f950bdf) Thanks [@beatzball](https://github.com/beatzball)! - Initial @beatzball/caribou-auth: UserKey helpers, generateState, buildAuthorizeUrl, parseCallbackFragment.
