---
'caribou-app': patch
---

A request for `/_litro/app.js` with any query but exactly this build's `?v=` is now answered `no-store`. During a rolling deploy both builds answer for a short time, so a browser can get the new HTML and then this build's entry from the other container. It still gets a working file, but no longer keeps it under the other build's URL. The bare entry and exactly this build's `?v=` stay `no-cache` with an ETag.
