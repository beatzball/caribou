// Inlined UnoCSS `<style>` block injected into every SSR'd page's <head>.
// Same shape as TOKENS_HEAD: bake the generated CSS at build time so the
// deployed Docker image (which ships only `dist/`, no node_modules) doesn't
// need to load `unocss` at runtime.
//
// UNO_CSS is regenerated on every `pnpm build-meta` by
// scripts/write-uno-head.mjs.
import { UNO_CSS } from './uno-head.generated.js'

export const UNO_HEAD = `<style id="caribou-uno">${UNO_CSS}</style>`
