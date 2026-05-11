---
"@beatzball/elena-morph-spec": patch
---

Pin morph behavior on empty native `<ul>` template parents — documents that Elena's `morphContent` **does** wipe live `<ul>` children when the host's render template emits the `<ul>` empty. `it.fails`-pinned: the day Elena's morph stops wiping these, the test will fail and Caribou's `<caribou-list-mount>` workaround can be retired. Useful as upstream documentation if/when lifted into `@elenajs/core`.
