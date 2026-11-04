---
"@beatzball/caribou-state": patch
---

The status cache also keeps a quoted post (Mastodon 4.5 `quote.quotedStatus`) under its own id, with the same rules as any other copy: a newer edit is never undone, the reader's flags are kept, and its `filtered` counts for `readerFiltered`. An account change drops the reader's flags from the copy inside the quote too. A quote of a post the reader deleted becomes a deleted quote when the account changes. A copy without a token (no `filtered`) never replaces the reader's quote state, and a shallow quote never replaces a full quote of the same post. A kept quote does not cache its old quoted post again, and the reader's copy is found inside a boost too. The newest `filtered` and the quote of each post now live in one record per post id (`postRecords`, read through `readerFiltered` and the new `readerQuote`), written by every copy of the post, alone, in a boost or in a quote; `filteredById` is gone.
