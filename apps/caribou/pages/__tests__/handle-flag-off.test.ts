// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type * as H3 from 'h3'
import type * as HandlePage from '../@[handle].js'

// README, "Bluesky SSR": without `BLUESKY_SSR` a Bluesky route renders as it
// did before phase 3, and the SDK module never loads. A file of its own: the
// mocked `bluesky-public.js` records its load in its factory, which runs once
// per module graph, so no earlier test may have loaded the page.

const blueskyPublicLoaded = vi.hoisted(() => vi.fn())
vi.mock('../../server/lib/bluesky-public.js', () => { blueskyPublicLoaded(); return {} })
vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({ fetchAccountByHandle: vi.fn(), fetchAccountStatuses: vi.fn() }))
vi.mock('../../server/lib/storage.js', () => ({ getStorage: () => ({ getItem: async () => null }) }))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRouterParams: (event: { context?: { params?: Record<string, string> } }) => event.context?.params ?? {},
    getQuery: () => ({}),
  }
})

describe('/@[handle] with BLUESKY_SSR unset', () => {
  it('a dotted route takes the Mastodon path as before, and the SDK module never loads', async () => {
    delete process.env.BLUESKY_SSR
    vi.resetModules()
    const ri = await import('../../server/lib/resolve-instance.js')
    const mp = await import('../../server/lib/mastodon-public.js')
    vi.mocked(ri.resolveInstanceForRoute).mockResolvedValue({ instance: 'mastodon.social', source: 'cookie' })
    vi.mocked(mp.fetchAccountByHandle).mockRejectedValue(new Error('upstream 404'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const event = { context: { params: { handle: 'alice.example.com' } } } as unknown as Parameters<typeof HandlePage.pageData.fetcher>[0]
    const { pageData } = await import('../@[handle].js')
    const result = await pageData.fetcher(event)
    // No request of any kind: with the flag off, nothing asks the AppView.
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    expect(result).toMatchObject({ kind: 'error', handle: 'alice.example.com' })
    expect(vi.mocked(mp.fetchAccountByHandle)).toHaveBeenCalledWith('alice.example.com', { instance: 'mastodon.social' })
    // The flag is read before the import.
    expect(blueskyPublicLoaded).not.toHaveBeenCalled()
  })
})
