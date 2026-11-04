---
"@beatzball/caribou-state": patch
---

The status cache also keeps a quoted post (Mastodon 4.5 `quote.quotedStatus`) under its own id, with the same rules as any other copy: a newer edit is never undone, the reader's flags are kept, and its `filtered` counts for `readerFiltered`. An account change drops the reader's flags from the copy inside the quote too. A quote of a post the reader deleted becomes a deleted quote when the account changes.
