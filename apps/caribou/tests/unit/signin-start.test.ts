import { describe, expect, it, vi } from 'vitest'
import { startSignin, type StartSigninDeps } from '../../server/lib/signin-start.js'

function mem(): Pick<StartSigninDeps, 'storage'> {
  const store = new Map<string, unknown>()
  return {
    storage: {
      getItem: async <T = unknown>(k: string) => (store.get(k) ?? null) as T | null,
      setItem: async (k, v) => { store.set(k, v) },
      removeItem: async (k) => { store.delete(k) },
    },
  }
}

function deps(overrides: Partial<StartSigninDeps> = {}): StartSigninDeps {
  return {
    ...mem(),
    registerApp: vi.fn(async () => ({
      client_id: 'CID', client_secret: 'SECRET', vapid_key: 'VK',
    })),
    generateState: () => 'STATE-TOKEN',
    now: () => 1_700_000_000_000,
    ...overrides,
  } as StartSigninDeps
}

describe('startSignin', () => {
  it('registers a new app and returns an authorize URL', async () => {
    const d = deps()
    const res = await startSignin({ server: 'fosstodon.org', origin: 'https://caribou.quest' }, d)
    expect(res.authorizeUrl).toMatch(/^https:\/\/fosstodon\.org\/oauth\/authorize\?/)
    expect(res.authorizeUrl).toContain('client_id=CID')
    expect(res.authorizeUrl).toContain('state=STATE-TOKEN')
    expect(d.registerApp).toHaveBeenCalledWith({
      server: 'fosstodon.org',
      redirectUri: 'https://caribou.quest/api/signin/callback',
    })
  })

  it('reuses a cached app entry within TTL', async () => {
    const d = deps()
    const first = await startSignin({ server: 's', origin: 'https://c' }, d)
    const second = await startSignin({ server: 's', origin: 'https://c' }, d)
    expect(d.registerApp).toHaveBeenCalledTimes(1)
    expect(second.authorizeUrl).toContain('client_id=CID')
    expect(second.authorizeUrl).toBe(first.authorizeUrl)
  })

  it('re-registers when cached entry is past TTL', async () => {
    const d = deps({
      now: (() => { let t = 0; return () => (t += 8 * 24 * 60 * 60 * 1000) })(),
    })
    await startSignin({ server: 's', origin: 'https://c' }, d)
    await startSignin({ server: 's', origin: 'https://c' }, d)
    expect(d.registerApp).toHaveBeenCalledTimes(2)
  })

  it('strips scheme/whitespace from user-provided server', async () => {
    const d = deps()
    const res = await startSignin({ server: '  https://fosstodon.org ', origin: 'https://c' }, d)
    expect(res.authorizeUrl.startsWith('https://fosstodon.org/oauth/authorize?')).toBe(true)
  })

  it('rejects empty server input', async () => {
    const d = deps()
    await expect(startSignin({ server: '', origin: 'https://c' }, d)).rejects.toThrow(/server/i)
  })
})
