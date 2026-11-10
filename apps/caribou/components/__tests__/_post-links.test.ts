import { describe, expect, it } from 'vitest'
import { blueskyTagPathOf } from '../_post-links.js'

// A tag link in a Bluesky post (README, "Tag links in Bluesky posts").

function link(href: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.setAttribute('href', href)
  a.textContent = '#x'
  return a
}

const post = (tags: string[]) => ({ tags: tags.map((name) => ({ name })), bluesky: {} })

describe('blueskyTagPathOf', () => {
  it('answers the in-app path for a tag the post lists', () => {
    expect(blueskyTagPathOf(link('/tags/Cats?net=bsky'), post(['Cats']))).toBe('/tags/Cats?net=bsky')
    expect(blueskyTagPathOf(link('/tags/caf%C3%A9?net=bsky'), post(['café']))).toBe('/tags/caf%C3%A9?net=bsky')
  })

  it('ignores a tag the post does not list, another path, or a Mastodon post', () => {
    expect(blueskyTagPathOf(link('/tags/Dogs?net=bsky'), post(['Cats']))).toBeNull()
    expect(blueskyTagPathOf(link('/tags/Cats'), post(['Cats']))).toBeNull()
    expect(blueskyTagPathOf(link('https://evil.example/tags/Cats?net=bsky'), post(['Cats']))).toBeNull()
    expect(blueskyTagPathOf(link('/@did:plc:alice'), post(['Cats']))).toBeNull()
    expect(blueskyTagPathOf(link('/tags/Cats?net=bsky'), { tags: [{ name: 'Cats' }] })).toBeNull()
  })
})
