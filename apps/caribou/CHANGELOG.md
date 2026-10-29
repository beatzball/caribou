# caribou-app

## 0.7.0

### Minor Changes

- [#115](https://github.com/beatzball/caribou/pull/115) [`f06f20c`](https://github.com/beatzball/caribou/commit/f06f20cdba6f0d0ad57ae9ad3baaddcd718d764f) Thanks [@beatzball](https://github.com/beatzball)! - A post's author is now a link. A click on the avatar, the display name or the @handle opens the author's profile inside Caribou, without a full page load. On a boost, the booster's name in the "boosted" line opens the booster's profile. The author block is one real link: middle-click, Cmd-click, copy-link and no-JavaScript all work, a keyboard user tabs to it once, and a screen reader hears the display name and handle.

- [#116](https://github.com/beatzball/caribou/pull/116) [`6f04cc2`](https://github.com/beatzball/caribou/commit/6f04cc22e89869e3b18eb81a22e235df8ea087ed) Thanks [@beatzball](https://github.com/beatzball)! - Posts now show their media under the text: images, video, GIFs (gifv) and audio. One item is full width; two to four share a grid. Each box keeps its size before the file arrives, so the list does not jump. A click on an image opens it large in a lightbox (Esc or Close shuts it, and focus goes back to the image). Media with a description has an ALT button that shows the text. A GIF plays muted on a loop; a click or Enter on it pauses and plays it again. It waits, paused, when the reader asks for reduced motion. Media on a sensitive post stays hidden until the reader clicks "Show sensitive media". Boosts show the boosted post's media, and the server render of `/local` and `/public` includes the media.

## 0.6.1

### Patch Changes

- [#111](https://github.com/beatzball/caribou/pull/111) [`a94f720`](https://github.com/beatzball/caribou/commit/a94f720249286c74ea70ef1b14a7efd5aa9daf43) Thanks [@beatzball](https://github.com/beatzball)! - Link-hint tools such as Vimium now show hints on icon buttons: Reply, Boost, Favourite and Bookmark on each post, the compose toolbar, and a toast's Dismiss. A hit test at the button's centre used to land inside the icon's own shadow root, so the tool decided the button was covered and skipped it. The icon no longer takes pointer hits; clicks, hover, tooltips and keyboard use are unchanged.

## 0.6.0

### Minor Changes

- [#102](https://github.com/beatzball/caribou/pull/102) [`1bf7f0a`](https://github.com/beatzball/caribou/commit/1bf7f0ae0aaea70f1175bae84d363295a4274809) Thanks [@beatzball](https://github.com/beatzball)! - Add a `/bookmarks` page and a Bookmarks item in the nav rail. It lists the
  signed-in user's bookmarks with infinite scroll and says "No bookmarks yet."
  when there are none. Signed out, it shows the sign-in placeholder. Removing a
  bookmark on this page keeps the card, with its button off, so a mistaken tap
  can be undone.

- [#106](https://github.com/beatzball/caribou/pull/106) [`0f8b92f`](https://github.com/beatzball/caribou/commit/0f8b92f06c8bc97e7f465985fa08b0d12d3270c7) Thanks [@beatzball](https://github.com/beatzball)! - The phone nav bar (below 768px) now holds Home, Local, New post, Profile and a More button, so every item fits at 320px. More opens a small menu with Public, Bookmarks and Sign out. It is a native popover: it opens, closes on Escape or a tap outside, and signs out without JavaScript. The new `<caribou-menu>` element builds it. The rail's order is now the same at every width, with New post just above Profile.

- [#103](https://github.com/beatzball/caribou/pull/103) [`20b0f9c`](https://github.com/beatzball/caribou/commit/20b0f9c708b9dde27c2078d611aedfb3992d2f45) Thanks [@beatzball](https://github.com/beatzball)! - A `/notifications` page lists mentions, favourites, boosts, follows, follow requests, ended polls and edits, with an All / Mentions filter. A type the app does not know shows a plain line instead of breaking the list. The list checks for new notifications every 60 seconds while the tab is visible. The nav rail has a Notifications item after Local, also in the phone bar, with an unread count, which clears when the page is shown; screen readers hear "Notifications, 3 unread".

- [#104](https://github.com/beatzball/caribou/pull/104) [`3d3a08f`](https://github.com/beatzball/caribou/commit/3d3a08f1e82ff2bf61b196772403623b5964e098) Thanks [@beatzball](https://github.com/beatzball)! - Going back to Home, Local, Public, a profile or a thread is instant. The page shows what it showed last time at once, then checks for changes in the background. New posts go to the "N new posts" banner, so the list does not move; new replies in a thread appear at the end, and the next visit keeps that order; edits and counts update in place. Back lands where you were. A page older than five minutes says "Updating…" while it refreshes. A failed refresh or page load keeps the list on screen with a Retry button, and does not retry by itself. The cache is cleared when the active account changes.

### Patch Changes

- Updated dependencies [[`1bf7f0a`](https://github.com/beatzball/caribou/commit/1bf7f0ae0aaea70f1175bae84d363295a4274809), [`20b0f9c`](https://github.com/beatzball/caribou/commit/20b0f9c708b9dde27c2078d611aedfb3992d2f45), [`20b0f9c`](https://github.com/beatzball/caribou/commit/20b0f9c708b9dde27c2078d611aedfb3992d2f45), [`3d3a08f`](https://github.com/beatzball/caribou/commit/3d3a08f1e82ff2bf61b196772403623b5964e098), [`1bf7f0a`](https://github.com/beatzball/caribou/commit/1bf7f0ae0aaea70f1175bae84d363295a4274809)]:
  - @beatzball/caribou-mastodon-client@0.4.0
  - @beatzball/caribou-state@0.3.0

## 0.5.2

### Patch Changes

- [#99](https://github.com/beatzball/caribou/pull/99) [`3536af0`](https://github.com/beatzball/caribou/commit/3536af08e3945439ef458b4cda8ce2f23aa6921b) Thanks [@beatzball](https://github.com/beatzball)! - A request for `/_litro/app.js` with any query but exactly this build's `?v=` is now answered `no-store`. During a rolling deploy both builds answer for a short time, so a browser can get the new HTML and then this build's entry from the other container. It still gets a working file, but no longer keeps it under the other build's URL. The bare entry and exactly this build's `?v=` stay `no-cache` with an ETag.

## 0.5.1

### Patch Changes

- [#97](https://github.com/beatzball/caribou/pull/97) [`179ba8a`](https://github.com/beatzball/caribou/commit/179ba8a7fe1901e1626555a42f360ca45772f787) Thanks [@beatzball](https://github.com/beatzball)! - A deploy no longer leaves browsers on the old build. `/_litro/app.js` was cached for a year although its name never changes, so a browser that had it kept loading the old app, whose page chunks the new image no longer has: a tap on Local or Public did nothing until the cache let go. The page now loads the entry as `app.js?v=<build>`, the bare entry is served `no-cache`, and no chunk imports the entry any more. A tab that stays open across a deploy loads the page in full when a page chunk is missing, once.

## 0.5.0

### Minor Changes

- [#94](https://github.com/beatzball/caribou/pull/94) [`df84c76`](https://github.com/beatzball/caribou/commit/df84c76c4a45798b82b69163fafb8f0594f2c364) Thanks [@beatzball](https://github.com/beatzball)! - Status card actions (reply, boost, favourite, bookmark) now use `<caribou-icon-button>`, and the boost attribution icon uses `<caribou-icon>`. Behaviour is the same: signed out, each action stays focusable with its "Sign in to…" hint. Signed in, the tooltip names the action.

  `<caribou-icon-button>` gains `soft-disabled` (stays in the tab order with `aria-disabled`; clicks are swallowed), `hint` (a tooltip in place of the label), `description` (read after the name, from the button's own shadow root) and `variant="ghost"` (borderless and muted; `--caribou-icon-button-pressed-fg` sets the pressed colour). `<caribou-icon>` gains `filled` and `--caribou-icon-fill`.

### Patch Changes

- [#88](https://github.com/beatzball/caribou/pull/88) [`bf683b7`](https://github.com/beatzball/caribou/commit/bf683b76203b9b41276b88054608961789d27811) Thanks [@beatzball](https://github.com/beatzball)! - The compose dialog's Cancel, Retry and Remove buttons now use the shared `<caribou-button>`, so they match Post in size, focus ring and disabled look. The dialog's own button styles are gone.

- [#95](https://github.com/beatzball/caribou/pull/95) [`3abb312`](https://github.com/beatzball/caribou/commit/3abb312d5f3590a83a2da631b0fb5a3f0e46f773) Thanks [@beatzball](https://github.com/beatzball)! - Mobile nav bar answers a tap at once. The tapped item gets a pending look
  while the next page loads; `aria-current` stays on the page that is shown.
  Bar items are 44px square, and the bar keeps clear of the iPhone home
  indicator (`viewport-fit=cover` with safe-area insets).

- [#89](https://github.com/beatzball/caribou/pull/89) [`0fec44c`](https://github.com/beatzball/caribou/commit/0fec44c4d78d2fc9b7396f30b494e5550600521f) Thanks [@beatzball](https://github.com/beatzball)! - The nav rail draws its icons with `<caribou-icon>`, and New post is a
  `<caribou-button variant="primary">`. The pen icon moves into the shared icon
  set as `squarePen`. Below desktop width the rail's labels are clipped instead
  of `display: none`, so the nav links, New post and Sign out keep their
  accessible names where only the icons show.

- [#92](https://github.com/beatzball/caribou/pull/92) [`3ba56a9`](https://github.com/beatzball/caribou/commit/3ba56a9b5aa4c851d8d0a699c0ff395fa4d46fe7) Thanks [@beatzball](https://github.com/beatzball)! - A mention in a post now opens Caribou's own profile page for that account, without a full page load. The post HTML is unchanged, so without JavaScript, or with a modifier key or middle click, the link still goes to the account's instance. Hashtags and other links keep their old behaviour.

  Links in a post or a bio that open a new window now always carry `rel="noopener noreferrer"`, on the server and in the browser, even when the author's server left it out.

- [#90](https://github.com/beatzball/caribou/pull/90) [`b013d78`](https://github.com/beatzball/caribou/commit/b013d78dbe4cf5245c3b6b0c9ba1399df16cf573) Thanks [@beatzball](https://github.com/beatzball)! - Clicking a post's time now opens its thread without a full page load. The status card's permalink is a `<litro-link>`, so the server still sends a real link that works without JavaScript, and a modifier click still opens a new tab.

- [#91](https://github.com/beatzball/caribou/pull/91) [`8cfd930`](https://github.com/beatzball/caribou/commit/8cfd9308d577caa705350cb5f51bc8065f70effd) Thanks [@beatzball](https://github.com/beatzball)! - Move three more buttons onto the shared controls. The toaster's Dismiss is a
  `<caribou-icon-button>`; the profile Follow button is a `<caribou-button>`,
  primary for "Follow" and secondary for "Following" and "Requested", and still
  reads "Unfollow" under the pointer or keyboard focus; the landing page's Sign
  in is a primary submit `<caribou-button>` that shows a spinner while it
  connects. The README notes that `<caribou-button>` cannot submit a form
  without JavaScript.
- Updated dependencies [[`3ba56a9`](https://github.com/beatzball/caribou/commit/3ba56a9b5aa4c851d8d0a699c0ff395fa4d46fe7)]:
  - @beatzball/caribou-mastodon-client@0.3.0
  - @beatzball/caribou-state@0.2.3

## 0.4.1

### Patch Changes

- [#86](https://github.com/beatzball/caribou/pull/86) [`9b13b5f`](https://github.com/beatzball/caribou/commit/9b13b5f5ea0ea8e65c3c06778fcac57c4fd51ebe) Thanks [@beatzball](https://github.com/beatzball)! - A stale 401 no longer signs out the current session. The 401 handler removes only the session that got the 401, and only while it still has the same token. It redirects to `/` with the "session expired" banner only when that session was the active one. A 401 for another stored session, or for a replaced token, changes nothing on screen, and no longer blocks a later real 401.

- Updated dependencies [[`9b13b5f`](https://github.com/beatzball/caribou/commit/9b13b5f5ea0ea8e65c3c06778fcac57c4fd51ebe)]:
  - @beatzball/caribou-state@0.2.2

## 0.4.0

### Minor Changes

- [#84](https://github.com/beatzball/caribou/pull/84) [`74f0e25`](https://github.com/beatzball/caribou/commit/74f0e257838d5f814879499880b48321563268c8) Thanks [@beatzball](https://github.com/beatzball)! - Add the first shared UI web components: `<caribou-button>` (primary,
  secondary and danger variants, a loading state, form submit through
  `ElementInternals`), `<caribou-icon-button>` (required label as accessible
  name and tooltip, optional pressed state and count) and `<caribou-icon>`.
  The compose dialog's media, content-warning and Post buttons now use them.

## 0.3.2

### Patch Changes

- [#81](https://github.com/beatzball/caribou/pull/81) [`557fca4`](https://github.com/beatzball/caribou/commit/557fca48d623b081a5033b9cb589d115a75230c4) Thanks [@beatzball](https://github.com/beatzball)! - The compose toolbar now uses icon buttons, like Mastodon's composer. The "CW" text button is a warning icon named "Content warning", with a tooltip and a clear pressed look. "Add media" is an image icon named "Add images or video"; the file picker still opens with Enter or Space. All toolbar buttons share one hit area, larger on touch screens.

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
