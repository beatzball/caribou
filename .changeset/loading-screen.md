---
"caribou-app": patch
---

Show a loading screen when `/` opens your timeline: the Caribou logo, a ring that fills while the timeline loads, and "Loading…". It goes to your default timeline (Home, Local or Public) and uses your theme. It stays until the first posts, an error or the empty notice show. While it is up, the keyboard stays on the screen. Leaving the page removes it at once. After 3 s it shows links to your timeline and to sign in, and after 10 s it goes. With reduced motion the ring does not move and there is no fade. Chrome now paints `/` while it opens your timeline; before, the tab stayed blank.
