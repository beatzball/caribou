# @beatzball/caribou-eslint-config

> Shared ESLint flat config for Caribou.

**Status:** Not meant to leave — workspace glue.

A single `index.js` exporting the flat-config array used by every
workspace package. Brings in `@typescript-eslint`'s parser + plugin,
sets up `globals` for browser + node + ES2024, and applies the recommended
rule sets with a few Caribou-specific tweaks. Consumed via
`eslint.config.js`'s `import config from '@beatzball/caribou-eslint-config'`
in each package and app.

No tests, no types — the config is the deliverable. Like `tsconfig`,
this is intentionally workspace-internal: the rule choices reflect
Caribou's stack (custom elements, no React, strict TS), and a different
project would copy four lines rather than inherit our taste.
