import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  const actual = await vi.importActual<typeof import('h3')>('h3')
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

type FetchTimelineFn = typeof fetchPublicTimeline

describe('/local pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok with statuses + nextMaxId', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    const fixture = [
      { id: '11', content: 'hi' },
      { id: '10', content: 'older' },
    ] as Awaited<ReturnType<FetchTimelineFn>>
    vi.mocked(fetchPublicTimeline).mockResolvedValue(fixture)
    const event = { url: '/local' } as unknown as Parameters<typeof import('../local.js').pageData.fetcher>[0]
    const { pageData } = await import('../local.js')
    const result = await pageData.fetcher(event)
    expect(result).toEqual({
      kind: 'ok',
      statuses: fixture,
      nextMaxId: '10',
      shell: { instance: 'mastodon.social' },
    })
  })

  it('returns auth-required when no instance', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const event = { url: '/local' } as unknown as Parameters<typeof import('../local.js').pageData.fetcher>[0]
    const { pageData } = await import('../local.js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('auth-required')
  })

  it('returns error on upstream fetch failure', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchPublicTimeline).mockRejectedValue(new Error('upstream 503'))
    const event = { url: '/local' } as unknown as Parameters<typeof import('../local.js').pageData.fetcher>[0]
    const { pageData } = await import('../local.js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('error')
  })
})
