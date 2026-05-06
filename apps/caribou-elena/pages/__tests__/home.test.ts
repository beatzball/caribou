import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({
  resolveInstanceForRoute: vi.fn(),
}))

vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3')
  return { ...actual, getRequestURL: () => new URL('http://localhost:3000/home') }
})

describe('/home pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth-required with shell instance from cookie', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'fosstodon.org',
      source: 'cookie',
    })
    const { pageData } = await import('../home.js')
    const result = await pageData.fetcher({} as Parameters<typeof pageData.fetcher>[0])
    expect(result).toEqual({
      kind: 'auth-required',
      shell: { instance: 'fosstodon.org' },
    })
  })

  it('returns auth-required with null instance when cookie absent', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const { pageData } = await import('../home.js')
    const result = await pageData.fetcher({} as Parameters<typeof pageData.fetcher>[0])
    expect(result.kind).toBe('auth-required')
    expect(result.shell.instance).toBeNull()
  })
})
