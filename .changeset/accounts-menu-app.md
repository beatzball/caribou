---
"caribou-app": minor
---

An account menu at the foot of the nav rail. The button shows the current
account (avatar, name and `@name@server`; only the avatar on a narrow rail).
It opens a list of the stored accounts, the current one first with a check
mark. Choosing another account switches to it and reloads the page as that
account. The menu also has "Add account" (for now, the sign-in page) and
"Sign out of @name", which replaces the rail's Sign out button. On a phone the same items are at the end of the More menu.
The rail now stays in view beside the page, so the button is always at the
foot of the window; in a short window the rail scrolls on its own.
A switch does nothing while a sign-out, an expired session or another switch
is already reloading the page, and Sign out does nothing while a switch is.
