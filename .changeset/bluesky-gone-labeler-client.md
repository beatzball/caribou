---
"@beatzball/caribou-bluesky-client": patch
---

`goneLabelers` lists the labelers in the reader's prefs with no `getServices` view. The restored client gives `gone` after two misses in a row, and `removeGoneLabeler` takes one out of the reader's prefs. It checks once more first, and it changes no other pref. Moderation loads now publish in order: an older load never replaces a newer one.
