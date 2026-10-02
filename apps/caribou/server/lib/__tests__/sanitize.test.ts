import { describe, it, expect } from 'vitest'
import { sanitize } from '../sanitize.js'

describe('sanitize', () => {
  it('strips disallowed tags (matches client allowlist)', () => {
    expect(sanitize('<p>ok</p><script>bad()</script>')).toBe('<p>ok</p>')
  })

  it('keeps allowed tags + attrs', () => {
    expect(sanitize('<p><a href="https://x" rel="nofollow">link</a></p>'))
      .toBe('<p><a href="https://x" rel="nofollow">link</a></p>')
  })

  it('strips data-attrs', () => {
    expect(sanitize('<p data-evil="x">ok</p>')).toBe('<p>ok</p>')
  })
})
