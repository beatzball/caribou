---
"caribou-app": minor
---

Every post now has a reply, boost, favourite and bookmark button, with counts.
They work when you are signed in to the instance the post came from; otherwise
they are dimmed and say "Sign in to …". Boost is off for direct posts and for
other people's followers-only posts. Reply opens compose through the
`caribou:compose` event. A new toaster shows `caribou:toast` messages, for
example when an action fails and is rolled back.
