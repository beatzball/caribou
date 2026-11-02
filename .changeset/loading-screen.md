---
"caribou-app": patch
---

Show a loading screen when `/` opens `/home`: the Caribou logo, a ring that fills while the home timeline loads, and "Loading…". It stays until the first posts, an error or the empty notice show. After 3 s it shows links to your home timeline and to sign in, and after 10 s it goes. With reduced motion the ring does not move and there is no fade. Chrome now paints `/` while it opens `/home`; before, the tab stayed blank.
