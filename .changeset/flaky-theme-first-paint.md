---
"caribou-app": patch
---

Fix a flaky e2e test. The theme first-paint check now waits for the first frame before it reads the page color. Before, under load, it could read before that frame and see an empty color.
