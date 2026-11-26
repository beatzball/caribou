// How dark the media viewer makes the page behind it: percent of black over
// the page. One table for the three places that show it: the dialog's
// `::backdrop`, the strips at the screen's edges, and the browser's own bars
// (the theme-color meta).

export const DIM = {
  // The backdrop also blurs the page.
  blur: 55,
  // No backdrop-filter: a darker tint makes up for the blur.
  solid: 80,
  // The reader asked for less see-through.
  reduced: 85,
} as const

// The viewer's stylesheet picks one row per case and puts it in `--dim` on
// the dialog. Read it back from there, so the browser's bars always match
// what the page shows. Blur's row if the dialog has none (no CSS yet).
export function dimOf(el: Element): number {
  const pct = parseFloat(getComputedStyle(el).getPropertyValue('--dim'))
  return (Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : DIM.blur) / 100
}
