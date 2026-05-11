---
"@beatzball/caribou-ui-headless": minor
---

Add `reconcileKeyedList`, a pure-function keyed-list DOM reconciler that diffs by a stable key, plus `<caribou-list-mount>`, a tiny shadow-DOM container that wraps the helper-managed `<ul>` so it's morph-opaque to the surrounding Elena host. Designed for re-rendering surfaces that need to preserve child element identity across prepends, appends, and reorderings. Used internally by `<caribou-timeline>`, `<caribou-profile>`, and `<caribou-thread>` to avoid re-creating `<li>` wrappers for surviving statuses.

The helper owns `data-key` on every direct child of the parent; callers never write it. Cursor-walk algorithm; O(n) time; O(removed + added + moved) DOM ops. Includes dev-mode duplicate-key throw and post-condition assertion (gated on `import.meta.env.DEV`).
