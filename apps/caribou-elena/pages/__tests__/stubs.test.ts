import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as H3 from 'h3'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    getRequestURL: () => new URL('http://localhost:3000/'),
  }
})

describe('/privacy and /about stubs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('/privacy returns shell only', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'fosstodon.org', source: 'cookie',
    })
    const { pageData } = await import('../privacy.js')
    const event = {} as Parameters<typeof pageData.fetcher>[0]
    const result = await pageData.fetcher(event)
    expect(result).toEqual({ shell: { instance: 'fosstodon.org' } })
  })

  it('/about returns shell only', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const { pageData } = await import('../about.js')
    const event = {} as Parameters<typeof pageData.fetcher>[0]
    const result = await pageData.fetcher(event)
    expect(result).toEqual({ shell: { instance: null } })
  })
})
