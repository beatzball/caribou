# caribou-app

## 0.10.6

### Patch Changes

- [#209](https://github.com/beatzball/caribou/pull/209) [`a789261`](https://github.com/beatzball/caribou/commit/a789261653998910ec7d5ae03cb328e4bf180f45) Thanks [@beatzball](https://github.com/beatzball)! - The nav rail, compose dialog and status card read the active client's capabilities. A control the network does not have is hidden. No behavior change for Mastodon.

- [#204](https://github.com/beatzball/caribou/pull/204) [`c553d3f`](https://github.com/beatzball/caribou/commit/c553d3f98db40ee718aeb0ba3df9826a1b37c796) Thanks [@beatzball](https://github.com/beatzball)! - Components and tests name Caribou's own data types from the client package instead of masto's types. No behavior change.

- [#210](https://github.com/beatzball/caribou/pull/210) [`8fbb318`](https://github.com/beatzball/caribou/commit/8fbb3186037511b86f95af495e4cfe1dcf829b7a) Thanks [@beatzball](https://github.com/beatzball)! - Page data carries `nextCursor`. Timelines and profiles hand the server's first cursor to the client, and the "Older posts" link carries the cursor. On `/bookmarks` that link now carries the bookmark id from the Link header, not a status id; this is more correct, and `/bookmarks` does not read `?max_id=`. No other behavior change.

- [#208](https://github.com/beatzball/caribou/pull/208) [`ba34c91`](https://github.com/beatzball/caribou/commit/ba34c911318dcd81f6484b1fd181e2878c957400) Thanks [@beatzball](https://github.com/beatzball)! - Component tests check that client writes get a ref instead of a bare id. No behavior change.

- Updated dependencies [[`a789261`](https://github.com/beatzball/caribou/commit/a789261653998910ec7d5ae03cb328e4bf180f45), [`a789261`](https://github.com/beatzball/caribou/commit/a789261653998910ec7d5ae03cb328e4bf180f45), [`c553d3f`](https://github.com/beatzball/caribou/commit/c553d3f98db40ee718aeb0ba3df9826a1b37c796), [`c553d3f`](https://github.com/beatzball/caribou/commit/c553d3f98db40ee718aeb0ba3df9826a1b37c796), [`8fbb318`](https://github.com/beatzball/caribou/commit/8fbb3186037511b86f95af495e4cfe1dcf829b7a), [`8fbb318`](https://github.com/beatzball/caribou/commit/8fbb3186037511b86f95af495e4cfe1dcf829b7a), [`ba34c91`](https://github.com/beatzball/caribou/commit/ba34c911318dcd81f6484b1fd181e2878c957400), [`ba34c91`](https://github.com/beatzball/caribou/commit/ba34c911318dcd81f6484b1fd181e2878c957400)]:
  - @beatzball/caribou-mastodon-client@0.4.4
  - @beatzball/caribou-state@0.4.5

## 0.10.5

### Patch Changes

- [#162](https://github.com/beatzball/caribou/pull/162) [`4a5d118`](https://github.com/beatzball/caribou/commit/4a5d118c2c482450d4dc20d806159df6f0a16441) Thanks [@beatzball](https://github.com/beatzball)! - `<caribou-button>` takes `pressed`, `label` and `hint`. `pressed` makes a text button a toggle, with the same three states as on `<caribou-icon-button>`. `label` and `hint` name the inner button and give it a tooltip. A post's "edited" mark and the media Show sensitive media, Hide and lightbox Close buttons now use `<caribou-button>`.

- [#161](https://github.com/beatzball/caribou/pull/161) [`7b12e8c`](https://github.com/beatzball/caribou/commit/7b12e8c6978e61d811ee2fe72b78cc16ee53e3de) Thanks [@beatzball](https://github.com/beatzball)! - Add `<caribou-tabs>`, a shared row of link tabs. The profile tabs and the search tabs use it. When the row is too wide for the screen it scrolls, and a shadow at the edge shows more tabs. The search Retry is now a `<caribou-button>`.

- [#166](https://github.com/beatzball/caribou/pull/166) [`3cf8c08`](https://github.com/beatzball/caribou/commit/3cf8c08713c8d4473769c94f5af04f9586a095f6) Thanks [@beatzball](https://github.com/beatzball)! - Add keyboard shortcuts. `j` and `k` move focus to the next and previous post, in every list of posts. `o` or Enter opens the post. `f`, `b` and `r` favourite, boost and reply to it. `n` writes a new post, `/` focuses the search box, and `g` then `h`, `n`, `l` or `s` goes to Home, Notifications, Lists or Search. `?` shows the list of shortcuts. No shortcut fires while you type, while a dialog is open, or with Ctrl, Meta or Alt. A new Keyboard section in Settings turns them off. The right rail's Keyboard shortcuts item now links there.

- [#164](https://github.com/beatzball/caribou/pull/164) [`d8f44c7`](https://github.com/beatzball/caribou/commit/d8f44c7cbbe4e6acd1e4fa29786ebaacaa729ac0) Thanks [@beatzball](https://github.com/beatzball)! - The notification filters (All, Mentions) use the shared `<caribou-button pressed>`. They look and work as before.

- [#168](https://github.com/beatzball/caribou/pull/168) [`729db16`](https://github.com/beatzball/caribou/commit/729db164e22d5c7061a0bf31e3ce919382c8d9d9) Thanks [@beatzball](https://github.com/beatzball)! - Polls. A post shows its poll: options, bars, shares, voters, the end time, the reader's choices, and "Ended". The server renders the results. A signed-in reader on the post's server votes with radio buttons or checkboxes, and can refresh the poll. The compose dialog has a poll builder: options up to the server's limit, a duration, several choices, and hidden totals. A poll and media exclude each other.

- [#167](https://github.com/beatzball/caribou/pull/167) [`6af44c7`](https://github.com/beatzball/caribou/commit/6af44c76bf72cbac4b6905d4546218110e7bc512) Thanks [@beatzball](https://github.com/beatzball)! - Show quote posts (Mastodon 4.5). A quoted post shows as a small card inside the post that quotes it: the author, the text, a media summary and a link to its thread. A quote that shows no post (pending, declined, removed, deleted, not allowed, or by an account the reader blocked or muted) shows a short note. The quoted post's content warning, the reader's filters, mutes and blocks, and the reader's edits and deletes all apply. A quote inside a quoted post is a link, not another card. A signed-in reader gets their own server's quote state, also on a thread page. The server renders the quote, so it works without JavaScript.

- [#160](https://github.com/beatzball/caribou/pull/160) [`7678e84`](https://github.com/beatzball/caribou/commit/7678e8457f17b4a85292c5ba130dcecdb43645d3) Thanks [@beatzball](https://github.com/beatzball)! - The "new posts" banner and the "Switch to" account button in Settings now use the shared `<caribou-button>`. Two small visible changes: both now show the shared keyboard focus ring, and the banner's text uses the app font, so the bar is about 1px taller and gets the shared hover tint.

- Updated dependencies [[`3cf8c08`](https://github.com/beatzball/caribou/commit/3cf8c08713c8d4473769c94f5af04f9586a095f6), [`729db16`](https://github.com/beatzball/caribou/commit/729db164e22d5c7061a0bf31e3ce919382c8d9d9), [`729db16`](https://github.com/beatzball/caribou/commit/729db164e22d5c7061a0bf31e3ce919382c8d9d9), [`6af44c7`](https://github.com/beatzball/caribou/commit/6af44c76bf72cbac4b6905d4546218110e7bc512)]:
  - @beatzball/caribou-state@0.4.4
  - @beatzball/caribou-mastodon-client@0.4.3

## 0.10.4

### Patch Changes

- [#152](https://github.com/beatzball/caribou/pull/152) [`33c430f`](https://github.com/beatzball/caribou/commit/33c430f33b6bc95e79ba80f69f5224033fdb80a8) Thanks [@beatzball](https://github.com/beatzball)! - Edit and delete your own posts. The post menu on your own posts has Edit, Delete and Delete & redraft. Edit opens the compose dialog with the post's text as the server has it now; visibility and media stay as they are. A post with a poll cannot be edited, because Mastodon would remove the poll and its votes. Delete asks first, and focus moves to the next post. Delete & redraft opens a new post with what the deleted one had, saved as a draft at once; it never replaces another unsent draft, and opens first the next time you write a new post. An edited post shows "edited" next to its time; it opens the edit history, newest first.

- [#155](https://github.com/beatzball/caribou/pull/155) [`97df338`](https://github.com/beatzball/caribou/commit/97df33801f763ac23c5b7ad8d70ab2038289b5ff) Thanks [@beatzball](https://github.com/beatzball)! - /notifications groups favourites and boosts on the same post, and follows, into one row: "Alice, Bob and 12 others favourited your post", with a row of avatars. Show all loads and lists everyone in the group. Mentions and other types stay one row each. A muted or blocked account leaves its group.

- [#153](https://github.com/beatzball/caribou/pull/153) [`58ef9e1`](https://github.com/beatzball/caribou/commit/58ef9e13b885ada30c4b4a8b94c9cadfe9ad71dc) Thanks [@beatzball](https://github.com/beatzball)! - Add lists. `/lists` shows your lists, with New list, Edit (title, who to show replies to, and on Mastodon 4.2+ whether to hide the posts from Home) and Delete, which asks first. `/lists/<id>` shows the list's timeline, with its title, Edit list and a Members panel where you can remove an account. A profile's menu has "Add to lists". Lists is in the nav for a signed-in reader. A removed member gets a toast with Undo; a toast can now carry one action button, and such a toast stays until it is used or dismissed.

- [#156](https://github.com/beatzball/caribou/pull/156) [`e551dda`](https://github.com/beatzball/caribou/commit/e551dda63b62327b9fb5ccdfd10901639d4941be) Thanks [@beatzball](https://github.com/beatzball)! - Add search. `/search?q=` has People, Hashtags and Posts tabs, and the address follows the box as you type. A search box sits in the right rail, and Search is in the nav rail (in More on a phone). Pasting a post or profile address opens it in the app. Signed out, search asks the server the public timelines use, which finds people and hashtags but not posts.

- Updated dependencies [[`33c430f`](https://github.com/beatzball/caribou/commit/33c430f33b6bc95e79ba80f69f5224033fdb80a8), [`33c430f`](https://github.com/beatzball/caribou/commit/33c430f33b6bc95e79ba80f69f5224033fdb80a8), [`97df338`](https://github.com/beatzball/caribou/commit/97df33801f763ac23c5b7ad8d70ab2038289b5ff), [`97df338`](https://github.com/beatzball/caribou/commit/97df33801f763ac23c5b7ad8d70ab2038289b5ff), [`58ef9e1`](https://github.com/beatzball/caribou/commit/58ef9e13b885ada30c4b4a8b94c9cadfe9ad71dc), [`58ef9e1`](https://github.com/beatzball/caribou/commit/58ef9e13b885ada30c4b4a8b94c9cadfe9ad71dc), [`e551dda`](https://github.com/beatzball/caribou/commit/e551dda63b62327b9fb5ccdfd10901639d4941be), [`e551dda`](https://github.com/beatzball/caribou/commit/e551dda63b62327b9fb5ccdfd10901639d4941be)]:
  - @beatzball/caribou-mastodon-client@0.4.2
  - @beatzball/caribou-state@0.4.3

## 0.10.3

### Patch Changes

- [#143](https://github.com/beatzball/caribou/pull/143) [`dc9a885`](https://github.com/beatzball/caribou/commit/dc9a8853aae9184e610f10b88c87367d90611b84) Thanks [@beatzball](https://github.com/beatzball)! - Add a `/changelog` page (#68). It shows this app's release notes, newest version first. The newest version is open; the others open with a click. Each version has its own link, such as `/changelog#v0-10-2`, and a link to a closed version opens it. Each change links to its pull request. The page renders the notes as text, never as HTML, and shows only http(s) links. "Updated dependencies" lines are left out.

  Settings has a new About section with the version and a Changelog link, and the right rail links to it too. When a newer version ships than the one you last saw on `/changelog`, the Settings nav item shows a dot (on a phone, the More button shows it too), and a screen reader hears "Settings, new version". The Changelog link on Settings shows the dot as well. Opening `/changelog` clears it. The last version you saw is `lastSeenChangelogVersion` in `caribou.prefs.<userKey>`, so it is per account. A new account starts with the running version as seen, so it gets no dot. Signed out, there is no dot. The dot shows after the page loads and takes no room, so nothing moves.

- [#151](https://github.com/beatzball/caribou/pull/151) [`f8fbc6e`](https://github.com/beatzball/caribou/commit/f8fbc6ed2459145795e587460c06f287ab638123) Thanks [@beatzball](https://github.com/beatzball)! - Fix the changelog parser test. It now checks that no item is an "Updated dependencies" line, instead of searching for those words anywhere. The changelog page's own release note mentions them, which made the test fail on the release branch.

- [#146](https://github.com/beatzball/caribou/pull/146) [`d334e96`](https://github.com/beatzball/caribou/commit/d334e96531bac7d5a864372046fa791ffa3dfdd1) Thanks [@beatzball](https://github.com/beatzball)! - Honor the reader's server filters: a hide filter removes the post, a warn filter shows the filter name with a Show button. Mute and block from a post's menu and from a profile; block asks first. New page `/settings/moderation` lists filters, muted and blocked accounts, with Unmute and Unblock.

- [#150](https://github.com/beatzball/caribou/pull/150) [`1a70cb7`](https://github.com/beatzball/caribou/commit/1a70cb73c72f18a8149749f3d61c5c4cb6a7de11) Thanks [@beatzball](https://github.com/beatzball)! - Fix a flaky e2e test. The theme first-paint check now waits for the first frame before it reads the page color. Before, under load, it could read before that frame and see an empty color.

- [#145](https://github.com/beatzball/caribou/pull/145) [`113e18e`](https://github.com/beatzball/caribou/commit/113e18e83b3d227b8dda7af0ef2c6cd05eeba1d4) Thanks [@beatzball](https://github.com/beatzball)! - New hashtag page at `/tags/<tag>`. It shows the tag's posts with the same timeline as Local and Public. The server paints the first page, so it works without JavaScript. A hashtag in a post now opens this page inside Caribou. The link keeps its real address, so a new-tab click still goes to the instance. A signed-in reader can follow and unfollow the tag. The button changes at once and goes back if the server fails. The tab title is "#tag · Caribou". Case and non-ASCII names work, and a name that cannot be a hashtag says so.

- [#147](https://github.com/beatzball/caribou/pull/147) [`3f7a878`](https://github.com/beatzball/caribou/commit/3f7a87810bb4ad33de399f261a281f2ab4dadfc7) Thanks [@beatzball](https://github.com/beatzball)! - Show a loading screen when `/` opens your timeline: the Caribou logo, a ring that fills while the timeline loads, and "Loading…". It goes to your default timeline (Home, Local or Public) and uses your theme. It stays until the first posts, an error or the empty notice show. While it is up, the keyboard stays on the screen. Leaving the page removes it at once. After 3 s it shows links to your timeline and to sign in, and after 10 s it goes. With reduced motion the ring does not move and there is no fade. Chrome now paints `/` while it opens your timeline; before, the tab stayed blank.

- [#144](https://github.com/beatzball/caribou/pull/144) [`d0bcc11`](https://github.com/beatzball/caribou/commit/d0bcc1141c48f3e600ad5986b251f8bd75e3d947) Thanks [@beatzball](https://github.com/beatzball)! - Add a Settings page at `/settings`. Choose the theme (dark, light or system) and the timeline that opens after sign-in (Home, Local or Public), and see the signed-in account with its actions and sign-out. The theme is set before the first paint, so a page never flashes the other theme. Settings is in the nav rail and in the phone's More menu.

- Updated dependencies [[`d334e96`](https://github.com/beatzball/caribou/commit/d334e96531bac7d5a864372046fa791ffa3dfdd1), [`d334e96`](https://github.com/beatzball/caribou/commit/d334e96531bac7d5a864372046fa791ffa3dfdd1), [`113e18e`](https://github.com/beatzball/caribou/commit/113e18e83b3d227b8dda7af0ef2c6cd05eeba1d4), [`113e18e`](https://github.com/beatzball/caribou/commit/113e18e83b3d227b8dda7af0ef2c6cd05eeba1d4), [`d0bcc11`](https://github.com/beatzball/caribou/commit/d0bcc1141c48f3e600ad5986b251f8bd75e3d947), [`d0bcc11`](https://github.com/beatzball/caribou/commit/d0bcc1141c48f3e600ad5986b251f8bd75e3d947)]:
  - @beatzball/caribou-mastodon-client@0.4.1
  - @beatzball/caribou-state@0.4.2
  - @beatzball/caribou-design-tokens@0.1.2

## 0.10.2

### Patch Changes

- [#136](https://github.com/beatzball/caribou/pull/136) [`67283c2`](https://github.com/beatzball/caribou/commit/67283c2891d2faa37db44895f2efa95eab934b8c) Thanks [@beatzball](https://github.com/beatzball)! - Compose: each attached file's Remove button, Retry button and alt text field now has its own name for screen readers. The name gives the place and the file name, such as "Remove image 2, photo.jpg" and "Alt text for image 2, photo.jpg". Two files with the same name still get different names. A draft saved before this change has no file names, so its controls say "Remove image 1", "Remove video 2" and so on. The visible text is still "Remove".

- [#138](https://github.com/beatzball/caribou/pull/138) [`2126fb9`](https://github.com/beatzball/caribou/commit/2126fb943d0f4d8168d395f25adc731a0fd20efd) Thanks [@beatzball](https://github.com/beatzball)! - Fix a flaky end-to-end test. The test for Enter and Space on the media button now starts waiting for the file chooser before the page loads. Before, on a busy machine, the key press could open the chooser before Playwright was ready to catch it.

- [#140](https://github.com/beatzball/caribou/pull/140) [`3ec8db2`](https://github.com/beatzball/caribou/commit/3ec8db2dd78841e7fc20fcac56b1a62105bda326) Thanks [@beatzball](https://github.com/beatzball)! - Open `/` while signed in, and you now go to `/home`. The check runs in the browser before the sign-in form paints, and Back does not return to `/`. `/?add`, a sign-in error, and a signed-out reader still stay on `/`.

- [#139](https://github.com/beatzball/caribou/pull/139) [`1947217`](https://github.com/beatzball/caribou/commit/19472171d3004a39f192483c69cfa672eaa7302c) Thanks [@beatzball](https://github.com/beatzball)! - Timeline errors behave better. Retry stays in place and keeps focus while it runs. When it works, focus goes to the first new post, to the new-posts button, or to the top of the list. It no longer falls to the page. When it fails again, a screen reader announces the error again. A failed check at the top no longer stops the "Older posts" link. A thread no longer takes a cached copy of itself as fresh data.

- Updated dependencies [[`67283c2`](https://github.com/beatzball/caribou/commit/67283c2891d2faa37db44895f2efa95eab934b8c), [`1947217`](https://github.com/beatzball/caribou/commit/19472171d3004a39f192483c69cfa672eaa7302c)]:
  - @beatzball/caribou-state@0.4.1

## 0.10.1

### Patch Changes

- [#133](https://github.com/beatzball/caribou/pull/133) [`af2f8a8`](https://github.com/beatzball/caribou/commit/af2f8a8b16199131a1de8e6362f3c54c7f63bc15) Thanks [@beatzball](https://github.com/beatzball)! - Fix two phone layout bugs. A link card with a long byline (site and authors) no longer makes the page wider than the screen: the page column no longer grows to fit a wide item. The bottom navigation bar now stays above card and media images, so its items take taps again.

## 0.10.0

### Minor Changes

- [#130](https://github.com/beatzball/caribou/pull/130) [`1e09e37`](https://github.com/beatzball/caribou/commit/1e09e374c00146757deff637bf01a8180147541e) Thanks [@beatzball](https://github.com/beatzball)! - Add an account while signed in (#58, part 3). The account menu's "Add account" link opens `/?add`: a sign-in form with the heading "Add an account", a line that names the account you are signed in as, and a Cancel link back to `/home`. The server field takes the focus when the form opens.
  - Signing in there keeps the accounts you have. The new account becomes active, and the page goes to `/home`.
  - Signing in again to an account you already have does not add it twice. The new token replaces the old one, and the account becomes active.
  - When you cancel or deny at your server, or the sign-in fails, you come back to the add form with a message. Your accounts and the active account do not change.
  - The "signed in as" line fills in after the page loads. Its space is kept from the start, so nothing moves.
  - Plain `/` does not change.

- [#132](https://github.com/beatzball/caribou/pull/132) [`d9da610`](https://github.com/beatzball/caribou/commit/d9da610be8ca29eb3bd9e76b3dc87cc0dbe59841) Thanks [@beatzball](https://github.com/beatzball)! - Finish multi-account (#58, part 4).
  - Sign-in is now bound to the browser that started it. `/api/signin/start` sets a short-lived `caribou.signin` cookie (HttpOnly, SameSite=Lax, path `/api/signin`, Secure on https) with a random nonce, and the OAuth state keeps only its hash. The callback checks it before any token exchange. A sign-in link opened in another browser goes to `/?error=state_mismatch` and changes nothing, so nobody can slip their own account into your browser. Only one sign-in at a time per browser: starting a second one makes the first one's link fail.
  - A sign-in now finishes in the callback's own response: the session is in that page, never in a URL. `/signin/done#token=…` no longer signs anyone in (it only offers "Return to start"), so a link from someone else cannot switch you to their account. The page is `no-store`, `no-referrer`, and has a strict CSP.
  - `/api/signin/start` refuses a request from another site (`403`).
  - A callback with no sign-in cookie at all now says "Finish sign-in in the same browser you started it in, with cookies allowed." (`?error=no_cookie`).
  - "Add account" in the account menu now opens the add form without a full page load, and the server field gets the focus in Safari too.
  - `/?add` with no account signed in (an old link) shows the plain sign-in page.
  - A long handle in "You are signed in as …" wraps to a second line instead of being cut; the full text is also in its tooltip.

- [#127](https://github.com/beatzball/caribou/pull/127) [`e07d7a0`](https://github.com/beatzball/caribou/commit/e07d7a05b7eaecb8e41dbedff2710f3652b1b4b1) Thanks [@beatzball](https://github.com/beatzball)! - Sign-out with more than one account signed in now signs out of the current
  account only. The next account becomes active and the page reloads as that
  account, on the same page when it means the same for any account (home,
  notifications, bookmarks, your profile, the public feeds), else on home. The
  last sign-out goes to `/` as before. A second click while sign-out is still
  running does nothing, so it can no longer sign out of the next account too.
  An expired session (a 401) with another account still signed in now moves to
  that account instead of signing out completely. Sign-out and 401s that happen
  together end in one reload, as the account that is left, with the cookie set
  to its server. When the server changes, a public feed keeps its filters but
  not its page position (`max_id`, `min_id`, `since_id`). A 401 that comes after
  that reload started, but before the new page shows, reloads again as the
  account that is left. A Sign out click in that window does nothing: the old
  page still shows the account that is gone. A page brought back with the browser's
  Back button can sign out again.

  A new `POST /api/instance` sets the instance cookie to a server this
  deployment has an app for, from a same-origin page only; the app uses it to
  point SSR of the public feeds and profiles at the new account's server. When
  that fails twice, the reload goes to home rather than to a public feed of the
  old server. On a full page load, a cookie that names another server than the
  current account's is set to that account's server, so the next load of a
  public feed shows the right server; a reload that starts meanwhile waits for
  it, so the reload's cookie wins. Sign-out still never clears the cookie. Sign-in now saves the
  server name in lower case.

- [#129](https://github.com/beatzball/caribou/pull/129) [`d747558`](https://github.com/beatzball/caribou/commit/d74755853e9ac8936df62a0f1fc5c76f33162b0f) Thanks [@beatzball](https://github.com/beatzball)! - An account menu at the foot of the nav rail. The button shows the current
  account (avatar, name and `@name@server`; only the avatar on a narrow rail).
  It opens a list of the stored accounts, the current one first with a check
  mark. Choosing another account switches to it and reloads the page as that
  account. The menu also has "Add account" (for now, the sign-in page) and
  "Sign out of @name", which replaces the rail's Sign out button. On a phone the same items are at the end of the More menu.
  The rail now stays in view beside the page, so the button is always at the
  foot of the window; in a short window the rail scrolls on its own.
  A switch does nothing while a sign-out, an expired session or another switch
  is already reloading the page, and Sign out does nothing while a switch is.

### Patch Changes

- Updated dependencies [[`e07d7a0`](https://github.com/beatzball/caribou/commit/e07d7a05b7eaecb8e41dbedff2710f3652b1b4b1)]:
  - @beatzball/caribou-state@0.4.0

## 0.9.0

### Minor Changes

- [#125](https://github.com/beatzball/caribou/pull/125) [`43aa8f0`](https://github.com/beatzball/caribou/commit/43aa8f02c7d89007dbfa199caea58f8bf98155f9) Thanks [@beatzball](https://github.com/beatzball)! - The app has its own name and logo. Every browser tab now says "Caribou"
  (the 404 page says "Not found · Caribou") and shows the caribou icon. The
  landing page and the right rail show the logo beside the name. "Add to Home
  Screen" on iOS and Android uses the logo and the name Caribou, from a new
  `site.webmanifest`. A shared link shows the name and the logo in its preview.
  To change the logo, replace `apps/caribou/assets-src/caribou-logo.png` and run
  `pnpm --filter caribou-app icons`.

## 0.8.0

### Minor Changes

- [#122](https://github.com/beatzball/caribou/pull/122) [`0f92f0f`](https://github.com/beatzball/caribou/commit/0f92f0fea3441a8a922e91adb5d6846f856b3e45) Thanks [@beatzball](https://github.com/beatzball)! - A post with a content warning now shows only the warning and a "Show more" button. The text, media and link card stay hidden, and load nothing, until the reader clicks it. "Show less" hides them again, and focus stays on the button. The button tells screen readers if the post is open (`aria-expanded`). Show more also shows sensitive media, which keeps its own Hide button. A boost uses the warning of the boosted post. An opened post stays open when the reader comes back to a cached page; a post with the same id from another instance does not, and a switch of account closes them all. The server renders the post closed, the same as the first client render. Without JavaScript a post with a content warning cannot be opened.

- [#121](https://github.com/beatzball/caribou/pull/121) [`a2cb1d2`](https://github.com/beatzball/caribou/commit/a2cb1d2ff6b230bb1f6b45f30c8c9d69490e7569) Thanks [@beatzball](https://github.com/beatzball)! - Posts with a link now show its preview card under the text: the image, the title, a short description and the site name. A wide image (on a link, video or photo card) goes on top, full width; a small one sits beside the text; a card with no image is text only. The whole card is one link that opens in a new tab, named by its title. The image box keeps its size before the file arrives, so the list does not jump. A post with media shows no card, as on Mastodon. Long links in post text and in profile bios are shortened the way Mastodon and elk show them (no `https://www.`, an ellipsis on a long path). The link still goes to the full URL, a screen reader still reads the full URL, and copying the link text still gives the full URL. The server render of `/local` and `/public` includes the card.

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
