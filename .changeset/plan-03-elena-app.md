---
'caribou-elena': minor
---

Plan 3: read-only completeness. Adds `/local`, `/public`, `/@[handle]`,
`/@[handle]/[statusId]`, `/privacy`, `/about` routes; renames `/feed` →
`/home` with a 301 redirect on `/feed`; introduces shadow-DOM layout
components `<caribou-app-shell>`, `<caribou-nav-rail>`, `<caribou-right-rail>`;
status-card gains four variants (timeline / focused / ancestor / descendant)
and renders boosts via `status.reblog ?? status` with a booster-attribution
row; SSR `pageData` for every public-read route; hostname-only
`caribou.instance` cookie (validated against the OAuth registry) drives
bare-URL routing; LRU + in-flight dedup upstream cache; server-side
DOMPurify+jsdom sanitizer; declarative-shadow-DOM emission with adoption-
suppression sentinel; anchor-as-source-of-truth pagination with
IntersectionObserver hijack; auth-required placeholder for `/home`,
`/@me`, `/@me/[id]`. UnoCSS installed app-local with
`presetUno() + presetIcons() + presetCaribou()`. Lucide icons via
`@iconify-json/lucide`.
