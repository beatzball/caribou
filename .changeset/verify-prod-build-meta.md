---
"caribou-elena": patch
---

`/api/health` now returns `{ status, commit, version }` where `commit` is the git HEAD at build time and `version` is the package version. Drives the new `pnpm verify:prod` canary that polls until the deployed commit matches the SHA that triggered the workflow.
