import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import {
  fetchAccountByHandle, fetchAccountStatuses,
} from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchAccountByHandle: vi.fn(),
  fetchAccountStatuses: vi.fn(),
}))
vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3')
  return {
    ...actual,
    getRequestURL: () => new URL('http://localhost:3000/'),
    getRouterParams: (event: { context?: { params?: Record<string, string> } }) =>
      event.context?.params ?? {},
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

describe('/@[handle] pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok with account + statuses + tab=posts when no tab param', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchAccountByHandle).mockResolvedValue(
      { id: '42', acct: 'alice@example.social' } as Awaited<ReturnType<typeof fetchAccountByHandle>>,
    )
    vi.mocked(fetchAccountStatuses).mockResolvedValue(
      [{ id: '99' }] as Awaited<ReturnType<typeof fetchAccountStatuses>>,
    )
    const event = {
      context: { params: { handle: 'alice@example.social' } },
      url: '/@alice@example.social',
    } as unknown as Parameters<typeof import('../@[handle].js').pageData.fetcher>[0]
    const { pageData } = await import('../@[handle].js')
    const result = await pageData.fetcher(event)
    expect(result).toMatchObject({
      kind: 'ok',
      account: { id: '42' },
      tab: 'posts',
      nextMaxId: '99',
    })
  })

  it('passes tab=media to fetchAccountStatuses when tab=media', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchAccountByHandle).mockResolvedValue(
      { id: '42' } as Awaited<ReturnType<typeof fetchAccountByHandle>>,
    )
    vi.mocked(fetchAccountStatuses).mockResolvedValue([])
    const event = {
      context: { params: { handle: 'alice@example.social' } },
      url: '/@alice@example.social?tab=media',
    } as unknown as Parameters<typeof import('../@[handle].js').pageData.fetcher>[0]
    const { pageData } = await import('../@[handle].js')
    await pageData.fetcher(event)
    expect(fetchAccountStatuses).toHaveBeenCalledWith(
      '42', expect.objectContaining({ tab: 'media' }),
    )
  })

  it('returns auth-required for bare handle when no instance cookie', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const event = {
      context: { params: { handle: 'alice' } },
      url: '/@alice',
    } as unknown as Parameters<typeof import('../@[handle].js').pageData.fetcher>[0]
    const { pageData } = await import('../@[handle].js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('auth-required')
  })
})
