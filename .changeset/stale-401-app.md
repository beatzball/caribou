---
'caribou-app': patch
---

A stale 401 no longer signs out the current session. The 401 handler removes only the session that got the 401, and only while it still has the same token. It redirects to `/` with the "session expired" banner only when that session was the active one. A 401 for another stored session, or for a replaced token, changes nothing on screen, and no longer blocks a later real 401.
