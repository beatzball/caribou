// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type * as H3 from 'h3'
import type * as HandlePage from '../@[handle].js'
import type * as StatusPage from '../@[handle]/[statusId].js'

// README, "Bluesky SSR": with the kill switch `BLUESKY_SSR=0` a Bluesky
// route renders as it did before phase 3, and the SDK module never loads. A
// file of its own: the mocked `bluesky-public.js` records its load in its
// factory, which runs once per module graph, so no earlier test may have
// loaded the pages.

const blueskyPublicLoaded = vi.hoisted(() => vi.fn())
vi.mock('../../server/lib/bluesky-public.js', () => { blueskyPublicLoaded(); return {} })
vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/mastodon-public.js', () => ({
  fetchAccountByHandle: vi.fn(), fetchAccountStatuses: vi.fn(), fetchStatus: vi.fn(), fetchThreadContext: vi.fn(),
}))
vi.mock('../../server/lib/instance-cookie.js', () => ({ getInstance: vi.fn(async () => null) }))
vi.mock('../../server/lib/storage.js', () => ({ getStorage: () => ({ getItem: async () => null }) }))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRouterParams: (event: { context?: { params?: Record<string, string> } }) => event.context?.params ?? {},
    getQuery: () => ({}),
    setResponseStatus: () => {},
  }
})

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  process.env.BLUESKY_SSR = '0'
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})
afterEach(() => {
  delete process.env.BLUESKY_SSR
  fetchSpy.mockRestore()
})

describe('/@[handle] with BLUESKY_SSR=0', () => {
  it('a dotted route takes the Mastodon path as before, and the SDK module never loads', async () => {
    const ri = await import('../../server/lib/resolve-instance.js')
    const mp = await import('../../server/lib/mastodon-public.js')
    vi.mocked(ri.resolveInstanceForRoute).mockResolvedValue({ instance: 'mastodon.social', source: 'cookie' })
    vi.mocked(mp.fetchAccountByHandle).mockRejectedValue(new Error('upstream 404'))
    const event = { context: { params: { handle: 'alice.example.com' } } } as unknown as Parameters<typeof HandlePage.pageData.fetcher>[0]
    const { pageData } = await import('../@[handle].js')
    const result = await pageData.fetcher(event)
    // No request of any kind: with the switch off, nothing asks the AppView.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'error', handle: 'alice.example.com' })
    expect(vi.mocked(mp.fetchAccountByHandle)).toHaveBeenCalledWith('alice.example.com', { instance: 'mastodon.social' })
    // The switch is read before the import.
    expect(blueskyPublicLoaded).not.toHaveBeenCalled()
  })
})

describe('/@[handle]/[statusId] with BLUESKY_SSR=0', () => {
  it('a Bluesky post route takes the Mastodon path as before, and the SDK module never loads', async () => {
    const event = { context: { params: { handle: 'alice.example.com', statusId: '3k1' } } } as unknown as Parameters<typeof StatusPage.pageData.fetcher>[0]
    const { pageData } = await import('../@[handle]/[statusId].js')
    const result = await pageData.fetcher(event)
    expect(fetchSpy).not.toHaveBeenCalled()
    // No instance cookie: the Mastodon path asks the reader to sign in.
    expect(result).toMatchObject({ kind: 'auth-required', handle: 'alice.example.com', statusId: '3k1' })
    expect(blueskyPublicLoaded).not.toHaveBeenCalled()
  })
})
