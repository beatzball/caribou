---
"caribou-app": patch
---

The media viewer no longer draws a solid box. The image floats over a dark, blurred view of the page, in the light and the dark theme. The key hint, the description and Close each sit on a small dark surface, so they read over any page, and Close has a white-on-black focus ring. With reduced transparency the backdrop is solid and nothing blurs; where blur is not supported the tint is darker. A click on any empty place around the image now closes the viewer at 1x; a click on the image, the text or a control does not, and neither does a drag, a pinch or a click while zoomed. Opening the viewer again right after Escape no longer shows it empty.
