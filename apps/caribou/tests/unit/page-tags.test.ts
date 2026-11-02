import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as H3 from 'h3'
import type * as TagPageModule from '../../pages/tags/[tag].js'
import type { CaribouTimeline } from '../../components/caribou-timeline.js'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import { fetchTagTimeline } from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({
  resolveInstanceForRoute: vi.fn(),
}))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchTagTimeline: vi.fn(),
}))
vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRouterParams: (event: { params?: Record<string, string> }) => event.params ?? {},
    getQuery: (event: { url?: string }) => {
      const match = (event?.url ?? '').match(/\?(.+)$/)
      const q: Record<string, string> = {}
      if (match) for (const pair of match[1]!.split('&')) {
        const [k, v] = pair.split('=')
        if (k) q[k] = decodeURIComponent(v ?? '')
      }
      return q
    },
  }
})

type Fetched = Awaited<ReturnType<typeof fetchTagTimeline>>
type FetcherEvent = Parameters<typeof TagPageModule.pageData.fetcher>[0]
const eventFor = (tag: string, query = '') =>
  ({ url: `/tags/${tag}${query}`, params: { tag } }) as unknown as FetcherEvent

const signedIn = () => vi.mocked(resolveInstanceForRoute).mockResolvedValue({
  instance: 'example.social', source: 'cookie',
})

describe('/tags/[tag] pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the first page of the tag timeline, and the tag', async () => {
    signedIn()
    const fixture = [{ id: '11', content: 'hi' }, { id: '10', content: 'older' }] as Fetched
    vi.mocked(fetchTagTimeline).mockResolvedValue(fixture)
    const { pageData } = await import('../../pages/tags/[tag].js')
    const result = await pageData.fetcher(eventFor('Caturday'))
    expect(result).toMatchObject({
      kind: 'ok', statuses: fixture, nextMaxId: '10', tag: 'Caturday',
      shell: { instance: 'example.social', source: 'cookie' },
    })
    expect(fetchTagTimeline).toHaveBeenCalledWith(
      { instance: 'example.social', tag: 'Caturday', maxId: undefined },
    )
  })

  it('names the tag in the document title', async () => {
    signedIn()
    vi.mocked(fetchTagTimeline).mockResolvedValue([])
    const { pageData } = await import('../../pages/tags/[tag].js')
    const result = await pageData.fetcher(eventFor('Caturday'))
    expect(result.seoTitle).toBe('#Caturday · Caribou')
  })

  // Litro writes `seoTitle` into <title> as it is. Only a name that is not a
  // hashtag can hold markup, so that branch is the one to pin.
  it('escapes markup in the title of a name that is not a hashtag', async () => {
    signedIn()
    const { pageData } = await import('../../pages/tags/[tag].js')
    const result = await pageData.fetcher(eventFor(encodeURIComponent('</title><script>"x"&\'y\'')))
    expect(result.kind).toBe('not-found')
    expect(result.seoTitle).toBe('#&lt;/title&gt;&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39; · Caribou')
  })

  it('decodes a non-ASCII tag', async () => {
    signedIn()
    vi.mocked(fetchTagTimeline).mockResolvedValue([])
    const { pageData } = await import('../../pages/tags/[tag].js')
    const result = await pageData.fetcher(eventFor(encodeURIComponent('日本')))
    expect(result.tag).toBe('日本')
    expect(fetchTagTimeline).toHaveBeenCalledWith(expect.objectContaining({ tag: '日本' }))
  })

  it('passes ?max_id= through', async () => {
    signedIn()
    vi.mocked(fetchTagTimeline).mockResolvedValue([])
    const { pageData } = await import('../../pages/tags/[tag].js')
    const result = await pageData.fetcher(eventFor('ai', '?max_id=10'))
    expect(fetchTagTimeline).toHaveBeenCalledWith(expect.objectContaining({ maxId: '10' }))
    expect(result).toMatchObject({ kind: 'ok', statuses: [], nextMaxId: null })
  })

  it('sanitizes status content', async () => {
    signedIn()
    vi.mocked(fetchTagTimeline).mockResolvedValue([
      { id: '2', content: '<p onclick="bad()">ok</p><script>bad()</script>' },
    ] as Fetched)
    const { pageData } = await import('../../pages/tags/[tag].js')
    const result = await pageData.fetcher(eventFor('ai'))
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`)
    expect(result.statuses[0]!.content).toBe('<p>ok</p>')
  })

  it('answers not-found for a name that cannot be a hashtag, without a fetch', async () => {
    signedIn()
    const { pageData } = await import('../../pages/tags/[tag].js')
    const result = await pageData.fetcher(eventFor('a%20b'))
    expect(result.kind).toBe('not-found')
    expect(fetchTagTimeline).not.toHaveBeenCalled()
  })

  it('returns auth-required when no instance', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const { pageData } = await import('../../pages/tags/[tag].js')
    const result = await pageData.fetcher(eventFor('ai'))
    expect(result.kind).toBe('auth-required')
    expect(fetchTagTimeline).not.toHaveBeenCalled()
  })

  it('returns error on upstream failure', async () => {
    signedIn()
    vi.mocked(fetchTagTimeline).mockRejectedValue(new Error('upstream 503'))
    const { pageData } = await import('../../pages/tags/[tag].js')
    const result = await pageData.fetcher(eventFor('ai'))
    expect(result.kind).toBe('error')
  })
})

describe('<page-tags-tag> render', () => {
  beforeEach(() => { document.body.replaceChildren() })

  async function mount(serverData: TagPageModule.TagPageData | null) {
    await import('../../pages/tags/[tag].js')
    const el = document.createElement('page-tags-tag') as TagPageModule.TagPage
    el.serverData = serverData
    document.body.appendChild(el)
    while (!(await el.updateComplete)) { /* until no update is pending */ }
    return el
  }

  const shell = { instance: 'example.social' }

  it('shows the tag as the heading and hands the page to a hashtag timeline', async () => {
    const statuses = [{
      id: '5', content: '<p>five</p>', createdAt: '2026-05-08T12:00:00Z',
      account: { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' },
    }] as unknown as Fetched
    const el = await mount({ kind: 'ok', statuses, nextMaxId: '5', shell, tag: 'Caturday' })
    const header = el.shadowRoot!.querySelector('caribou-tag-header')!
    expect(header.getAttribute('name')).toBe('Caturday')
    const timeline = el.shadowRoot!.querySelector<CaribouTimeline>('caribou-timeline')!
    expect(timeline.getAttribute('kind')).toBe('hashtag')
    expect(timeline.getAttribute('tag')).toBe('Caturday')
    expect(timeline.initial).toMatchObject({ statuses, nextMaxId: '5' })
    await timeline.updateComplete
    expect(timeline.shadowRoot!.querySelectorAll('caribou-status-card')).toHaveLength(1)
  })

  it('sets the document title, and puts the app title back when it leaves', async () => {
    history.replaceState(null, '', '/tags/ai')
    const el = await mount({ kind: 'ok', statuses: [], nextMaxId: null, shell, tag: 'ai' })
    expect(document.title).toBe('#ai · Caribou')
    el.remove()
    expect(document.title).toBe('Caribou')
  })

  // `enterWithCache` can hand a page its fresh data after the reader has
  // left it. That late render must not take the title of the page now shown.
  it('a page the reader has left does not change the title', async () => {
    history.replaceState(null, '', '/tags/ai')
    const el = await mount({ kind: 'ok', statuses: [], nextMaxId: null, shell, tag: 'ai' })
    el.remove()
    history.replaceState(null, '', '/home')
    el.serverData = { kind: 'ok', statuses: [], nextMaxId: null, shell, tag: 'ai' }
    await el.updateComplete
    expect(document.title).toBe('Caribou')
  })

  it('a page that is not the one at the address does not change the title', async () => {
    history.replaceState(null, '', '/home')
    document.title = 'Caribou'
    await mount({ kind: 'ok', statuses: [], nextMaxId: null, shell, tag: 'ai' })
    expect(document.title).toBe('Caribou')
  })

  it('sets the title of a non-ASCII tag, and of a name that is not a hashtag', async () => {
    history.replaceState(null, '', `/tags/${encodeURIComponent('日本')}`)
    const el = await mount({ kind: 'ok', statuses: [], nextMaxId: null, shell, tag: '日本' })
    expect(document.title).toBe('#日本 · Caribou')
    el.remove()
    history.replaceState(null, '', '/tags/a-b')
    await mount({ kind: 'not-found', shell, tag: 'a-b' })
    expect(document.title).toBe('#a-b · Caribou')
  })

  it('says a name is not a hashtag', async () => {
    const el = await mount({ kind: 'not-found', shell, tag: 'a b' })
    expect(el.shadowRoot!.querySelector('article')!.textContent).toContain('#a b is not a hashtag.')
    expect(el.shadowRoot!.querySelector('caribou-timeline')).toBeNull()
  })

  it('renders an alert with a retry link on error', async () => {
    const el = await mount({ kind: 'error', message: 'x', shell, tag: 'café' })
    const alert = el.shadowRoot!.querySelector('article[role="alert"]')!
    expect(alert.textContent).toContain("Couldn't load #café.")
    expect(alert.querySelector('litro-link')!.getAttribute('href')).toBe(`/tags/${encodeURIComponent('café')}`)
  })

  it('renders the auth-required placeholder', async () => {
    const el = await mount({ kind: 'auth-required', shell: { instance: null }, tag: 'ai' })
    expect(el.shadowRoot!.querySelector('caribou-auth-required')!.getAttribute('label'))
      .toBe('#ai needs to know which instance to query. Sign in once and Caribou will remember.')
  })
})

describe('<page-tags-tag> signed in, with no instance on the server', () => {
  beforeEach(() => { document.body.replaceChildren() })

  it('first renders the placeholder the server sent, then the tag timeline', async () => {
    const { activeClient, activeUserKey, addUserSession, users } = await import('@beatzball/caribou-state')
    addUserSession({
      userKey: 'me@example.social', server: 'example.social', token: 'T', vapidKey: '',
      account: { id: '1', acct: 'me' }, createdAt: 1,
    } as never)
    const client = activeClient.value!
    const fetchTimeline = vi.spyOn(client, 'fetchTimeline').mockResolvedValue([])
    vi.spyOn(client, 'fetchTag').mockResolvedValue({ id: '1', name: 'ai', url: '', following: false })
    try {
      await import('../../pages/tags/[tag].js')
      const el = document.createElement('page-tags-tag') as TagPageModule.TagPage
      el.serverData = { kind: 'auth-required', shell: { instance: null }, tag: 'ai' }
      document.body.appendChild(el)
      await el.updateComplete
      expect(el.shadowRoot!.querySelector('caribou-auth-required')).not.toBeNull()
      while (!(await el.updateComplete)) { /* settle */ }
      expect(el.shadowRoot!.querySelector('caribou-auth-required')).toBeNull()
      const timeline = el.shadowRoot!.querySelector<CaribouTimeline>('caribou-timeline')!
      expect(timeline.getAttribute('tag')).toBe('ai')
      expect(timeline.initial).toBeNull()
      await timeline.updateComplete
      expect(fetchTimeline).toHaveBeenCalledWith({ type: 'hashtag', tag: 'ai' }, undefined)
    } finally {
      document.body.replaceChildren()
      activeUserKey.value = null
      users.value = new Map()
      localStorage.clear()
      vi.restoreAllMocks()
    }
  })
})
