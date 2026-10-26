---
"caribou-app": patch
---

Clicking a post's time now opens its thread without a full page load. The status card's permalink is a `<litro-link>`, so the server still sends a real link that works without JavaScript, and a modifier click still opens a new tab.
