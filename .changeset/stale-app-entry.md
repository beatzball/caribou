---
'caribou-app': patch
---

A deploy no longer leaves browsers on the old build. `/_litro/app.js` was cached for a year although its name never changes, so a browser that had it kept loading the old app, whose page chunks the new image no longer has: a tap on Local or Public did nothing until the cache let go. The page now loads the entry as `app.js?v=<build>`, the bare entry is served `no-cache`, and no chunk imports the entry any more. A tab that stays open across a deploy loads the page in full when a page chunk is missing, once.
