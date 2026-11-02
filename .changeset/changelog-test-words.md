---
"caribou-app": patch
---

Fix the changelog parser test. It now checks that no item is an "Updated dependencies" line, instead of searching for those words anywhere. The changelog page's own release note mentions them, which made the test fail on the release branch.
