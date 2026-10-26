---
'@beatzball/caribou-mastodon-client': minor
---

Add `installPurifyHooks(purify)` to `sanitize-opts`. It adds a DOMPurify hook that puts `noopener` and `noreferrer` into the `rel` of every `target="_blank"` link, keeping words already there, and installs only once per DOMPurify instance. `forceSafeTargetRel` is the hook itself.
