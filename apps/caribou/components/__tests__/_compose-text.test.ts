import { describe, expect, it } from 'vitest'
import type { mastodon } from 'masto'
import { countChars, plainText, replyMentions, replyVisibility } from '../_compose-text.js'

function status(acct: string, mentions: string[]): mastodon.v1.Status {
  return {
    account: { acct },
    mentions: mentions.map((m) => ({ acct: m })),
  } as unknown as mastodon.v1.Status
}

describe('countChars', () => {
  it('counts code points, so an emoji is one character', () => {
    expect(countChars('hi 👋')).toBe(4)
  })

  it('counts every link as 23 characters', () => {
    expect(countChars('see https://example.social/a/very/long/path?with=query')).toBe(4 + 23)
    expect(countChars('http://x.y')).toBe(23)
  })

  it('counts a remote mention by its local part only', () => {
    expect(countChars('@alice@example.social hi')).toBe('@alice hi'.length)
    expect(countChars('hey @bob')).toBe(8)
  })

  it('counts grapheme clusters: a family or a flag is one character', () => {
    expect(countChars('👨‍👩‍👧')).toBe(1)
    expect(countChars('🇯🇵!')).toBe(2)
    expect(countChars('e\u0301')).toBe(1)
    expect(countChars('ok', '👨‍👩‍👧')).toBe(3)
  })

  it('does not count trailing punctuation or an unbalanced ) as part of a link', () => {
    expect(countChars('see https://example.social/a.')).toBe(4 + 23 + 1)
    expect(countChars('https://example.social/a?!')).toBe(23 + 2)
    expect(countChars('(https://example.social/a)')).toBe(1 + 23 + 1)
    expect(countChars('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe(23)
  })

  it('adds the spoiler text', () => {
    expect(countChars('abc', 'cw')).toBe(5)
  })
})

describe('replyMentions', () => {
  it('starts with the author, then the mentioned accounts, minus yourself and repeats', () => {
    const s = status('bob@example.social', ['alice', 'carol@example.net', 'BOB@example.social'])
    expect(replyMentions(s, 'alice')).toBe('@bob@example.social @carol@example.net ')
  })

  it('is empty when you reply to yourself alone', () => {
    expect(replyMentions(status('alice', []), 'alice')).toBe('')
  })
})

describe('replyVisibility', () => {
  it('keeps the more private of the two', () => {
    expect(replyVisibility('private', 'public')).toBe('private')
    expect(replyVisibility('public', 'unlisted')).toBe('unlisted')
    expect(replyVisibility('direct', 'public')).toBe('direct')
  })
})

describe('plainText', () => {
  it('drops markup and keeps line breaks', () => {
    expect(plainText('<p>one<br>two</p><p>three <a href="x">link</a></p>')).toBe('one\ntwo\nthree link')
  })

  it('leaves out script and style text', () => {
    expect(plainText('<style>p{}</style><script>var x = 1</script><p>ok</p>')).toBe('ok')
  })
})
