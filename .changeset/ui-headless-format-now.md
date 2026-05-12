---
"@beatzball/caribou-ui-headless": patch
---

`formatRelativeTime(date, nowMs?)` accepts an optional `nowMs` parameter for test stubbing and SSR/client hydration parity. Default behavior unchanged for callers passing a single argument.
