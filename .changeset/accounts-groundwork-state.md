---
"@beatzball/caribou-state": minor
---

Groundwork for more than one account (#58). `switchAccount(userKey)` makes a
stored account active and saves it. `signOutActive()` signs out of the active
account only and makes the next stored account active, or none when it was the
last; it returns the new active session. A favourite, boost or bookmark that
finishes after the active account changed no longer writes the old account's
flag into the status cache, and no longer shows its error toast (#108 item 5).
