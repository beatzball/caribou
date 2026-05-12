import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as H3 from 'h3'
import type * as PublicPage from '../public.js'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import { fetchPublicTimeline } from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({ fetchPublicTimeline: vi.fn() }))
vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))
vi.mock('../../server/lib/server-now.js', () => ({
  getServerNowMs: () => 1_000_000,
}))
vi.mock('../../server/lib/render-populated-list.js', () => ({
  renderPopulatedListMount: async () => '<caribou-list-mount></caribou-list-mount>',
}))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRequestURL: () => new URL('http://localhost:3000/public'),
    getQuery: () => ({}),
  }
})

type FetchTimelineFn = typeof fetchPublicTimeline

describe('/public pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes kind: "public" to fetchPublicTimeline', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockResolvedValue([])
    const { pageData } = await import('../public.js')
    const event = {} as Parameters<typeof pageData.fetcher>[0]
    await pageData.fetcher(event)
    expect(fetchPublicTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'public', instance: 'mastodon.social' }),
    )
  })

  it('returns ok with statuses + nextMaxId + serverNowMs + populatedListHtml', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    const fixture = [
      { id: '11', content: 'hi' },
      { id: '10', content: 'older' },
    ] as Awaited<ReturnType<FetchTimelineFn>>
    vi.mocked(fetchPublicTimeline).mockResolvedValue(fixture)
    const event = {} as Parameters<typeof PublicPage.pageData.fetcher>[0]
    const { pageData } = await import('../public.js')
    const result = await pageData.fetcher(event)
    expect(result).toEqual({
      kind: 'ok',
      statuses: fixture,
      nextMaxId: '10',
      shell: { instance: 'mastodon.social' },
      serverNowMs: 1_000_000,
      populatedListHtml: '<caribou-list-mount></caribou-list-mount>',
    })
  })

  it('returns auth-required when no instance', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const event = {} as Parameters<typeof PublicPage.pageData.fetcher>[0]
    const { pageData } = await import('../public.js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('auth-required')
  })

  it('returns error on upstream fetch failure', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockRejectedValue(new Error('upstream 503'))
    const event = {} as Parameters<typeof PublicPage.pageData.fetcher>[0]
    const { pageData } = await import('../public.js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('error')
  })
})
