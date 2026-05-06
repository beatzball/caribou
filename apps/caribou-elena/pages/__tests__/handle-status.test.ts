import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import {
  fetchStatus, fetchThreadContext,
} from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchStatus: vi.fn(),
  fetchThreadContext: vi.fn(),
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
  }
})

describe('/@[handle]/[statusId] pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok with focused + ancestors + descendants when both succeed', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchStatus).mockResolvedValue(
      { id: '99', content: 'hi' } as Awaited<ReturnType<typeof fetchStatus>>,
    )
    vi.mocked(fetchThreadContext).mockResolvedValue({
      ancestors: [{ id: '90' }] as Awaited<ReturnType<typeof fetchThreadContext>>['ancestors'],
      descendants: [{ id: '100' }] as Awaited<ReturnType<typeof fetchThreadContext>>['descendants'],
    })
    const event = {
      context: { params: { handle: 'alice@example.social', statusId: '99' } },
    } as unknown as Parameters<typeof import('../@[handle]/[statusId].js').pageData.fetcher>[0]
    const { pageData } = await import('../@[handle]/[statusId].js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.focused.id).toBe('99')
    expect(result.ancestors).toHaveLength(1)
    expect(result.descendants).toHaveLength(1)
  })

  it('returns error when fetchStatus rejects', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'mastodon.social', source: 'cookie',
    })
    vi.mocked(fetchStatus).mockRejectedValue(new Error('404'))
    vi.mocked(fetchThreadContext).mockResolvedValue({ ancestors: [], descendants: [] })
    const event = {
      context: { params: { handle: 'alice@example.social', statusId: '99' } },
    } as unknown as Parameters<typeof import('../@[handle]/[statusId].js').pageData.fetcher>[0]
    const { pageData } = await import('../@[handle]/[statusId].js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('error')
  })
})
