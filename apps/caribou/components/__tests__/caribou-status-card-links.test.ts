import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LitroRouter } from '@beatzball/litro-router'
import '../caribou-status-card.js'
import { profilePath, type CaribouStatusCard } from '../caribou-status-card.js'

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

  it('leaves hashtags, external links and unknown mentions to the browser', async () => {
    const el = await mount()
    document.addEventListener('click', stop)
    for (const href of ['https://example.social/tags/AI', 'https://example.com/a', 'https://example.social/@carol']) {
      click(el, href)
      await flush()
      expect(goSpy, `should not route ${href}`).not.toHaveBeenCalled()
    }
    expect(seen).toEqual([false, false, false])
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
