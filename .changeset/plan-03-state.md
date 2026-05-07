---
'@beatzball/caribou-state': minor
---

Add `createAccountCache` (handle → Account memoization with stale-while-
revalidate), `createProfileStore` (per-account paginated profile statuses
with tab-driven remount), and `createThreadStore` (parallel focused-status
+ thread-context fetch with `AsyncState` discriminated-union state).
`createTimelineStore` gains an `initial` option for SSR-seeded hydration
without a redundant first fetch.
