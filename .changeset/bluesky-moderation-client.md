---
"@beatzball/caribou-bluesky-client": patch
---

Add Bluesky moderation. `moderate()` runs the SDK's `moderatePost` and
`moderateProfile` with the reader's prefs and label definitions and returns
plain data for each context. It fails closed and never throws: negated
labels are dropped, a label the SDK cannot define gets a cover with no Show
button, missing prefs lock every cover, and an SDK error covers everything.
Bluesky's own labeler is always subscribed and needs its definitions too.
Also adds `labelDefsFromServices`, `LOGGED_OUT_PREFS`, `isNoUnauthenticated`
and `blueskyCheckSettled`, the reader veil check.
