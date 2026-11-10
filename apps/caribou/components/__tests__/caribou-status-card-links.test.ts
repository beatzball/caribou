import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LitroRouter } from '@beatzball/litro-router'
import { html, render } from 'lit'
import '../caribou-status-card.js'
import '../caribou-app-shell.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import { postPath, profilePath } from '../_profile-path.js'

// Spy on the real router: the click handler reaches it through a dynamic
// import, and both import forms must observe the same callable.
const goSpy = vi.spyOn(LitroRouter, 'go').mockImplementation(async () => {})

const LOCAL = '<span class="h-card"><a href="https://example.social/@alice" class="u-url mention">@<span>alice</span></a></span>'
const REMOTE = '<span class="h-card"><a href="https://other.example/@bob" class="u-url mention" target="_blank" rel="noopener noreferrer">@<span>bob</span></a></span>'
const TAG = '<a href="https://example.social/tags/AI" class="mention hashtag" rel="tag">#<span>AI</span></a>'
const EXTERNAL = '<a href="https://example.com/a" target="_blank" rel="nofollow noopener noreferrer">example.com/a</a>'
const UNKNOWN = '<a href="https://example.social/@carol" class="u-url mention">@<span>carol</span></a>'

const post = (over: Record<string, unknown> = {}) => ({
  id: '1',
  content: `<p>${LOCAL} ${REMOTE} ${TAG} ${EXTERNAL} ${UNKNOWN}</p>`,
  account: { id: '1', acct: 'dave', username: 'dave', displayName: 'Dave', avatar: '', avatarStatic: '' },
  createdAt: '2026-04-28T12:00:00Z',
  mentions: [
    { id: '2', username: 'alice', acct: 'alice', url: 'https://example.social/@alice' },
    { id: '3', username: 'bob', acct: 'bob@other.example', url: 'https://other.example/@bob' },
  ],
  tags: [{ name: 'AI', url: 'https://example.social/tags/AI' }],
  ...over,
}) as unknown as CaribouStatusCard['status']

async function mount(status = post(), instance = 'example.social'): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.instance = instance
  el.status = status
  document.body.appendChild(el)
  await el.updateComplete
  await el.updateComplete
  return el
}

// Let the handler's `import(...).then(...)` chain run to completion.
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

// Click the inner `<span>`, as a reader would: the handler must find the anchor.
function click(el: CaribouStatusCard, href: string, init: MouseEventInit = {}): MouseEvent {
  const a = el.shadowRoot!.querySelector(`.status-content a[href="${href}"]`)!
  const target = a.querySelector('span') ?? a
  const e = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0, ...init })
  target.dispatchEvent(e)
  return e
}

// Stop the browser default at the document so happy-dom does not navigate,
// after recording whether the card had already cancelled it. A click left to
// the browser must arrive here still uncancelled.
const seen: boolean[] = []
const stop = (e: Event) => {
  seen.push(e.defaultPrevented)
  e.preventDefault()
}

describe('<caribou-status-card> body links', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    goSpy.mockClear()
    seen.length = 0
  })
  afterEach(() => { document.removeEventListener('click', stop) })

  it('routes a local mention to its profile page on the instance', async () => {
    const el = await mount()
    const e = click(el, 'https://example.social/@alice')
    await flush()
    expect(e.defaultPrevented).toBe(true)
    expect(goSpy).toHaveBeenCalledWith('/@alice@example.social')
  })

  it('routes a remote mention, even with target=_blank', async () => {
    const el = await mount()
    const e = click(el, 'https://other.example/@bob')
    await flush()
    expect(e.defaultPrevented).toBe(true)
    expect(goSpy).toHaveBeenCalledWith('/@bob@other.example')
  })

  it("routes the inner post's mentions on a boost", async () => {
    const inner = post()
    const wrapper = post({ id: '9', content: '', mentions: [], reblog: inner })
    const el = await mount(wrapper)
    click(el, 'https://example.social/@alice')
    await flush()
    expect(goSpy).toHaveBeenCalledWith('/@alice@example.social')
  })

  it('takes the host from the mention url when no instance is known', async () => {
    const el = await mount(post(), '')
    click(el, 'https://example.social/@alice')
    await flush()
    expect(goSpy).toHaveBeenCalledWith('/@alice@example.social')
  })

  it('leaves external links and unknown mentions to the browser', async () => {
    const el = await mount()
    document.addEventListener('click', stop)
    for (const href of ['https://example.com/a', 'https://example.social/@carol']) {
      click(el, href)
      await flush()
      expect(goSpy, `should not route ${href}`).not.toHaveBeenCalled()
    }
    expect(seen).toEqual([false, false])
  })

  it('routes a hashtag to its tag page, keeping the case the post wrote', async () => {
    const el = await mount()
    const e = click(el, 'https://example.social/tags/AI')
    await flush()
    expect(e.defaultPrevented).toBe(true)
    expect(goSpy).toHaveBeenCalledWith('/tags/AI')
  })

  it('matches the tag list without regard to case', async () => {
    const el = await mount(post({ tags: [{ name: 'ai', url: 'https://example.social/tags/ai' }] }))
    click(el, 'https://example.social/tags/AI')
    await flush()
    expect(goSpy).toHaveBeenCalledWith('/tags/AI')
  })

  // Mastodon stores `#Café` as `cafe` (ASCII folding).
  it('matches an accented hashtag to the folded name the server lists', async () => {
    const href = `https://example.social/tags/${encodeURIComponent('Café')}`
    const el = await mount(post({
      content: `<p><a href="${href}" class="mention hashtag" rel="tag">#<span>Café</span></a></p>`,
      tags: [{ name: 'cafe', url: 'https://example.social/tags/cafe' }],
    }))
    click(el, href)
    await flush()
    expect(goSpy).toHaveBeenCalledWith(`/tags/${encodeURIComponent('Café')}`)
  })

  // The server lists `#ΟΣ` as `οσ` (Ruby's downcase has no final-sigma rule).
  it('matches a Greek hashtag ending in Σ to the name the server lists', async () => {
    const href = `https://example.social/tags/${encodeURIComponent('ΟΣ')}`
    const el = await mount(post({
      content: `<p><a href="${href}" class="mention hashtag" rel="tag">#<span>ΟΣ</span></a></p>`,
      tags: [{ name: 'οσ', url: `https://example.social/tags/${encodeURIComponent('οσ')}` }],
    }))
    click(el, href)
    await flush()
    expect(goSpy).toHaveBeenCalledWith(`/tags/${encodeURIComponent('ΟΣ')}`)
  })

  it('leaves modified, non-primary and handled clicks on a hashtag to the browser', async () => {
    const el = await mount()
    const href = 'https://example.social/tags/AI'
    document.addEventListener('click', stop)
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      click(el, href, init)
      await flush()
      expect(goSpy, `should not route with ${JSON.stringify(init)}`).not.toHaveBeenCalled()
    }
    expect(seen).toEqual([false, false, false, false, false])
    const a = el.shadowRoot!.querySelector(`.status-content a[href="${href}"]`)!
    a.addEventListener('click', (e) => e.preventDefault(), { once: true })
    click(el, href)
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('routes a non-ASCII hashtag', async () => {
    const href = `https://example.social/tags/${encodeURIComponent('日本')}`
    const el = await mount(post({
      content: `<p><a href="${href}" class="mention hashtag" rel="tag">#<span>日本</span></a></p>`,
      tags: [{ name: '日本', url: href }],
    }))
    click(el, href)
    await flush()
    expect(goSpy).toHaveBeenCalledWith(`/tags/${encodeURIComponent('日本')}`)
  })

  it('routes a remote post\'s hashtag too, by rel="tag" alone', async () => {
    const href = 'https://other.example/tags/Rust'
    const el = await mount(post({
      content: `<p><a href="${href}" rel="tag">#Rust</a></p>`,
      tags: [{ name: 'rust', url: 'https://example.social/tags/rust' }],
    }))
    click(el, href)
    await flush()
    expect(goSpy).toHaveBeenCalledWith('/tags/Rust')
  })

  it('leaves a hashtag the post does not list to the browser', async () => {
    const el = await mount(post({ tags: [] }))
    document.addEventListener('click', stop)
    click(el, 'https://example.social/tags/AI')
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
    expect(seen).toEqual([false])
  })

  it('keeps the hashtag\'s real href in the markup', async () => {
    const el = await mount()
    const a = el.shadowRoot!.querySelector('.status-content a.hashtag')!
    expect(a.getAttribute('href')).toBe('https://example.social/tags/AI')
  })

  it('leaves modified, non-primary and handled clicks to the browser', async () => {
    const el = await mount()
    document.addEventListener('click', stop)
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      click(el, 'https://example.social/@alice', init)
      await flush()
      expect(goSpy, `should not route with ${JSON.stringify(init)}`).not.toHaveBeenCalled()
    }
    expect(seen).toEqual([false, false, false, false, false])
    const a = el.shadowRoot!.querySelector('.status-content a')!
    a.addEventListener('click', (e) => e.preventDefault(), { once: true })
    click(el, 'https://example.social/@alice')
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('does not change the rendered body HTML', async () => {
    const el = await mount()
    const html = el.shadowRoot!.querySelector('.status-content')!.innerHTML.replace(/<!--[\s\S]*?-->/g, '')
    expect(html).toBe(post()!.content)
  })
})

describe('profilePath', () => {
  it('adds the host to a local acct', () => {
    expect(profilePath('alice', 'example.social')).toBe('/@alice@example.social')
  })
  it('keeps a remote acct as it is', () => {
    expect(profilePath('bob@other.example', 'example.social')).toBe('/@bob@other.example')
  })
  it('keeps the bare handle when no host is known', () => {
    expect(profilePath('alice', '')).toBe('/@alice')
  })
  // Spec 8.4: a bare dotted `/@name` is a Bluesky handle route now.
  it('with no host, takes the host from the account url', () => {
    expect(profilePath('first.last', '', 'https://pleroma.example/users/first.last')).toBe('/@first.last@pleroma.example')
    expect(profilePath('alice', '', 'https://example.social/@alice')).toBe('/@alice@example.social')
  })
  it('the order: an acct with a host, then the host given, then the url', () => {
    expect(profilePath('bob@other.example', 'example.social', 'https://third.example/@bob')).toBe('/@bob@other.example')
    expect(profilePath('alice', 'example.social', 'https://third.example/@alice')).toBe('/@alice@example.social')
  })
  describe('postPath never makes a bare dotted name for a Mastodon post (spec 8.4)', () => {
    const post = (acct: string, accountUrl?: string, url?: string | null) =>
      ({ id: '9', account: { acct, ...(accountUrl !== undefined ? { url: accountUrl } : {}) }, ...(url !== undefined ? { url } : {}) })

    it('leaves a local name with no dot, and a name with a host, as they were', () => {
      expect(postPath(post('alice', 'https://example.social/@alice'))).toBe('/@alice/9')
      expect(postPath(post('bob@other.example'))).toBe('/@bob@other.example/9')
    })

    it('a dotted name: the host given first, then the account url\'s host', () => {
      expect(postPath(post('first.last', 'https://pleroma.example/users/first.last'), 'example.social')).toBe('/@first.last@example.social/9')
      expect(postPath(post('first.last', 'https://pleroma.example/users/first.last'))).toBe('/@first.last@pleroma.example/9')
    })

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['invalid', 'not a url'],
      ['not http', 'javascript:alert(1)'],
    ])('a dotted name with no host and an account url %s: the post\'s own url, else no link', (_name, accountUrl) => {
      expect(postPath(post('first.last', accountUrl, 'https://pleroma.example/notice/9'))).toBe('https://pleroma.example/notice/9')
      expect(postPath(post('first.last', accountUrl, null))).toBeNull()
      expect(postPath(post('first.last', accountUrl, ''))).toBeNull()
      expect(postPath(post('first.last', accountUrl, 'javascript:alert(1)'))).toBeNull()
    })
  })
  it('never makes a bare dotted name: with no host and no url it links to a search', () => {
    expect(profilePath('first.last', '')).toBe('/search?q=%40first.last')
    expect(profilePath('first.last', '', 'not a url')).toBe('/search?q=%40first.last')
    expect(profilePath('first.last', '', 'javascript:alert(1)')).toBe('/search?q=%40first.last')
  })
})

describe('<caribou-status-card> author link', () => {
  const author = (el: CaribouStatusCard) => el.shadowRoot!.querySelector<HTMLAnchorElement>('header a.author')!
  const press = (target: Element, init: MouseEventInit = {}) => {
    const e = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0, ...init })
    target.dispatchEvent(e)
    return e
  }

  beforeEach(() => {
    document.body.replaceChildren()
    goSpy.mockClear()
  })

  it('is one link around avatar, name and acct, beside the permalink', async () => {
    const el = await mount()
    const a = author(el)
    expect(a.getAttribute('href')).toBe('/@dave@example.social')
    expect(a.querySelector('img')!.getAttribute('alt')).toBe('')
    expect(a.querySelector('strong')!.textContent).toBe('Dave')
    expect(a.querySelector('.acct')!.textContent).toBe('@dave')
    expect(el.shadowRoot!.querySelectorAll('header a')).toHaveLength(1)
    expect(a.querySelector('litro-link')).toBeNull()
    expect(a.closest('litro-link')).toBeNull()
  })

  it('keeps a remote author\'s acct as it is', async () => {
    const remote = post({ account: { id: '5', acct: 'erin@other.example', username: 'erin', displayName: 'Erin', avatar: '', avatarStatic: '' } })
    const el = await mount(remote)
    expect(author(el).getAttribute('href')).toBe('/@erin@other.example')
  })

  it('takes a local author\'s host from the account URL when no instance is known', async () => {
    const local = post({ account: { id: '1', acct: 'dave', username: 'dave', displayName: 'Dave', avatar: '', avatarStatic: '', url: 'https://example.social/@dave' } })
    const el = await mount(local, '')
    expect(author(el).getAttribute('href')).toBe('/@dave@example.social')
  })

  it('takes a local author\'s host from the shell after mount, over the account URL', async () => {
    const local = post({ account: { id: '1', acct: 'dave', username: 'dave', displayName: 'Dave', avatar: '', avatarStatic: '', url: 'https://web.example/@dave' } })
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(html`<caribou-app-shell instance="shell.example"><caribou-status-card .status=${local}></caribou-status-card></caribou-app-shell>`, host)
    const el = host.querySelector('caribou-status-card') as CaribouStatusCard
    while (!(await el.updateComplete)) { /* settle */ }
    expect(author(el).getAttribute('href')).toBe('/@dave@shell.example')
  })

  it('links the inner post\'s author on a boost, and the booster in the boost line', async () => {
    const booster = { id: '7', acct: 'frank', username: 'frank', displayName: 'Frank', avatar: '', avatarStatic: '' }
    const el = await mount(post({ id: '9', content: '', mentions: [], account: booster, reblog: post() }))
    expect(author(el).getAttribute('href')).toBe('/@dave@example.social')
    const line = el.shadowRoot!.querySelector('.boost-attribution a')!
    expect(line.getAttribute('href')).toBe('/@frank@example.social')
    expect(line.textContent).toBe('Frank')
  })

  it('routes a plain click on the avatar or the name inside Caribou', async () => {
    const el = await mount()
    for (const target of [author(el).querySelector('img')!, author(el).querySelector('strong')!]) {
      goSpy.mockClear()
      const e = press(target)
      await flush()
      expect(e.defaultPrevented).toBe(true)
      expect(goSpy).toHaveBeenCalledWith('/@dave@example.social')
    }
  })

  it('leaves a modified or middle click to the browser', async () => {
    const el = await mount()
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { button: 1 }]) {
      const e = press(author(el).querySelector('strong')!, init)
      e.preventDefault()
      await flush()
    }
    expect(goSpy).not.toHaveBeenCalled()
  })
})

describe('a time link that leaves Caribou (postPath, #187 review)', () => {
  const dotted = (url: string | null) => post({
    url, account: { id: '1', acct: 'first.last', username: 'first.last', displayName: 'F', avatar: '', avatarStatic: '', url: '' },
  })

  it('opens the post on its server in a new tab, and its name says so', async () => {
    const el = await mount(dotted('https://pleroma.example/notice/1'), '')
    const a = el.shadowRoot!.querySelector<HTMLAnchorElement>('a.permalink')!
    expect(a.getAttribute('href')).toBe('https://pleroma.example/notice/1')
    expect(a.target).toBe('_blank')
    expect(a.getAttribute('aria-label')).toMatch(/opens this post on its own server in a new tab$/)
    expect(a.getAttribute('aria-label')).toContain(a.textContent!.trim())
  })

  it('with no usable url, the time is not a link', async () => {
    const el = await mount(dotted(null), '')
    expect(el.shadowRoot!.querySelector('a.permalink, litro-link.permalink')).toBeNull()
    expect(el.shadowRoot!.querySelector('span.permalink time')).not.toBeNull()
  })

  it('a link inside Caribou keeps its plain name', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('litro-link.permalink')!.hasAttribute('aria-label')).toBe(false)
  })

  // #193: a Bluesky tag link (`/tags/<tag>?net=bsky`, from the facet
  // renderer) opens the Bluesky hashtag page in the app.
  it('routes a tag link in a Bluesky post to its Bluesky tag page', async () => {
    const uri = 'at://did:plc:alice/app.bsky.feed.post/3kpost'
    const clean = { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }
    const contexts = Object.fromEntries(['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView'].map((c) => [c, clean]))
    const el = await mount(post({
      id: uri, uri, url: null, mentions: [],
      account: { id: 'did:plc:alice', acct: 'alice.example.com', username: 'alice.example.com', displayName: 'Alice', avatar: '', avatarStatic: '', bluesky: { did: 'did:plc:alice', handleInvalid: false, labels: [] } },
      content: '<p>hi <a href="/tags/Cats?net=bsky">#Cats</a> <a href="/tags/Dogs?net=bsky">#Dogs</a></p>',
      tags: [{ name: 'Cats', url: 'https://bsky.app/hashtag/Cats' }],
      bluesky: {
        uri, cid: 'c', likeUri: null, repostUri: null, replyRef: null, replyDisabled: false, embeddingDisabled: false,
        labels: [], moderation: { contexts, labelersCovered: [] }, viewerOf: null,
      },
    }), '')
    const e = click(el, '/tags/Cats?net=bsky')
    await flush()
    expect(e.defaultPrevented).toBe(true)
    expect(goSpy).toHaveBeenCalledWith('/tags/Cats?net=bsky')
    goSpy.mockClear()
    // A tag the post does not list is left to the browser.
    const other = click(el, '/tags/Dogs?net=bsky')
    await flush()
    expect(other.defaultPrevented).toBe(false)
    expect(goSpy).not.toHaveBeenCalled()
  })
})
