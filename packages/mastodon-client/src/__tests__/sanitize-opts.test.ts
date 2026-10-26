import { describe, it, expect, vi } from 'vitest'
import { PURIFY_OPTS, forceSafeTargetRel, installPurifyHooks } from '../sanitize-opts.js'

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

function anchor(attrs: Record<string, string>, tagName = 'A') {
  const map = new Map(Object.entries(attrs))
  return {
    tagName,
    getAttribute: (n: string) => map.get(n) ?? null,
    setAttribute: (n: string, v: string) => { map.set(n, v) },
    attrs: map,
  }
}

describe('forceSafeTargetRel', () => {
  it('adds noopener and noreferrer to a target=_blank link', () => {
    const a = anchor({ href: 'https://example.com', target: '_blank' })
    forceSafeTargetRel(a)
    expect(a.attrs.get('rel')).toBe('noopener noreferrer')
  })

  it('keeps the words already there and adds only the missing ones', () => {
    const a = anchor({ target: '_blank', rel: 'nofollow noopener' })
    forceSafeTargetRel(a)
    expect(a.attrs.get('rel')).toBe('nofollow noopener noreferrer')
  })

  it("leaves Mastodon's rel exactly as it was", () => {
    const a = anchor({ target: '_blank', rel: 'nofollow noopener noreferrer' })
    const set = vi.spyOn(a, 'setAttribute')
    forceSafeTargetRel(a)
    expect(set).not.toHaveBeenCalled()
  })

  it.each(['_BLANK', '_Blank', 'win'])('treats target=%s as a new window', (target) => {
    const a = anchor({ target })
    forceSafeTargetRel(a)
    expect(a.attrs.get('rel')).toBe('noopener noreferrer')
    expect(a.attrs.get('target')).toBe(target)
  })

  it('keeps rel=opener and adds the words that override it', () => {
    const a = anchor({ target: '_blank', rel: 'opener' })
    forceSafeTargetRel(a)
    expect(a.attrs.get('rel')).toBe('opener noopener noreferrer')
  })

  it('matches rel words without case and does not rewrite them', () => {
    const a = anchor({ target: '_blank', rel: 'NoOpener NOREFERRER' })
    const set = vi.spyOn(a, 'setAttribute')
    forceSafeTargetRel(a)
    expect(set).not.toHaveBeenCalled()
  })

  it('leaves same-window links and other elements alone', () => {
    const same = ['', '_self', '_SELF', '_parent', '_top'].map((target) => anchor({ target }))
    for (const node of [anchor({ href: '/x' }), ...same, anchor({ target: '_blank' }, 'SPAN')]) {
      forceSafeTargetRel(node)
      expect(node.attrs.has('rel')).toBe(false)
    }
  })
})

describe('installPurifyHooks', () => {
  it('adds the hook once per instance', () => {
    const purify = { addHook: vi.fn() }
    installPurifyHooks(purify)
    installPurifyHooks(purify)
    expect(purify.addHook).toHaveBeenCalledTimes(1)
    expect(purify.addHook).toHaveBeenCalledWith('afterSanitizeAttributes', forceSafeTargetRel)
  })
})
