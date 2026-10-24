---
'caribou-app': patch
---

Bump `@beatzball/litro` to 0.17.4. Litro now maps `pages/@[handle].ts` to `/@:handle` itself, so the local patch keeps only the change that makes `pages/index.ts` register `page-index` instead of `page-home`.
