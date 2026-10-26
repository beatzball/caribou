---
'caribou-app': minor
---

The phone nav bar (below 768px) now holds Home, Local, New post, Profile and a More button, so every item fits at 320px. More opens a small menu with Public, Bookmarks and Sign out. It is a native popover: it opens, closes on Escape or a tap outside, and signs out without JavaScript. The new `<caribou-menu>` element builds it. The rail's order is now the same at every width, with New post just above Profile.
