---
"caribou-app": patch
---

Keep "Older posts" a plain link on a profile from another instance. The server fetches `/@alice@other.host` from `other.host`, so its account and status ids belong to that host. A client signed in elsewhere paged them against its own server and got another account's posts or a 404. `<caribou-profile>` now takes an `instance` attribute from the page and pages in place only when the signed-in client's server is that host; otherwise the link leads to the next server-rendered page, as it does without JavaScript.
