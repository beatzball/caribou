---
"caribou-app": patch
---

Fix a flaky end-to-end test. The test for Enter and Space on the media button now starts waiting for the file chooser before the page loads. Before, on a busy machine, the key press could open the chooser before Playwright was ready to catch it.
