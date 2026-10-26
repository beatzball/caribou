---
"caribou-app": patch
---

The nav rail draws its icons with `<caribou-icon>`, and New post is a
`<caribou-button variant="primary">`. The pen icon moves into the shared icon
set as `squarePen`. Below desktop width the rail's labels are clipped instead
of `display: none`, so the nav links, New post and Sign out keep their
accessible names where only the icons show.
