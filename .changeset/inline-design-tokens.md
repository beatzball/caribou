---
'caribou-elena': patch
---

Inline design-token CSS into the SSR `<head>` so `var(--bg-0)` et al. resolve on first paint. Previously `app.ts` imported `tokens.css`, which Vite extracted into a `dist/client/assets/app-<hash>.css` asset that the SSR shell never linked, leaving every served page rendering as unstyled HTML.
