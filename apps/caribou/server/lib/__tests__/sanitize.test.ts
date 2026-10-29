import { describe, it, expect } from 'vitest'
import { sanitize, sanitizeAccount, sanitizeStatus } from '../sanitize.js'

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

describe('sanitizeStatus', () => {
  it('cleans content and keeps every other field', () => {
    const out = sanitizeStatus({ id: '1', content: '<p>ok</p><script>bad()</script>' })
    expect(out).toEqual({ id: '1', content: '<p>ok</p>' })
  })

  it('cleans the boosted post too', () => {
    const out = sanitizeStatus({
      id: '2',
      content: '',
      reblog: { id: '1', content: '<p onclick="x()">boosted</p>' },
    })
    expect(out.reblog).toEqual({ id: '1', content: '<p>boosted</p>' })
  })

  it('leaves a missing reblog missing', () => {
    expect('reblog' in sanitizeStatus({ id: '1', content: '<p>a</p>' })).toBe(false)
    expect(sanitizeStatus({ id: '1', content: '<p>a</p>', reblog: null }).reblog).toBeNull()
  })

  // The server render prints the media, so the page data must carry it to
  // the client unchanged, or the first client render would differ.
  it('passes media through, on the post and on the boosted post', () => {
    const media = [{ id: 'm', type: 'image', previewUrl: 'https://x.example/m.png', description: 'alt' }]
    const out = sanitizeStatus({ id: '2', content: '', mediaAttachments: media, reblog: { id: '1', content: '', mediaAttachments: media } })
    expect(out.mediaAttachments).toEqual(media)
    expect(out.reblog.mediaAttachments).toEqual(media)
  })

  it('turns null content into an empty string', () => {
    expect(sanitizeStatus({ id: '1', content: null }).content).toBe('')
  })
})

describe('sanitizeAccount', () => {
  it('cleans the note and keeps every other field', () => {
    const out = sanitizeAccount({ acct: 'alice@example.social', note: '<p>hi</p><img src=x onerror="x()">' })
    expect(out.acct).toBe('alice@example.social')
    expect(out.note).not.toContain('onerror')
    expect(out.note).toContain('<p>hi</p>')
  })
})
