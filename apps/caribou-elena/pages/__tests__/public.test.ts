import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as H3 from 'h3'
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
})
