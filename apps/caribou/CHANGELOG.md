# caribou-app

## 0.3.1

### Patch Changes

- [#75](https://github.com/beatzball/caribou/pull/75) [`cbaf05a`](https://github.com/beatzball/caribou/commit/cbaf05ac7ec2f2ce06fa5e27bd8f1793ba48ae87) Thanks [@beatzball](https://github.com/beatzball)! - Fix compose and the post cards for a real sign-in. Sign-in stores the session with `account: null`, and the new code read the account without a check: every post card threw on load, and New post and Reply did nothing. The cards, the profile header and the compose dialog now work without the account. The app also loads the account in the background (`verify_credentials`) and stores it, so compose then starts from the account's default visibility.

- Updated dependencies [[`cbaf05a`](https://github.com/beatzball/caribou/commit/cbaf05ac7ec2f2ce06fa5e27bd8f1793ba48ae87), [`cbaf05a`](https://github.com/beatzball/caribou/commit/cbaf05ac7ec2f2ce06fa5e27bd8f1793ba48ae87)]:
  - @beatzball/caribou-mastodon-client@0.2.1
  - @beatzball/caribou-state@0.2.1

## 0.3.0

### Minor Changes

- [#72](https://github.com/beatzball/caribou/pull/72) [`c5b45e3`](https://github.com/beatzball/caribou/commit/c5b45e36ad1d82e2f122d9847ca6bce0941329e3) Thanks [@beatzball](https://github.com/beatzball)! - Add the compose dialog. Open it with the New post button in the nav rail,
  the `n` key, or a `caribou:compose` event (reply mode shows the post,
  prefills the mentions and keeps its visibility). It starts from the
  account's default visibility, counts characters the way Mastodon does
  (grapheme clusters, 23 per link) against the instance limit, has a content warning,
  visibility, and media with alt text, posts with Ctrl/Cmd+Enter, saves all alt
  text before it posts, and keeps the draft on Esc or on an error. A draft
  stays with the account it was started for.

- [#71](https://github.com/beatzball/caribou/pull/71) [`a46114c`](https://github.com/beatzball/caribou/commit/a46114c9a3177ba516911a02bc68ad2b066682ab) Thanks [@beatzball](https://github.com/beatzball)! - Follow and unfollow from a profile. The profile header shows Follow, Following (Unfollow under the pointer or focus) or Requested, and "Follows you". The button appears after mount for a signed-in reader and never on the reader's own profile. On a profile from another instance the header first looks the account up on the reader's server; when that server does not know it, there is no button.

- [#70](https://github.com/beatzball/caribou/pull/70) [`1541e71`](https://github.com/beatzball/caribou/commit/1541e716563a98ff0b7b685842aa9462e78d499a) Thanks [@beatzball](https://github.com/beatzball)! - Every post now has a reply, boost, favourite and bookmark button, with counts.
  They work when you are signed in to the instance the post came from; otherwise
  they are dimmed and say "Sign in to …". Boost is off for direct posts and for
  other people's followers-only posts. Reply opens compose through the
  `caribou:compose` event. A new toaster shows `caribou:toast` messages, for
  example when an action fails and is rolled back. Info messages close after
  5 seconds; errors stay until you close them.

### Patch Changes

- Updated dependencies [[`c5b45e3`](https://github.com/beatzball/caribou/commit/c5b45e36ad1d82e2f122d9847ca6bce0941329e3), [`c5b45e3`](https://github.com/beatzball/caribou/commit/c5b45e36ad1d82e2f122d9847ca6bce0941329e3), [`a46114c`](https://github.com/beatzball/caribou/commit/a46114c9a3177ba516911a02bc68ad2b066682ab), [`a46114c`](https://github.com/beatzball/caribou/commit/a46114c9a3177ba516911a02bc68ad2b066682ab), [`1541e71`](https://github.com/beatzball/caribou/commit/1541e716563a98ff0b7b685842aa9462e78d499a), [`1541e71`](https://github.com/beatzball/caribou/commit/1541e716563a98ff0b7b685842aa9462e78d499a)]:
  - @beatzball/caribou-mastodon-client@0.2.0
  - @beatzball/caribou-state@0.2.0

## 0.2.4

### Patch Changes

- [#44](https://github.com/beatzball/caribou/pull/44) [`fce40c5`](https://github.com/beatzball/caribou/commit/fce40c5668f7ab00414d0f1e686b1f3f1b50496d) Thanks [@beatzball](https://github.com/beatzball)! - Raise the `vite` floor to `^8.1.6` to match litro 0.17.4, which raised its own floor for security advisories. The live SSR thread test now picks a post that really is a reply with a visible parent, instead of the newest entry on the replies tab. The litro patch's comments now say the root index maps to `page-index`; the patched code is unchanged.

## 0.2.3

### Patch Changes

- [#42](https://github.com/beatzball/caribou/pull/42) [`f8af434`](https://github.com/beatzball/caribou/commit/f8af43442f123455f009ff9dd9c7f608ea5d94fa) Thanks [@beatzball](https://github.com/beatzball)! - Bump `@beatzball/litro` to 0.17.4. Litro now maps `pages/@[handle].ts` to `/@:handle` itself, so the local patch keeps only the change that makes `pages/index.ts` register `page-index` instead of `page-home`.

## 0.2.2

### Patch Changes

- [#39](https://github.com/beatzball/caribou/pull/39) [`c37daa3`](https://github.com/beatzball/caribou/commit/c37daa34b1f7dd072eab8b20f56cd73d30cf021c) Thanks [@beatzball](https://github.com/beatzball)! - Keep "Older posts" a plain link on a profile from another instance. The server fetches `/@alice@other.host` from `other.host`, so its account and status ids belong to that host. A client signed in elsewhere paged them against its own server and got another account's posts or a 404. `<caribou-profile>` now takes an `instance` attribute from the page and pages in place only when the signed-in client's server is that host; otherwise the link leads to the next server-rendered page, as it does without JavaScript.

- [#40](https://github.com/beatzball/caribou/pull/40) [`788968e`](https://github.com/beatzball/caribou/commit/788968ea37ce6ded5f61c44572a58bbfdba67bba) Thanks [@beatzball](https://github.com/beatzball)! - Keep the server-only sanitizer out of the client bundle. The pages reach
  `server/lib/sanitize.ts` with a dynamic `import()`, so the browser never
  downloaded it, but Vite still emitted the jsdom-backed module as a 2.7 MB
  lazy chunk in `dist/client/assets`. The client build now resolves it to a
  throwing stub, the same way it already stubs `unstorage`; the server and the
  unit tests keep the real module.
- Updated dependencies [[`23d7908`](https://github.com/beatzball/caribou/commit/23d7908bd1a7c62015f33c4e2047185fb2ed4b08), [`23d7908`](https://github.com/beatzball/caribou/commit/23d7908bd1a7c62015f33c4e2047185fb2ed4b08)]:
  - @beatzball/caribou-ui-headless@0.2.3
  - @beatzball/caribou-design-tokens@0.1.1

## 0.2.1

### Patch Changes

- [#36](https://github.com/beatzball/caribou/pull/36) [`ac3f091`](https://github.com/beatzball/caribou/commit/ac3f091b5ece96ed609495480c8ad931652a9915) Thanks [@beatzball](https://github.com/beatzball)! - The hydration e2e spec also checks that every Lit element class on the page carries the hydration support (`defer-hydration` in `observedAttributes`), which names the unpatched classes when the bootstrap breaks.

- [#35](https://github.com/beatzball/caribou/pull/35) [`ecd77b8`](https://github.com/beatzball/caribou/commit/ecd77b8a14ee4205e6348213cd136f46cc47206c) Thanks [@beatzball](https://github.com/beatzball)! - An unmatched path now answers with status 404, not 200. The 404 page is unchanged; the path it echoes is HTML-escaped.

## 0.2.0

### Minor Changes

- [#29](https://github.com/beatzball/caribou/pull/29) [`94762db`](https://github.com/beatzball/caribou/commit/94762db73f043fecff07471a3b3254549eed1bac) Thanks [@beatzball](https://github.com/beatzball)! - New app: Caribou on Litro's Lit adapter (`@beatzball/litro` 0.17.2, Vite 8), built beside `caribou-elena` so the two can be compared route by route before the deploy switches over. This release carries the scaffold, the server routes, the app shell with both rails, the landing and sign-in flow, and the static pages.

- [#31](https://github.com/beatzball/caribou/pull/31) [`0651d89`](https://github.com/beatzball/caribou/commit/0651d89bde1fbe897072d2184acb3b305a996edc) Thanks [@beatzball](https://github.com/beatzball)! - Profile and thread on the Lit app: `/@handle` and `/@handle/:statusId`. The thread now arrives from the server fully rendered — ancestors, the focused post, then replies. Profile tab links and the "Older posts" link keep their `@`, and "Older posts" stays a working link for a reader who is not signed in.

- [#32](https://github.com/beatzball/caribou/pull/32) [`11ffdf8`](https://github.com/beatzball/caribou/commit/11ffdf867b0dbfdb685b3e50d8fe89beabc1ef56) Thanks [@beatzball](https://github.com/beatzball)! - `caribou-app` is now the only Caribou app. The Elena app (`caribou-elena`), the `elena-morph-spec` package and the 499-line patch on `@beatzball/litro` 0.9.1 are removed. The root `dev`, `preview` and `test:e2e` scripts, CI and the Docker smoke test all point at `apps/caribou`.

- [#30](https://github.com/beatzball/caribou/pull/30) [`b328bf6`](https://github.com/beatzball/caribou/commit/b328bf61790a0f6e46b9fa0140169dd9278066c8) Thanks [@beatzball](https://github.com/beatzball)! - Timelines on the Lit app: `/home`, `/local` and `/public`, with the status card, the timeline and the new-posts banner. `/local` and `/public` arrive from the server with their cards rendered, and the "Older posts" link stays a working link for a reader who is not signed in.

### Patch Changes

- Updated dependencies [[`11ffdf8`](https://github.com/beatzball/caribou/commit/11ffdf867b0dbfdb685b3e50d8fe89beabc1ef56)]:
  - @beatzball/caribou-ui-headless@0.2.2
