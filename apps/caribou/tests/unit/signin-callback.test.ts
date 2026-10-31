import { describe, expect, it, vi } from 'vitest'
import { completeSignin, type CompleteSigninDeps, type CompleteSigninResult } from '../../server/lib/signin-callback.js'
import { hashNonce } from '../../server/lib/signin-binding.js'

// The nonce in the starting browser's `caribou.signin` cookie.
const N = 'NONCE-1'

// Where an error sends the browser (a success has no URL).
const where = (r: CompleteSigninResult): string | undefined => (r.kind === 'error' ? r.location : undefined)

function deps(overrides: Partial<CompleteSigninDeps> = {}): CompleteSigninDeps {
  const store = new Map<string, unknown>()
  store.set('state:S1', { server: 'fosstodon.org', origin: 'https://caribou.quest', createdAt: 1, nonceHash: hashNonce(N) })
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
  it('returns the session for the completion page, not a URL', async () => {
    const d = deps()
    const res = await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d)
    expect(res).toEqual({
      kind: 'ok',
      server: 'fosstodon.org',
      session: {
        token: 'ACCESS-TOKEN-1', server: 'fosstodon.org', userKey: 'beatzball@fosstodon.org', vapidKey: 'VAPIDKEY',
      },
    })
  })

  it('consumes the state token (one-time use)', async () => {
    const d = deps()
    await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d)
    const next = await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d)
    expect(next).toEqual({ kind: 'error', location: '/?error=state_mismatch' })
  })

  it('returns ?error=access_denied when Mastodon sends ?error=', async () => {
    const d = deps()
    const res = await completeSignin({ error: 'access_denied' }, d)
    expect(res).toEqual({ kind: 'error', location: '/?error=denied' })
  })

  it('returns ?error=exchange_failed when token exchange throws', async () => {
    const d = deps({ exchangeCode: vi.fn(async () => { throw new Error('boom') }) as CompleteSigninDeps['exchangeCode'] })
    const res = await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d)
    expect(where(res)).toBe('/?error=exchange_failed&instance=fosstodon.org')
  })

  it('returns ?error=verify_failed when verify_credentials throws', async () => {
    const d = deps({ verifyCredentials: vi.fn(async () => { throw new Error('nope') }) as CompleteSigninDeps['verifyCredentials'] })
    const res = await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d)
    expect(where(res)).toBe('/?error=verify_failed')
  })

  it('rejects unknown state', async () => {
    const d = deps()
    const res = await completeSignin({ code: 'C1', state: 'UNKNOWN', nonce: N }, d)
    expect(res).toEqual({ kind: 'error', location: '/?error=state_mismatch' })
  })

  it('rejects missing app credentials for the state’s (server, origin)', async () => {
    const d = deps()
    await d.storage.removeItem('apps:fosstodon.org:https://caribou.quest')
    const res = await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d)
    expect(where(res)).toBe('/?error=exchange_failed&instance=fosstodon.org')
  })

  describe('adding an account (state has add)', () => {
    function addDeps(overrides: Partial<CompleteSigninDeps> = {}) {
      const d = deps(overrides)
      void d.storage.setItem('state:ADD', {
        server: 'fosstodon.org', origin: 'https://caribou.quest', createdAt: 1, add: true, nonceHash: hashNonce(N),
      })
      return d
    }

    it('a denial goes back to the add form and uses up the state', async () => {
      const d = addDeps()
      const res = await completeSignin({ error: 'access_denied', state: 'ADD', nonce: N }, d)
      expect(res).toEqual({ kind: 'error', location: '/?add&error=denied' })
      expect(await d.storage.getItem('state:ADD')).toBeNull()
    })

    it('a denial with a plain state goes to the plain landing', async () => {
      const d = deps()
      const res = await completeSignin({ error: 'access_denied', state: 'S1', nonce: N }, d)
      expect(res).toEqual({ kind: 'error', location: '/?error=denied' })
      expect(await d.storage.getItem('state:S1')).toBeNull()
    })

    it('a failed exchange or verify goes back to the add form', async () => {
      const ex = addDeps({ exchangeCode: vi.fn(async () => { throw new Error('boom') }) as CompleteSigninDeps['exchangeCode'] })
      expect(where(await completeSignin({ code: 'C1', state: 'ADD', nonce: N }, ex)))
        .toBe('/?add&error=exchange_failed&instance=fosstodon.org')
      const ve = addDeps({ verifyCredentials: vi.fn(async () => { throw new Error('nope') }) as CompleteSigninDeps['verifyCredentials'] })
      expect(where(await completeSignin({ code: 'C1', state: 'ADD', nonce: N }, ve))).toBe('/?add&error=verify_failed')
    })

    it('a missing code goes back to the add form', async () => {
      const res = await completeSignin({ state: 'ADD', nonce: N }, addDeps())
      expect(res).toEqual({ kind: 'error', location: '/?add&error=state_mismatch' })
    })

    it('an expired add state goes back to the add form', async () => {
      const res = await completeSignin({ code: 'C1', state: 'ADD', nonce: N }, addDeps({ now: () => 1 + 11 * 60 * 1000 }))
      expect(res).toEqual({ kind: 'error', location: '/?add&error=state_mismatch' })
    })

    it('success is the same as a first sign-in', async () => {
      const res = await completeSignin({ code: 'C1', state: 'ADD', nonce: N }, addDeps())
      expect(res.kind === 'ok' && res.session)
        .toEqual({ token: 'ACCESS-TOKEN-1', server: 'fosstodon.org', userKey: 'beatzball@fosstodon.org', vapidKey: 'VAPIDKEY' })
    })
  })

  describe('the state is bound to the browser that started the sign-in', () => {
    it('a matching cookie signs in', async () => {
      const d = deps()
      expect((await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d)).kind).toBe('ok')
      expect(d.exchangeCode).toHaveBeenCalledTimes(1)
    })

    it('no cookie: no_cookie, no token exchange, the state is used up', async () => {
      const d = deps()
      expect(await completeSignin({ code: 'C1', state: 'S1' }, d))
        .toEqual({ kind: 'error', location: '/?error=no_cookie' })
      expect(d.exchangeCode).not.toHaveBeenCalled()
      expect(d.verifyCredentials).not.toHaveBeenCalled()
      expect(await d.storage.getItem('state:S1')).toBeNull()
    })

    it('no cookie on an add state: back to the add form with no_cookie', async () => {
      const d = deps()
      await d.storage.setItem('state:ADD', {
        server: 'fosstodon.org', origin: 'https://caribou.quest', createdAt: 1, add: true, nonceHash: hashNonce(N),
      })
      expect(await completeSignin({ code: 'C1', state: 'ADD' }, d))
        .toEqual({ kind: 'error', location: '/?add&error=no_cookie' })
      expect(d.exchangeCode).not.toHaveBeenCalled()
    })

    it('a denial without a cookie is still a denial', async () => {
      expect(await completeSignin({ error: 'access_denied', state: 'S1' }, deps()))
        .toEqual({ kind: 'error', location: '/?error=denied' })
    })

    it('another browser\'s cookie: state_mismatch, no token exchange', async () => {
      const d = deps()
      expect(await completeSignin({ code: 'C1', state: 'S1', nonce: 'NONCE-OF-SOMEONE-ELSE' }, d))
        .toEqual({ kind: 'error', location: '/?error=state_mismatch' })
      expect(d.exchangeCode).not.toHaveBeenCalled()
    })

    it('a mismatch on an add state goes back to the add form', async () => {
      const d = deps()
      await d.storage.setItem('state:ADD', {
        server: 'fosstodon.org', origin: 'https://caribou.quest', createdAt: 1, add: true, nonceHash: hashNonce(N),
      })
      expect(await completeSignin({ code: 'C1', state: 'ADD', nonce: 'WRONG' }, d))
        .toEqual({ kind: 'error', location: '/?add&error=state_mismatch' })
      expect(d.exchangeCode).not.toHaveBeenCalled()
    })

    it('a state stored without a nonce hash (before this check) is refused', async () => {
      const d = deps()
      await d.storage.setItem('state:OLD', { server: 'fosstodon.org', origin: 'https://caribou.quest', createdAt: 1 })
      expect(where(await completeSignin({ code: 'C1', state: 'OLD', nonce: N }, d))).toBe('/?error=state_mismatch')
      expect(d.exchangeCode).not.toHaveBeenCalled()
    })

    it('a replay with the right cookie fails: one exchange in all', async () => {
      const d = deps()
      expect((await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d)).kind).toBe('ok')
      expect(await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d))
        .toEqual({ kind: 'error', location: '/?error=state_mismatch' })
      expect(d.exchangeCode).toHaveBeenCalledTimes(1)
    })

    it('a mismatch uses up the state: the right browser cannot use it after', async () => {
      const d = deps()
      await completeSignin({ code: 'C1', state: 'S1', nonce: 'WRONG' }, d)
      expect(where(await completeSignin({ code: 'C1', state: 'S1', nonce: N }, d))).toBe('/?error=state_mismatch')
      expect(d.exchangeCode).not.toHaveBeenCalled()
    })
  })
})
