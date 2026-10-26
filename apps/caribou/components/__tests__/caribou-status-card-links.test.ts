import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LitroRouter } from '@beatzball/litro-router'
import '../caribou-status-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

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
