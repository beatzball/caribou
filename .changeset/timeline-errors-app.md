---
"caribou-app": patch
---

Timeline errors behave better. Retry stays in place and keeps focus while it runs. When it works, focus goes to the first new post, to the new-posts button, or to the top of the list. It no longer falls to the page. When it fails again, a screen reader announces the error again. A failed check at the top no longer stops the "Older posts" link. A thread no longer takes a cached copy of itself as fresh data.
