---
"caribou-app": minor
---

The app has its own name and logo. Every browser tab now says "Caribou"
(the 404 page says "Not found · Caribou") and shows the caribou icon. The
landing page and the right rail show the logo beside the name. "Add to Home
Screen" on iOS and Android uses the logo and the name Caribou, from a new
`site.webmanifest`. A shared link shows the name and the logo in its preview.
To change the logo, replace `apps/caribou/assets-src/caribou-logo.png` and run
`pnpm --filter caribou-app icons`.
