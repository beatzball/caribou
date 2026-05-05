import { describe, it, expect } from 'vitest'
import { PURIFY_OPTS } from '../sanitize-opts.js'

describe('PURIFY_OPTS', () => {
  it('matches the contract from §12.5 of the spec', () => {
    expect(PURIFY_OPTS.ALLOWED_TAGS).toEqual([
      'p',
      'br',
      'a',
      'span',
      'em',
      'strong',
      'ul',
      'ol',
      'li',
      'code',
      'pre',
    ])
    expect(PURIFY_OPTS.ALLOWED_ATTR).toEqual(['href', 'rel', 'target', 'class', 'lang'])
    expect(PURIFY_OPTS.ALLOW_DATA_ATTR).toBe(false)
  })
})
