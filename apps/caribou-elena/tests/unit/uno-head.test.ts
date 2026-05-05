import { describe, it, expect } from 'vitest'
import { UNO_HEAD } from '../../server/lib/uno-head.js'

describe('UNO_HEAD', () => {
  it('wraps the generated UnoCSS in a <style id="caribou-uno"> tag', () => {
    expect(UNO_HEAD.startsWith('<style id="caribou-uno">')).toBe(true)
    expect(UNO_HEAD.endsWith('</style>')).toBe(true)
  })

  it('contains generated CSS (non-empty after the prefix)', () => {
    const inner = UNO_HEAD.slice('<style id="caribou-uno">'.length, -'</style>'.length)
    expect(inner.length).toBeGreaterThan(0)
  })
})
