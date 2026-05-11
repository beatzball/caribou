---
"caribou-elena": patch
---

Switch `<caribou-timeline>`, `<caribou-profile>`, and `<caribou-thread>` to render via `<caribou-list-mount>` + `reconcileKeyedList` (both from `@beatzball/caribou-ui-headless`). The mount provides a shadow-DOM container that's morph-opaque (Elena's `morphContent` would otherwise wipe `<li>` children when the host's template emits the wrapping `<ul>` empty); the helper diffs the mount's inner `<ul>` by `status.id`. Cards keep object identity across polls, `loadMore`, and `applyNewPosts` — `caribou-status-card.status` no longer fires the setter on surviving cards, eliminating the avoidable card-internal re-renders that contributed to avatar flicker and lost scroll position under load.

Pure refactor; no user-facing UI changes. Plan 3 §11.1a deferred follow-up.
