// Inlined design-token `<style>` block injected into every SSR'd page's
// <head>. Litro + Elena rely on light-DOM rendering with `var(--…)` utility
// classes and inline styles, so tokens.css must land in the cascade before
// the first paint. Vite's CSS-import pipeline extracts the import from
// app.ts into dist/client/assets/app-<hash>.css, which the SSR shell never
// links — inlining keeps the source of truth in @beatzball/caribou-design-tokens
// while guaranteeing the variables are defined on initial render.
//
// TOKENS_CSS is baked in at build time by scripts/write-tokens-head.mjs.
// Reading the file at module init (readFileSync + require.resolve) would
// throw MODULE_NOT_FOUND in production, because the deployed Docker image
// only ships `dist/` — no node_modules, so the workspace package isn't
// resolvable at runtime.
import { TOKENS_CSS } from './tokens-head.generated.js'

export const TOKENS_HEAD = `<style id="caribou-tokens">${TOKENS_CSS}</style>`
