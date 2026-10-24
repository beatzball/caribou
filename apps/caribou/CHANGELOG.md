# caribou-app

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
