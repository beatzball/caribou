# @beatzball/caribou-design-tokens

> CSS custom properties + a UnoCSS preset that maps utility classes onto them.

**Status:** Extractable — themable via the preset, no Caribou-specific shapes.

## Purpose

Two layers ship together. `tokens.css` defines the variables — colors,
radii, spacing scale, font stacks — under `:root` (dark) and
`[data-theme="light"]` (light), so a single attribute on `<html>` flips
the theme without rebuilding stylesheets. `uno-preset.ts` exposes a
UnoCSS `presetCaribou()` that translates utility classes
(`bg-1`, `p-3`, `rounded-md`) into rules that read those variables.
Hand-written CSS and utility classes both end up referring to the same
custom properties, so the theme switch propagates everywhere.

## Position in the stack

- **Depends on:** `unocss` (peer-style — only needed at build time for the preset's types)
- **Depended on by:** `apps/caribou-elena` (imports `tokens.css` once
  in the root layout; `uno.config.ts` uses `presetCaribou()`)
- **Boundary it owns:** the names and values of the design system.
  Components consume tokens via classes; they never hardcode hex codes
  or pixel values.

## Public API

Two entry points, one purpose:

- `@beatzball/caribou-design-tokens/tokens.css` — import once, anywhere
  in the root layout. Defines `:root` (dark default) and
  `[data-theme="light"]` overrides on the same set of variables.
- `@beatzball/caribou-design-tokens/uno-preset` → `presetCaribou(): Preset`
  — drop into `unocss.config.ts`'s `presets: [...]`. Adds rules for
  background (`bg-0`/`bg-1`/`bg-2`/`bg-accent`), foreground
  (`fg-0`/`fg-1`/`fg-muted`/`fg-accent`/`text-accent`/`fg-danger`/`fg-success`),
  borders (`border-token`), radii (`rounded-{sm,md,lg}`), and spacing
  scale (`p-1`..`p-6`, `m-`, `mx-`, `my-`, `gap-`, `px-`, `py-`),
  and font-family utilities (`font-body`, `font-mono`).

## How it works

**Single source of truth — variables in CSS, references in the preset.**
The preset never inlines hex codes; every rule emits
`color: var(--fg-0)` etc. Switching themes means flipping the
attribute on `<html>` — no class-rebuild, no JS, no per-component
work. SSR ships the dark theme by default (matches `color-scheme: dark`)
and the no-JS path picks the same theme without flicker.

**`border-token`, not `border`.** `presetUno`'s `border` shorthand
collides with our token name. Renaming to `border-token` keeps both
worlds — utility-class users can still write `border` for the
shorthand, and our token is reachable as `border-token`. Same hazard
exists for any future token name that overlaps a UnoCSS shorthand;
the convention is `-token` suffix when it does.

## Gotchas

- **Spacing scale is fixed at 1..6.** The regex rules
  (`/^p-([1-6])$/`) hard-code the range. Adding `--space-7` to
  `tokens.css` won't make `p-7` work until the regex is updated.
  Easy to miss because the failure is silent (the class just won't
  match).
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
`bg-0`, `fg-muted`, `accent`), and the preset is a pure UnoCSS plugin.
Lifting it to its own package would require: (1) renaming to drop the
Caribou prefix, (2) a release decision about whether `bg-0/1/2` is the
right naming convention (the alternatives — `bg-canvas/elevated/sunken`
— are more meaningful but less ergonomic), and (3) docs on the
`-token` suffix convention. None of that is hard, just unmotivated
until a second consumer appears.

## See also

- `apps/caribou-elena/uno.config.ts` — the only current consumer
- The variable list and theme switching is documented inline in
  `tokens.css`; no separate spec.
