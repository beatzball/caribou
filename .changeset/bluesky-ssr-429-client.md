---
"@beatzball/caribou-bluesky-client": patch
---

The signed-out page code moved into the package (`src/signed-out.ts`, exported from `./moderation`): `signedOutProfilePage`, `signedOutThread`, `signedOutLabelDefs` and the guards, with the caller's fetch and HTML cleaner. The app's server and its browser fallback now share one copy. `./moderation` also exports `isProvenVisible`. A source can name errors that must reach the caller (`mustPropagate`); the app passes its rate-limit check, so a 429 on the label definitions is never read as "no definitions".
