---
'caribou-elena': patch
---

Stop the home timeline from re-rendering on every poll tick.

Each `cacheStatus()` call writes a new Map to the global `statusCache` signal, which made the store's `statuses` computed return a new array reference even when the displayed status IDs hadn't changed. `caribou-home-timeline` was subscribed to that array, so every poll caused a full timeline re-render → Elena's `morphContent` recursed into every `<caribou-status-card>`, wiped its `<article>`, and the browser fetched every avatar fresh (visible flicker on profile images).

Three changes together:

- `newPostsCount` is pushed into `<caribou-new-posts-banner>` via a dedicated `effect`, so a poll that only changes that signal doesn't invalidate the timeline's render at all.
- The remaining bindings (`statuses`/`loading`/`errorMsg`) use a shallow-equality check so the timeline only re-renders when displayed status references actually change.
- As a safety net for the cases that *do* re-render (loadMore, applyNewPosts), `updated()` calls `requestUpdate()` on any child whose light DOM was emptied by Elena's morph (whose recursion into custom-element children is the structural cause of the wipe).

Regression test in `feed.spec.ts` tags every avatar `<img>` pre-poll and asserts every node survives the poll.
