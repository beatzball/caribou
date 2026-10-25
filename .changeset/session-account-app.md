---
"caribou-app": patch
---

Fix compose and the post cards for a real sign-in. Sign-in stores the session with `account: null`, and the new code read the account without a check: every post card threw on load, and New post and Reply did nothing. The cards, the profile header and the compose dialog now work without the account. The app also loads the account in the background (`verify_credentials`) and stores it, so compose then starts from the account's default visibility.
