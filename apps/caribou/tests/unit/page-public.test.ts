import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as H3 from 'h3'
import type * as PublicPageModule from '../../pages/public.js'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import { fetchPublicTimeline } from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({ fetchPublicTimeline: vi.fn() }))
vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRequestURL: () => new URL('http://localhost:3000/public'),
    getQuery: () => ({}),
  }
})

type Fetched = Awaited<ReturnType<typeof fetchPublicTimeline>>

describe('/public pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes kind: "public" to fetchPublicTimeline', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'example.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockResolvedValue([])
    const { pageData } = await import('../../pages/public.js')
    const event = {} as Parameters<typeof pageData.fetcher>[0]
    await pageData.fetcher(event)
    expect(fetchPublicTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'public', instance: 'example.social' }),
    )
  })

  it('returns sanitized statuses with the last id as nextMaxId', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'example.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockResolvedValue([
      { id: '9', content: '<p data-x="1">nine</p>' },
      { id: '8', content: '<p>eight</p>' },
    ] as Fetched)
    const { pageData } = await import('../../pages/public.js')
    const result = await pageData.fetcher({} as Parameters<typeof pageData.fetcher>[0])
    expect(result).toMatchObject({
      kind: 'ok', nextMaxId: '8', shell: { instance: 'example.social' },
      statuses: [{ id: '9', content: '<p>nine</p>' }, { id: '8', content: '<p>eight</p>' }],
    })
  })

  it('returns auth-required when no instance, and error when upstream fails', async () => {
    const { pageData } = await import('../../pages/public.js')
    const event = {} as Parameters<typeof pageData.fetcher>[0]
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    expect((await pageData.fetcher(event)).kind).toBe('auth-required')
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: 'example.social', source: 'cookie' })
    vi.mocked(fetchPublicTimeline).mockRejectedValue(new Error('upstream 503'))
    expect((await pageData.fetcher(event)).kind).toBe('error')
  })
})

describe('<page-public> render', () => {
  beforeEach(() => { document.body.replaceChildren() })

  async function mount(serverData: PublicPageModule.PublicPageData) {
    await import('../../pages/public.js')
    const el = document.createElement('page-public') as PublicPageModule.PublicPage
    el.serverData = serverData
    document.body.appendChild(el)
    while (!(await el.updateComplete)) { /* until no update is pending */ }
    return el
  }

  it('renders the auth-required placeholder with the /public copy', async () => {
    const el = await mount({ kind: 'auth-required', shell: { instance: null } })
    expect(el.shadowRoot!.querySelector('caribou-auth-required')!.getAttribute('label'))
      .toBe('/public needs to know which instance to query. Sign in once and Caribou will remember.')
  })

  it('renders an alert with a retry link on error', async () => {
    const el = await mount({ kind: 'error', message: 'upstream 503', shell: { instance: 'example.social' } })
    const alert = el.shadowRoot!.querySelector('article[role="alert"]')!
    expect(alert.textContent).toContain("Couldn't load /public.")
    expect(alert.querySelector('litro-link')!.getAttribute('href')).toBe('/public')
  })

  it('renders a public timeline seeded with the server data', async () => {
    const el = await mount({ kind: 'ok', statuses: [], nextMaxId: null, shell: { instance: 'example.social' } })
    const timeline = el.shadowRoot!.querySelector('caribou-timeline')!
    expect(timeline.getAttribute('kind')).toBe('public')
    expect(timeline.initial).toMatchObject({ statuses: [], nextMaxId: null })
  })
})
