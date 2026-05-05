# @beatzball/caribou-tsconfig

> Shared TypeScript configs for Caribou packages and apps.

**Status:** Not meant to leave — workspace glue.

Three configs ship: `base.json` (strict, ES2022, NodeNext modules — what
every other config extends), `library.json` (adds `composite: true`,
`declaration: true` for publishable packages), and `app.json` (adds DOM
libs and JSX settings for `apps/caribou-elena`). Each workspace package
extends one of these via `"extends": "@beatzball/caribou-tsconfig/library.json"`
in its `tsconfig.json`. There's no code, no tests, no public API — the
JSON files *are* the package.

Splitting it out keeps every other workspace `tsconfig.json` to a
two-line file (`extends` + `include`). Lifting it into a published
package would mean picking opinions (`strict`, NodeNext, ES2022) that
might not match a different project's stack — better to copy the four
relevant lines into a fresh project than depend on Caribou's choices.
