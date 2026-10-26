---
'caribou-app': patch
---

Mobile nav bar answers a tap at once. The tapped item gets a pending look
while the next page loads; `aria-current` stays on the page that is shown.
Bar items are 44px square, and the bar keeps clear of the iPhone home
indicator (`viewport-fit=cover` with safe-area insets).
