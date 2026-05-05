import { describe, it, expect } from 'vitest'
import { createGenerator } from 'unocss'
import { presetCaribou } from '../uno-preset.js'

const SAMPLES = [
  // background colors
  { cls: 'bg-0',         css: 'background-color:var(--bg-0)' },
  { cls: 'bg-1',         css: 'background-color:var(--bg-1)' },
  { cls: 'bg-2',         css: 'background-color:var(--bg-2)' },
  // foreground colors
  { cls: 'fg-0',         css: 'color:var(--fg-0)' },
  { cls: 'fg-1',         css: 'color:var(--fg-1)' },
  { cls: 'fg-muted',     css: 'color:var(--fg-muted)' },
  // accent + state colors
  { cls: 'text-accent',  css: 'color:var(--accent)' },
  { cls: 'bg-accent',    css: 'background-color:var(--accent)' },
  { cls: 'fg-accent',    css: 'color:var(--accent-fg)' },
  { cls: 'fg-danger',    css: 'color:var(--danger)' },
  { cls: 'fg-success',   css: 'color:var(--success)' },
  // border (renamed to border-token to avoid presetUno collision)
  { cls: 'border-token', css: 'border-color:var(--border)' },
  // radius
  { cls: 'rounded-sm',   css: 'border-radius:var(--radius-sm)' },
  { cls: 'rounded-md',   css: 'border-radius:var(--radius-md)' },
  { cls: 'rounded-lg',   css: 'border-radius:var(--radius-lg)' },
  // padding (full)
  { cls: 'p-1',          css: 'padding:var(--space-1)' },
  { cls: 'p-4',          css: 'padding:var(--space-4)' },
  { cls: 'p-6',          css: 'padding:var(--space-6)' },
  // padding (axis)
  { cls: 'px-3',         css: 'padding-left:var(--space-3);padding-right:var(--space-3)' },
  { cls: 'py-2',         css: 'padding-top:var(--space-2);padding-bottom:var(--space-2)' },
  // margin (full)
  { cls: 'm-2',          css: 'margin:var(--space-2)' },
  // gap
  { cls: 'gap-3',        css: 'gap:var(--space-3)' },
]

describe('presetCaribou', () => {
  it('generates the expected CSS for every sampled utility', async () => {
    const uno = await createGenerator({
      presets: [presetCaribou()],
    })
    const classes = SAMPLES.map((s) => s.cls).join(' ')
    const { css } = await uno.generate(classes, { preflights: false })
    const flat = css.replace(/\s+/g, '')
    for (const sample of SAMPLES) {
      const expected = sample.css.replace(/\s+/g, '')
      expect(flat, `expected "${sample.cls}" → "${sample.css}"`).toContain(expected)
    }
  })

  it('rejects unknown utilities (does not crash)', async () => {
    const uno = await createGenerator({
      presets: [presetCaribou()],
    })
    const { css } = await uno.generate('not-a-real-class', { preflights: false })
    expect(css).not.toContain('not-a-real-class')
  })
})
