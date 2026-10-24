---
"@beatzball/caribou-design-tokens": patch
---

Remove the `presetCaribou` UnoCSS preset, its `./uno-preset` export and the `unocss` dev dependency. The Lit app has no utility classes; every element styles itself with `static styles` against the token variables, so the package now ships `tokens.css` alone.
