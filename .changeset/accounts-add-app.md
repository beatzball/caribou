---
"caribou-app": minor
---

Add an account while signed in (#58, part 3). The account menu's "Add account" link opens `/?add`: a sign-in form with the heading "Add an account", a line that names the account you are signed in as, and a Cancel link back to `/home`. The server field takes the focus when the form opens.

- Signing in there keeps the accounts you have. The new account becomes active, and the page goes to `/home`.
- Signing in again to an account you already have does not add it twice. The new token replaces the old one, and the account becomes active.
- When you cancel or deny at your server, or the sign-in fails, you come back to the add form with a message. Your accounts and the active account do not change.
- The "signed in as" line fills in after the page loads. Its space is kept from the start, so nothing moves.
- Plain `/` does not change.
