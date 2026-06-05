---
"@beatzball/caribou-ui-headless": patch
---

Removes the plain `HTMLElement`-based `CaribouListMount` export. The class and its `<caribou-list-mount>` tag registration move into caribou-elena as an Elena component with SSR Declarative Shadow DOM support. The keyed reconciler stays in this package — it really is framework-agnostic.

The "future caribou-lit / caribou-fast adapters might want a no-framework list-mount" rationale was speculative scaffolding; if/when those adapters are built they'll need their own list-mount because Lit's `ReactiveElement` and FAST's `FASTElement` reactivity differ from Elena's. No current consumer used the plain version directly.
