# caribou-app

## 0.2.0

### Minor Changes

- [#29](https://github.com/beatzball/caribou/pull/29) [`94762db`](https://github.com/beatzball/caribou/commit/94762db73f043fecff07471a3b3254549eed1bac) Thanks [@beatzball](https://github.com/beatzball)! - New app: Caribou on Litro's Lit adapter (`@beatzball/litro` 0.17.2, Vite 8), built beside `caribou-elena` so the two can be compared route by route before the deploy switches over. This release carries the scaffold, the server routes, the app shell with both rails, the landing and sign-in flow, and the static pages.

- [#31](https://github.com/beatzball/caribou/pull/31) [`0651d89`](https://github.com/beatzball/caribou/commit/0651d89bde1fbe897072d2184acb3b305a996edc) Thanks [@beatzball](https://github.com/beatzball)! - Profile and thread on the Lit app: `/@handle` and `/@handle/:statusId`. The thread now arrives from the server fully rendered — ancestors, the focused post, then replies. Profile tab links and the "Older posts" link keep their `@`, and "Older posts" stays a working link for a reader who is not signed in.

- [#32](https://github.com/beatzball/caribou/pull/32) [`11ffdf8`](https://github.com/beatzball/caribou/commit/11ffdf867b0dbfdb685b3e50d8fe89beabc1ef56) Thanks [@beatzball](https://github.com/beatzball)! - `caribou-app` is now the only Caribou app. The Elena app (`caribou-elena`), the `elena-morph-spec` package and the 499-line patch on `@beatzball/litro` 0.9.1 are removed. The root `dev`, `preview` and `test:e2e` scripts, CI and the Docker smoke test all point at `apps/caribou`.

- [#30](https://github.com/beatzball/caribou/pull/30) [`b328bf6`](https://github.com/beatzball/caribou/commit/b328bf61790a0f6e46b9fa0140169dd9278066c8) Thanks [@beatzball](https://github.com/beatzball)! - Timelines on the Lit app: `/home`, `/local` and `/public`, with the status card, the timeline and the new-posts banner. `/local` and `/public` arrive from the server with their cards rendered, and the "Older posts" link stays a working link for a reader who is not signed in.

### Patch Changes

- Updated dependencies [[`11ffdf8`](https://github.com/beatzball/caribou/commit/11ffdf867b0dbfdb685b3e50d8fe89beabc1ef56)]:
  - @beatzball/caribou-ui-headless@0.2.2
