---
'caribou-app': patch
---

The hydration e2e spec also checks that every Lit element class on the page carries the hydration support (`defer-hydration` in `observedAttributes`), which names the unpatched classes when the bootstrap breaks.
