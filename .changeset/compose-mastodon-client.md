---
"@beatzball/caribou-mastodon-client": minor
---

Add the compose methods to `CaribouClient`: `createStatus` (sends an
`Idempotency-Key` so a retry never posts twice), `uploadMedia` (v2 upload
that waits up to five minutes for the server to finish processing),
`waitForMedia` (resumes that wait after a `MediaProcessingTimeout`, which
carries the media id), `fetchMedia`, `updateMedia` and `fetchInstance`.
Writes skip the in-flight dedup.
