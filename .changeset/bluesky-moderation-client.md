---
"@beatzball/caribou-bluesky-client": patch
---

Add Bluesky moderation. `moderate()` runs the SDK's `moderatePost` and
`moderateProfile` with the reader's prefs and label definitions and returns
plain data for each context. It fails closed: if prefs or label definitions
are missing, a label covers what it could cover, with no Show button. Also
adds `labelDefsFromServices`, `LOGGED_OUT_PREFS`, `isNoUnauthenticated` and
`blueskyCheckSettled`, the reader veil check.
