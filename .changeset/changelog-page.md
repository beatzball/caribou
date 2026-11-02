---
"caribou-app": patch
---

Add a `/changelog` page (#68). It shows this app's release notes, newest version first. The newest version is open; the others open with a click. Each version has its own link, such as `/changelog#v0-10-2`, and a link to a closed version opens it. Each change links to its pull request. The page renders the notes as text, never as HTML, and shows only http(s) links. "Updated dependencies" lines are left out.

Settings has a new About section with the version and a Changelog link, and the right rail links to it too. When a newer version ships than the one you last saw on `/changelog`, the Settings nav item shows a dot (on a phone, the More button shows it too), and a screen reader hears "Settings, new version". The Changelog link on Settings shows the dot as well. Opening `/changelog` clears it. The last version you saw is `lastSeenChangelogVersion` in `caribou.prefs.<userKey>`, so it is per account. A new account starts with the running version as seen, so it gets no dot. Signed out, there is no dot. The dot shows after the page loads and takes no room, so nothing moves.
