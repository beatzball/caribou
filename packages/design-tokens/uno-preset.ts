import type { Preset } from 'unocss'

const RADIUS = { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' }

export function presetCaribou(): Preset {
  return {
    name: '@beatzball/caribou-design-tokens',
    rules: [
      // Background colors — bg-0/1/2 + bg-accent
      ['bg-0',      { 'background-color': 'var(--bg-0)' }],
      ['bg-1',      { 'background-color': 'var(--bg-1)' }],
      ['bg-2',      { 'background-color': 'var(--bg-2)' }],
      ['bg-accent', { 'background-color': 'var(--accent)' }],

      // Foreground (text) colors — fg-0/1/muted + accent variants + state
      ['fg-0',       { color: 'var(--fg-0)' }],
      ['fg-1',       { color: 'var(--fg-1)' }],
      ['fg-muted',   { color: 'var(--fg-muted)' }],
      ['fg-accent',  { color: 'var(--accent-fg)' }],
      ['text-accent',{ color: 'var(--accent)' }],
      ['fg-danger',  { color: 'var(--danger)' }],
      ['fg-success', { color: 'var(--success)' }],

      // Border — uses 'border-token' to avoid colliding with presetUno's `border` shorthand
      ['border-token', { 'border-color': 'var(--border)' }],

      // Radii
      [/^rounded-(sm|md|lg)$/, ([, k]) => ({ 'border-radius': RADIUS[k as keyof typeof RADIUS] })],

      // Spacing scale 1..6 → padding / margin / gap
      [/^p-([1-6])$/,  ([, n]) => ({ padding: `var(--space-${n})` })],
      [/^px-([1-6])$/, ([, n]) => ({
        'padding-left':  `var(--space-${n})`,
        'padding-right': `var(--space-${n})`,
      })],
      [/^py-([1-6])$/, ([, n]) => ({
        'padding-top':    `var(--space-${n})`,
        'padding-bottom': `var(--space-${n})`,
      })],
      [/^m-([1-6])$/,   ([, n]) => ({ margin: `var(--space-${n})` })],
      [/^mx-([1-6])$/, ([, n]) => ({
        'margin-left':  `var(--space-${n})`,
        'margin-right': `var(--space-${n})`,
      })],
      [/^my-([1-6])$/, ([, n]) => ({
        'margin-top':    `var(--space-${n})`,
        'margin-bottom': `var(--space-${n})`,
      })],
      [/^gap-([1-6])$/, ([, n]) => ({ gap: `var(--space-${n})` })],

      // Font families
      ['font-body', { 'font-family': 'var(--font-body)' }],
      ['font-mono', { 'font-family': 'var(--font-mono)' }],
    ],
  }
}
