---
"@beatzball/caribou-state": patch
---

Viewer state lives in slots: a like, a repost and a bookmark each keep their flag and record ref together. One rule decides which copy of a post may change a slot: only the reader's copy, never while the reader's write is out, never a fetch that started before that write finished, and not inside the network's lag window when it disagrees. Stores pass each copy's source (`readSource`). Relationship reads follow the same lag rule.
