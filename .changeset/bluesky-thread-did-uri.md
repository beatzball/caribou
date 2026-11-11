---
"caribou-app": patch
---

Bluesky: a signed-in post page opened by a handle address (`/@<handle>/<rkey>`, as a card's time link makes) now loads. The thread reads the post by its DID address, because the AppView answers `getPosts` with an error for a handle address (#271).
