import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as H3 from 'h3'
import type * as StatusPage from '../@[handle]/[statusId].js'
import { getInstance } from '../../server/lib/instance-cookie.js'
import {
  fetchStatus, fetchThreadContext,
} from '../../server/lib/mastodon-public.js'

vi.mock('../../server/lib/instance-cookie.js', () => ({ getInstance: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchStatus: vi.fn(),
  fetchThreadContext: vi.fn(),
}))
vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRequestURL: () => new URL('http://localhost:3000/'),
    getRouterParams: (event: { context?: { params?: Record<string, string> } }) =>
      event.context?.params ?? {},
  }
})

describe('/@[handle]/[statusId] pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries the cookie host (home), not the path host', async () => {
    // Cross-software federation hazard: status ids are minted per-instance.
    // The id encoded in the URL came from a card the user saw in their home
    // timeline, so we always fetch from the cookie host even if the handle
    // is qualified with a foreign host (Flipboard, Misskey, etc.).
    vi.mocked(getInstance).mockResolvedValue('home.example')
    vi.mocked(fetchStatus).mockResolvedValue(
      { id: '99', content: 'hi' } as Awaited<ReturnType<typeof fetchStatus>>,
    )
    vi.mocked(fetchThreadContext).mockResolvedValue({
      ancestors: [{ id: '90' }] as Awaited<ReturnType<typeof fetchThreadContext>>['ancestors'],
      descendants: [{ id: '100' }] as Awaited<ReturnType<typeof fetchThreadContext>>['descendants'],
    })
    const event = {
      context: { params: { handle: 'smithsonianmag@flipboard.com', statusId: '99' } },
    } as unknown as Parameters<typeof StatusPage.pageData.fetcher>[0]
    const { pageData } = await import('../@[handle]/[statusId].js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(vi.mocked(fetchStatus)).toHaveBeenCalledWith('99', { instance: 'home.example' })
    expect(vi.mocked(fetchThreadContext)).toHaveBeenCalledWith('99', { instance: 'home.example' })
    expect(result.ancestors).toHaveLength(1)
    expect(result.descendants).toHaveLength(1)
  })

  it('returns auth-required when no cookie host is set', async () => {
    vi.mocked(getInstance).mockResolvedValue(undefined)
    const event = {
      context: { params: { handle: 'alice@example.social', statusId: '99' } },
    } as unknown as Parameters<typeof StatusPage.pageData.fetcher>[0]
    const { pageData } = await import('../@[handle]/[statusId].js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('auth-required')
    expect(vi.mocked(fetchStatus)).not.toHaveBeenCalled()
  })

  it('decodes URL-encoded statusId from the path', async () => {
    // Some non-Mastodon bridges produce ids with `/` or `:`. The card encodes
    // them via encodeURIComponent; the page must decode before fetching.
    vi.mocked(getInstance).mockResolvedValue('home.example')
    vi.mocked(fetchStatus).mockResolvedValue(
      { id: 'weird:id/here', content: 'hi' } as Awaited<ReturnType<typeof fetchStatus>>,
    )
    vi.mocked(fetchThreadContext).mockResolvedValue({ ancestors: [], descendants: [] })
    const event = {
      context: { params: { handle: 'a', statusId: 'weird%3Aid%2Fhere' } },
    } as unknown as Parameters<typeof StatusPage.pageData.fetcher>[0]
    const { pageData } = await import('../@[handle]/[statusId].js')
    await pageData.fetcher(event)
    expect(vi.mocked(fetchStatus))
      .toHaveBeenCalledWith('weird:id/here', { instance: 'home.example' })
  })

  it('returns error when fetchStatus rejects', async () => {
    vi.mocked(getInstance).mockResolvedValue('home.example')
    vi.mocked(fetchStatus).mockRejectedValue(new Error('404'))
    vi.mocked(fetchThreadContext).mockResolvedValue({ ancestors: [], descendants: [] })
    const event = {
      context: { params: { handle: 'alice@example.social', statusId: '99' } },
    } as unknown as Parameters<typeof StatusPage.pageData.fetcher>[0]
    const { pageData } = await import('../@[handle]/[statusId].js')
    const result = await pageData.fetcher(event)
    expect(result.kind).toBe('error')
  })
})
