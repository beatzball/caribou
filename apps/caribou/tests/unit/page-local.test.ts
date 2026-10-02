import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as H3 from 'h3'
import type * as LocalPageModule from '../../pages/local.js'
import type { CaribouTimeline } from '../../components/caribou-timeline.js'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import { fetchPublicTimeline } from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({
  resolveInstanceForRoute: vi.fn(),
}))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchPublicTimeline: vi.fn(),
}))
vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRequestURL: () => new URL('http://localhost:3000/local'),
    getQuery: (event: { url?: string }) => {
      const url = event?.url ?? ''
      const q: Record<string, string> = {}
      const match = url.match(/\?(.+)$/)
      if (match) for (const pair of match[1]!.split('&')) {
        const [k, v] = pair.split('=')
        if (k) q[k] = decodeURIComponent(v ?? '')
      }
      return q
    },
  }
})

type Fetched = Awaited<ReturnType<typeof fetchPublicTimeline>>
type FetcherEvent = Parameters<typeof LocalPageModule.pageData.fetcher>[0]
const eventFor = (url: string) => ({ url }) as unknown as FetcherEvent

describe('/local pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok with statuses + nextMaxId', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'example.social', source: 'cookie',
    })
    const fixture = [
      { id: '11', content: 'hi' },
      { id: '10', content: 'older' },
    ] as Fetched
    vi.mocked(fetchPublicTimeline).mockResolvedValue(fixture)
    const { pageData } = await import('../../pages/local.js')
    const result = await pageData.fetcher(eventFor('/local'))
    expect(result).toEqual({
      kind: 'ok',
      statuses: fixture,
      nextMaxId: '10',
      shell: { instance: 'example.social' },
    })
    expect(fetchPublicTimeline).toHaveBeenCalledWith(
      { kind: 'local', instance: 'example.social', maxId: undefined },
    )
  })

  it('passes ?max_id= through to the upstream fetch', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'example.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockResolvedValue([])
    const { pageData } = await import('../../pages/local.js')
    const result = await pageData.fetcher(eventFor('/local?max_id=10'))
    expect(fetchPublicTimeline).toHaveBeenCalledWith(expect.objectContaining({ maxId: '10' }))
    expect(result).toMatchObject({ kind: 'ok', statuses: [], nextMaxId: null })
  })

  it('sanitizes status content, and the inner status of a boost', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'example.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockResolvedValue([
      { id: '2', content: '<p onclick="bad()">ok</p><script>bad()</script>' },
      { id: '1', content: '', reblog: { id: '0', content: '<p data-x="1">inner</p>' } },
    ] as Fetched)
    const { pageData } = await import('../../pages/local.js')
    const result = await pageData.fetcher(eventFor('/local'))
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`)
    expect(result.statuses[0]!.content).toBe('<p>ok</p>')
    expect(result.statuses[1]!.reblog!.content).toBe('<p>inner</p>')
  })

  it('returns auth-required when no instance', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const { pageData } = await import('../../pages/local.js')
    const result = await pageData.fetcher(eventFor('/local'))
    expect(result.kind).toBe('auth-required')
    expect(fetchPublicTimeline).not.toHaveBeenCalled()
  })

  it('returns error on upstream fetch failure', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'example.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockRejectedValue(new Error('upstream 503'))
    const { pageData } = await import('../../pages/local.js')
    const result = await pageData.fetcher(eventFor('/local'))
    expect(result.kind).toBe('error')
    expect(result.shell.instance).toBe('example.social')
  })
})

describe('<page-local> render', () => {
  beforeEach(() => { document.body.replaceChildren() })

  async function mount(serverData: LocalPageModule.LocalPageData | null) {
    await import('../../pages/local.js')
    const el = document.createElement('page-local') as LocalPageModule.LocalPage
    el.serverData = serverData
    document.body.appendChild(el)
    while (!(await el.updateComplete)) { /* until no update is pending */ }
    return el
  }

  it('renders the auth-required placeholder inside the shell', async () => {
    const el = await mount({ kind: 'auth-required', shell: { instance: null } })
    const shell = el.shadowRoot!.querySelector('caribou-app-shell')!
    expect(shell.getAttribute('instance')).toBe('')
    expect(shell.querySelector('caribou-auth-required')!.getAttribute('label'))
      .toBe('/local needs to know which instance to query. Sign in once and Caribou will remember.')
    expect(shell.querySelector('caribou-timeline')).toBeNull()
  })

  it('falls back to the placeholder when there is no page data', async () => {
    const el = await mount(null)
    expect(el.shadowRoot!.querySelector('caribou-auth-required')).not.toBeNull()
  })

  it('renders an alert with a retry link on error', async () => {
    const el = await mount({ kind: 'error', message: 'upstream 503', shell: { instance: 'example.social' } })
    const alert = el.shadowRoot!.querySelector('article[role="alert"]')!
    expect(alert.textContent).toContain("Couldn't load /local.")
    expect(alert.querySelector('litro-link')!.getAttribute('href')).toBe('/local')
    expect(alert.querySelector('litro-link')!.textContent).toBe('Retry')
    expect(el.shadowRoot!.querySelector('caribou-app-shell')!.getAttribute('instance')).toBe('example.social')
  })

  it('hands the server data to a local timeline through .initial', async () => {
    const statuses = [{
      id: '5', content: '<p>five</p>', createdAt: '2026-05-08T12:00:00Z',
      account: { id: '1', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' },
    }] as unknown as Fetched
    const el = await mount({ kind: 'ok', statuses, nextMaxId: '5', shell: { instance: 'example.social' } })
    const timeline = el.shadowRoot!.querySelector<CaribouTimeline>('caribou-timeline')!
    expect(timeline.getAttribute('kind')).toBe('local')
    expect(timeline.hasAttribute('initial')).toBe(false)
    expect(timeline.initial).toMatchObject({ statuses, nextMaxId: '5' })
    await timeline.updateComplete
    expect(timeline.shadowRoot!.querySelectorAll('caribou-status-card')).toHaveLength(1)
  })
})
