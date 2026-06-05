# @beatzball/caribou-ui-headless

## 0.2.1

### Patch Changes

- [#25](https://github.com/beatzball/caribou/pull/25) [`28b62b5`](https://github.com/beatzball/caribou/commit/28b62b5a85a701e281525aa740cbd823ea42a8e7) Thanks [@beatzball](https://github.com/beatzball)! - Removes the plain `HTMLElement`-based `CaribouListMount` export. The class and its `<caribou-list-mount>` tag registration move into caribou-elena as an Elena component with SSR Declarative Shadow DOM support. The keyed reconciler stays in this package — it really is framework-agnostic.

  The "future caribou-lit / caribou-fast adapters might want a no-framework list-mount" rationale was speculative scaffolding; if/when those adapters are built they'll need their own list-mount because Lit's `ReactiveElement` and FAST's `FASTElement` reactivity differ from Elena's. No current consumer used the plain version directly.

## 0.2.0

### Minor Changes

- [#19](https://github.com/beatzball/caribou/pull/19) [`4fb1e61`](https://github.com/beatzball/caribou/commit/4fb1e61edd8961ad9c1f87f05cc157fa44ed1034) Thanks [@beatzball](https://github.com/beatzball)! - Add `reconcileKeyedList`, a pure-function keyed-list DOM reconciler that diffs by a stable key, plus `<caribou-list-mount>`, a tiny shadow-DOM container that wraps the helper-managed `<ul>` so it's morph-opaque to the surrounding Elena host. Designed for re-rendering surfaces that need to preserve child element identity across prepends, appends, and reorderings. Used internally by `<caribou-timeline>`, `<caribou-profile>`, and `<caribou-thread>` to avoid re-creating `<li>` wrappers for surviving statuses.

  The helper owns `data-key` on every direct child of the parent; callers never write it. Cursor-walk algorithm; O(n) time; O(removed + added + moved) DOM ops. Includes dev-mode duplicate-key throw and post-condition assertion (gated on `import.meta.env.DEV`).

## 0.1.0

### Minor Changes

- [#17](https://github.com/beatzball/caribou/pull/17) [`b371f8d`](https://github.com/beatzball/caribou/commit/b371f8d14fab3d956a884fa36d469fe6bbd79478) Thanks [@beatzball](https://github.com/beatzball)! - New package. Headless utilities for Caribou's UI layer: `createIntersectionObserver`
  (observe / disconnect lifecycle wrapper) and `formatRelativeTime` (six-range
  relative time formatter for status timestamps).
