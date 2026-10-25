---
"@beatzball/caribou-state": patch
---

`UserSession.account` is now typed `Account | null`, as sign-in stores it. New: `loadActiveAccount()` loads and stores the active user's account when it is missing; `userName(user)` gives the user's handle with or without the account; `isOwnAccount(user, account)` tells whether an account is the user.
