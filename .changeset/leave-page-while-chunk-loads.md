---
"caribou-app": patch
---

Leaving a page while its code is still loading no longer sends you back to it. In Safari and Firefox, a typed address, a bookmark or a link to another site opened right after a page loaded could land on the page you left. The app read the code the browser dropped as a sign of a new deploy and loaded the old page again, which cancelled your navigation. Now it does not reload while the page is leaving.
