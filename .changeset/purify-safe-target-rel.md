---
'@beatzball/caribou-mastodon-client': minor
---

Add `installPurifyHooks(purify)` to `sanitize-opts`. It adds a DOMPurify hook that puts `noopener` and `noreferrer` into the `rel` of every link that opens a new window (`target="_blank"` in any case, or a named target), keeping words already there, and installs only once per DOMPurify instance. `forceSafeTargetRel` is the hook itself.
