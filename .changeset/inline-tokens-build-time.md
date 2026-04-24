---
'caribou-elena': patch
---

Bake design-token CSS into the server bundle at build time. The previous implementation called `readFileSync(require.resolve('@beatzball/caribou-design-tokens/tokens.css'))` at module top-level, which threw `MODULE_NOT_FOUND` in production — the Docker runtime image ships only `dist/`, no `node_modules`, so the workspace package wasn't resolvable. Every page hit that loaded the `[...]` route chunk returned a JSON 500; `/api/health` worked because it's a separate chunk without that import. Fix: `scripts/write-tokens-head.mjs` inlines the CSS into `server/lib/tokens-head.generated.ts` before `litro build`, so the bundle contains a plain string constant.
