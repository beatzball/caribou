import { describe, expect, it, vi } from 'vitest'
import { completeSignin, type CompleteSigninDeps } from '../../server/lib/signin-callback.js'

function deps(overrides: Partial<CompleteSigninDeps> = {}): CompleteSigninDeps {
  const store = new Map<string, unknown>()
  store.set('state:S1', { server: 'fosstodon.org', origin: 'https://caribou.quest', createdAt: 1 })
  store.set('apps:fosstodon.org:https://caribou.quest', {
    client_id: 'CID', client_secret: 'SECRET', vapid_key: 'VAPIDKEY', registered_at: 1,
  })
  return {
    storage: {
      getItem: async <T = unknown>(k: string) => (store.get(k) ?? null) as T | null,
      setItem: async (k, v) => { store.set(k, v) },
      removeItem: async (k) => { store.delete(k) },
    },
    exchangeCode: vi.fn(async () => 'ACCESS-TOKEN-1') as CompleteSigninDeps['exchangeCode'],
    verifyCredentials: vi.fn(async () => ({
      id: 'a1', username: 'beatzball', acct: 'beatzball',
    }) as unknown) as CompleteSigninDeps['verifyCredentials'],
    now: () => 2,
    ...overrides,
  } as CompleteSigninDeps
}

describe('completeSignin', () => {
  it('returns a /signin/done redirect with token/server/userKey/vapidKey in the fragment', async () => {
    const d = deps()
    const res = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(res).toEqual({
      kind: 'ok',
      location:
        '/signin/done#token=ACCESS-TOKEN-1' +
        '&server=fosstodon.org' +
        '&userKey=beatzball%40fosstodon.org' +
        '&vapidKey=VAPIDKEY',
    })
  })

  it('consumes the state token (one-time use)', async () => {
    const d = deps()
    await completeSignin({ code: 'C1', state: 'S1' }, d)
    const next = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(next).toEqual({ kind: 'error', location: '/?error=state_mismatch' })
  })

  it('returns ?error=access_denied when Mastodon sends ?error=', async () => {
    const d = deps()
    const res = await completeSignin({ error: 'access_denied' }, d)
    expect(res).toEqual({ kind: 'error', location: '/?error=denied' })
  })

  it('returns ?error=exchange_failed when token exchange throws', async () => {
    const d = deps({ exchangeCode: vi.fn(async () => { throw new Error('boom') }) as CompleteSigninDeps['exchangeCode'] })
    const res = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(res.location).toBe('/?error=exchange_failed&instance=fosstodon.org')
  })

  it('returns ?error=verify_failed when verify_credentials throws', async () => {
    const d = deps({ verifyCredentials: vi.fn(async () => { throw new Error('nope') }) as CompleteSigninDeps['verifyCredentials'] })
    const res = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(res.location).toBe('/?error=verify_failed')
  })

  it('rejects unknown state', async () => {
    const d = deps()
    const res = await completeSignin({ code: 'C1', state: 'UNKNOWN' }, d)
    expect(res).toEqual({ kind: 'error', location: '/?error=state_mismatch' })
  })

  it('rejects missing app credentials for the state’s (server, origin)', async () => {
    const d = deps()
    await d.storage.removeItem('apps:fosstodon.org:https://caribou.quest')
    const res = await completeSignin({ code: 'C1', state: 'S1' }, d)
    expect(res.location).toBe('/?error=exchange_failed&instance=fosstodon.org')
  })
})
