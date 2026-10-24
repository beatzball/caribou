# @beatzball/caribou-design-tokens

> CSS custom properties for the Caribou design system.

**Status:** Extractable — no Caribou-specific shapes.

## Purpose

`tokens.css` defines the variables — colors, radii, spacing scale, font
stacks — under `:root` (dark) and `[data-theme="light"]` (light), so a
single attribute on `<html>` flips the theme without rebuilding
stylesheets. Components write their own CSS against these variables, so
the theme switch propagates everywhere, including through shadow roots.

## Position in the stack

- **Depends on:** nothing.
- **Depended on by:** `apps/caribou` (inlines `tokens.css` into every
  page's `<head>` at build time).
- **Boundary it owns:** the names and values of the design system.
  Components consume tokens via `var(--…)`; they never hardcode hex codes
  or pixel values.

## Public API

- `@beatzball/caribou-design-tokens/tokens.css` — import once, anywhere
  in the root layout. Defines `:root` (dark default) and
  `[data-theme="light"]` overrides on the same set of variables.

## How it works

Switching themes means flipping the attribute on `<html>` — no
class-rebuild, no JS, no per-component work. SSR ships the dark theme by
default (matches `color-scheme: dark`) and the no-JS path picks the same
theme without flicker.

## Gotchas

- **Only `data-theme="light"` overrides; "system" requires extra wiring.**
  There's no built-in mechanism to follow `prefers-color-scheme`. The
  app handles that by toggling the `data-theme` attribute from JS
  (or omitting it for the dark default). Pure-CSS `@media (prefers-color-scheme)` would
  duplicate the override block.
- **No typography scale.** Font sizes are not in the tokens. Currently
  components set `font-size` directly. If we add a scale, callers
  using inline sizes will not pick it up automatically.

## Externalization potential

**Extractable.** The tokens are generic (no Caribou-specific names —
`bg-0`, `fg-muted`, `accent`). Lifting it to its own package would
require: (1) renaming to drop the Caribou prefix, and (2) a release
decision about whether `bg-0/1/2` is the right naming convention (the
alternatives — `bg-canvas/elevated/sunken` — are more meaningful but less
ergonomic). None of that is hard, just unmotivated until a second
consumer appears.

## See also

- `apps/caribou/scripts/write-tokens-head.mjs` — the only current consumer
- The variable list and theme switching is documented inline in
  `tokens.css`; no separate spec.
