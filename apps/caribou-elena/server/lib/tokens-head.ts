// Inlined design-token `<style>` block injected into every SSR'd page's
// <head>. Litro + Elena rely on light-DOM rendering with `var(--…)` utility
// classes and inline styles, so tokens.css must land in the cascade before
// the first paint. Vite's CSS-import pipeline extracts the import from
// app.ts into dist/client/assets/app-<hash>.css, which the SSR shell never
// links — inlining keeps the source of truth in @beatzball/caribou-design-tokens
// while guaranteeing the variables are defined on initial render.
//
// At ~1KB, inline beats a separate <link>: no extra RTT, no flash of
// unstyled content, and robust against the Vite-manifest path changing.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const TOKENS_CSS = readFileSync(
  require.resolve('@beatzball/caribou-design-tokens/tokens.css'),
  'utf8',
)

export const TOKENS_HEAD = `<style id="caribou-tokens">${TOKENS_CSS}</style>`
