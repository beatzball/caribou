---
"caribou-app": patch
---

Open `/` while signed in, and you now go to `/home`. The check runs in the browser before the sign-in form paints, and Back does not return to `/`. `/?add`, a sign-in error, and a signed-out reader still stay on `/`.
