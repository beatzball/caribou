---
"caribou-app": patch
---

Link-hint tools such as Vimium now show hints on icon buttons: Reply, Boost, Favourite and Bookmark on each post, the compose toolbar, and a toast's Dismiss. A hit test at the button's centre used to land inside the icon's own shadow root, so the tool decided the button was covered and skipped it. The icon no longer takes pointer hits; clicks, hover, tooltips and keyboard use are unchanged.
