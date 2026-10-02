import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from '@beatzball/caribou-ui-headless'
import { sanitize } from '../../server/lib/sanitize.js'
import '../caribou-status-card.js'
import { statusPermalink } from '../caribou-status-card.js'
import type { CaribouStatusCard, StatusCardVariant } from '../caribou-status-card.js'

const fixture = (over: Partial<Record<string, unknown>> = {}): CaribouStatusCard['status'] => ({
  id: '1',
  content: '<p>hello</p>',
  account: { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' },
  createdAt: '2026-04-28T12:00:00Z',
  ...over,
}) as unknown as CaribouStatusCard['status']

// Lit leaves marker comments beside the rendered HTML; drop them to compare.
function contentHtml(el: CaribouStatusCard): string {
  return el.shadowRoot!.querySelector('.status-content')!.innerHTML.replace(/<!--[\s\S]*?-->/g, '')
}

async function mount(status = fixture(), variant?: StatusCardVariant): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  if (variant) el.variant = variant
  el.status = status
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('<caribou-status-card> variants', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it.each(['timeline', 'focused', 'ancestor', 'descendant'] as const)
    ('applies variant=%s on root <article>', async (v) => {
    const el = await mount(fixture(), v)
    const article = el.shadowRoot!.querySelector('article')!
    expect(article.dataset.variant).toBe(v)
    expect(el.getAttribute('variant')).toBe(v)
  })

  it('defaults to the timeline variant', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('article')!.dataset.variant).toBe('timeline')
  })

  it('does not mirror the status object to an attribute', async () => {
    const el = await mount()
    expect(el.hasAttribute('status')).toBe(false)
  })

  it('renders nothing without a status', async () => {
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    document.body.appendChild(el)
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('article')).toBeNull()
  })
})

describe('<caribou-status-card> timestamp', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it('prints an absolute timestamp on the first render, then a relative one', async () => {
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    el.variant = 'focused'
    el.status = fixture()
    document.body.appendChild(el)
    // Resolves after the first render; the switch to relative time is a
    // second update that is still pending here.
    await el.updateComplete

    const time = el.shadowRoot!.querySelector('time')!
    expect(time.getAttribute('datetime')).toBe('2026-04-28T12:00:00Z')
    // Same label the server prints — it does not read the clock.
    const absolute = new Date('2026-04-28T12:00:00Z').toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    expect(time.textContent!.trim()).toBe(absolute)

    await el.updateComplete
    expect(time.textContent!.trim()).toBe(formatRelativeTime('2026-04-28T12:00:00Z'))
    expect(time.textContent!.trim()).not.toBe(absolute)
    expect(el.shadowRoot!.querySelector('time')).toBe(time)
  })
})

describe('<caribou-status-card> sanitizing', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it('strips disallowed markup from client-rendered content', async () => {
    const el = await mount(fixture({
      content: '<p data-x="1" onclick="bad()">ok<img src="x" onerror="bad()"></p>',
    }))
    expect(contentHtml(el)).toBe('<p>ok</p>')
  })

  it('trusts the content for the one render that adopts a server-made shadow root, then re-sanitizes', async () => {
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    // Stands in for a declarative shadow root: it exists before Lit renders.
    el.attachShadow({ mode: 'open' })
    el.status = fixture({ content: '<p data-from-server="1">ok</p>' })
    document.body.appendChild(el)
    await el.updateComplete
    expect(contentHtml(el)).toBe('<p data-from-server="1">ok</p>')
    await el.updateComplete
    expect(contentHtml(el)).toBe('<p>ok</p>')
  })

  // The page's server sanitizer (jsdom) and the card's client sanitizer must
  // agree: content the server already cleaned must pass through the client
  // unchanged, or the re-sanitize after hydration would rewrite the post.
  it.each([
    '<p>plain text</p>',
    '<p>line one<br>line two</p>',
    '<p><span class="h-card"><a href="https://example.social/@alice" class="u-url mention">@<span>alice</span></a></span> hello &amp; welcome</p>',
    '<p><a href="https://example.social/tags/AI" class="mention hashtag" rel="tag">#<span>AI</span></a><a href="https://example.social/tags/Tech" class="mention hashtag" rel="tag">#<span>Tech</span></a></p>',
    '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="nofollow noopener noreferrer"><span class="invisible">https://</span><span class="ellipsis">example.com/a</span></a></p>',
    '<p>5 &lt; 6 &gt; 4 "quoted" &nbsp;café \u{1F98C}</p>',
    '<p><em>em</em> <strong>strong</strong> <code>code</code></p><pre><code>a\n  b</code></pre><ul><li>one</li></ul><ol><li>two</li></ol>',
    '<p lang="de">Hallo</p>',
    '<p>dirty<img src=x onerror=bad()><a href="javascript:bad()" onclick="bad()">x</a></p><script>bad()</script>',
    '<p>unclosed <em>markup',
  ])('server-sanitized content passes the client sanitizer unchanged: %s', async (raw) => {
    const fromServer = sanitize(raw)
    const el = await mount(fixture({ content: fromServer }))
    expect(contentHtml(el)).toBe(fromServer)
  })
})

describe('<caribou-status-card> avatar retry', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    vi.useFakeTimers()
  })
  afterEach(() => { vi.useRealTimers() })

  const AVATAR = 'https://example.social/avatars/alice.png'
  const withAvatar = () => fixture({
    account: { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: AVATAR, avatarStatic: AVATAR },
  })

  it('retries a failed avatar twice with a growing backoff, then dims it', async () => {
    const el = await mount(withAvatar())
    const img = el.shadowRoot!.querySelector('img')!
    expect(img.getAttribute('src')).toBe(AVATAR)

    img.dispatchEvent(new Event('error'))
    expect(img.hasAttribute('src')).toBe(false)
    vi.advanceTimersByTime(299)
    expect(img.hasAttribute('src')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(img.getAttribute('src')).toBe(AVATAR)

    img.dispatchEvent(new Event('error'))
    vi.advanceTimersByTime(599)
    expect(img.hasAttribute('src')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(img.getAttribute('src')).toBe(AVATAR)
    expect(img.style.opacity).toBe('')

    img.dispatchEvent(new Event('error'))
    expect(img.getAttribute('src')).toBe(AVATAR)
    expect(img.style.opacity).toBe('0.4')
  })

  it('keeps the same <img> node through a retry', async () => {
    const el = await mount(withAvatar())
    const img = el.shadowRoot!.querySelector('img')!
    img.dispatchEvent(new Event('error'))
    vi.advanceTimersByTime(300)
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('img')).toBe(img)
  })
})

describe('statusPermalink', () => {
  it('builds /@acct/id and encodes the id', () => {
    expect(statusPermalink({ id: '42', account: { acct: 'alice@example.social' } }))
      .toBe('/@alice@example.social/42')
    expect(statusPermalink({ id: 'a:b/c', account: { acct: 'alice' } })).toBe('/@alice/a%3Ab%2Fc')
  })
})
