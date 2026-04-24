---
'caribou-elena': patch
---

Canary reliability: thread Coolify's `SOURCE_COMMIT` build arg into
`write-build-meta.mjs` as a fallback between the explicit `GIT_SHA` env and
the `git rev-parse HEAD` read. Fixes `/api/health.commit` returning
`"unknown"` in environments where `.git` is stripped from the Docker build
context.
