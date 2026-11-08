import { describe, expect, it, vi } from 'vitest'
import { OAuthClient, TokenRefreshError, TokenRevokedError, type OAuthSession } from '@atproto/oauth-client-browser'
import {
  beginSignIn, completeSignIn, parseSignInInput, restoreClient, signOut, resolveHandle, notifySessionDeleted, sdkFetch, NoCallbackParams, SignInCancelled, ForeignCallback,
  InvalidSignInInput, SessionGone, SignInMismatch, StorageUnavailable, BLUESKY_SCOPE,
} from '../oauth.js'
import { fixture } from './_helpers.js'

const ALICE = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const MALLORY = 'did:plc:malloryaaaaaaaaaaaaaaaaa'
const RESOLVER = 'http://127.0.0.1:3182'

function okIdb(): IDBFactory {
  return {
    open: () => {
      const req = { result: { close() {} } } as unknown as IDBOpenDBRequest
      queueMicrotask(() => req.onsuccess?.({} as Event))
      return req
    },
  } as unknown as IDBFactory
}

function brokenIdb(): IDBFactory {
  return { open: () => { throw new DOMException('blocked', 'SecurityError') } } as unknown as IDBFactory
}

function resolverFetch(did: string) {
  return vi.fn(async (url: URL | RequestInfo) => {
    expect(String(url)).toBe(`${RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=alice.example.com`)
    return new Response(JSON.stringify({ did }), { status: 200 })
  }) as unknown as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** An OAuth session whose requests go to `routes` by XRPC method name. */
function fakeSession(did: string, routes: Record<string, () => Response> = {}): OAuthSession & { signOut: ReturnType<typeof vi.fn> } {
  return {
    did,
    sub: did,
    signOut: vi.fn(async () => {}),
    getTokenInfo: vi.fn(async () => ({ aud: 'https://pds.example.test', sub: did, iss: 'https://auth.example.test' })),
    fetchHandler: vi.fn(async (path: string) => {
      const method = path.replace(/^\/xrpc\//, '').split('?')[0]!
      const route = routes[method]
      return route ? route() : json({ error: 'MethodNotImplemented' }, 501)
    }),
  } as unknown as OAuthSession & { signOut: ReturnType<typeof vi.fn> }
}

describe('parseSignInInput', () => {
  it('sorts a DID, a handle and a PDS host', () => {
    expect(parseSignInInput(` ${ALICE} `)).toEqual({ kind: 'did', value: ALICE })
    expect(parseSignInInput('@Alice.Example.com')).toEqual({ kind: 'handle', value: 'alice.example.com' })
    expect(parseSignInInput('https://pds.example.com/')).toEqual({ kind: 'pds', value: 'https://pds.example.com' })
    // A host with no scheme is a handle, as the SDK reads it.
    expect(parseSignInInput('bsky.social')).toEqual({ kind: 'handle', value: 'bsky.social' })
  })

  it('refuses anything else', () => {
    for (const bad of ['', 'alice', 'http://pds.example.com', 'did:plc:short', 'alice@example.social', 'https://']) {
      expect(() => parseSignInInput(bad), bad).toThrow(InvalidSignInInput)
    }
  })
})

describe('resolveHandle', () => {
  it('refuses an answer that is not a DID', async () => {
    const doFetch = vi.fn(async () => json({ did: 'not-a-did' })) as unknown as typeof fetch
    await expect(resolveHandle(RESOLVER, 'alice.example.com', doFetch)).rejects.toThrow()
  })
})

describe('beginSignIn', () => {
  it('a handle: resolves it, and puts the expected DID in the state', async () => {
    const signIn = vi.fn(async () => undefined as never)
    await beginSignIn({ signIn }, 'alice.example.com', { handleResolver: RESOLVER, fetch: resolverFetch(ALICE), indexedDB: okIdb() })
    expect(signIn).toHaveBeenCalledWith(ALICE, { scope: BLUESKY_SCOPE, state: JSON.stringify({ input: 'alice.example.com', expected: ALICE }) })
  })

  it('a PDS host: no expected DID', async () => {
    const signIn = vi.fn(async () => undefined as never)
    await beginSignIn({ signIn }, 'https://pds.example.com', { handleResolver: RESOLVER, indexedDB: okIdb() })
    expect(signIn).toHaveBeenCalledWith('https://pds.example.com', { scope: BLUESKY_SCOPE, state: JSON.stringify({ input: 'https://pds.example.com' }) })
  })

  it('Back from the authorization page is a cancel, not a bad handle', async () => {
    const signIn = vi.fn(async () => { throw new Error('User navigated back') })
    await expect(beginSignIn({ signIn }, 'alice.example.com', { handleResolver: RESOLVER, fetch: resolverFetch(ALICE), indexedDB: okIdb() }))
      .rejects.toBeInstanceOf(SignInCancelled)
  })

  it('no site storage: says so and sends nothing', async () => {
    const signIn = vi.fn()
    const doFetch = vi.fn() as unknown as typeof fetch
    await expect(beginSignIn({ signIn }, 'alice.example.com', { handleResolver: RESOLVER, fetch: doFetch, indexedDB: brokenIdb() }))
      .rejects.toBeInstanceOf(StorageUnavailable)
    expect(signIn).not.toHaveBeenCalled()
    expect(doFetch).not.toHaveBeenCalled()
  })

  it('bad input sends nothing', async () => {
    const signIn = vi.fn()
    await expect(beginSignIn({ signIn }, 'nope', { handleResolver: RESOLVER, indexedDB: okIdb() })).rejects.toBeInstanceOf(InvalidSignInInput)
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('completeSignIn', () => {
  // The fixture's labels carry placeholder CIDs, which the SDK's response check refuses.
  const profile = { ...fixture<Record<string, unknown>>('profile-detailed.json'), did: ALICE, handle: 'alice.example.com', labels: [] }

  it('calls initCallback once and answers the account', async () => {
    const session = fakeSession(ALICE, { 'app.bsky.actor.getProfile': () => json({ ...profile, handle: 'alice.renamed.example.com' }) })
    const initCallback = vi.fn(async () => ({ session, state: JSON.stringify({ input: 'alice.example.com', expected: ALICE }) }))
    const done = await completeSignIn({ initCallback, revoke: vi.fn() })
    expect(initCallback).toHaveBeenCalledTimes(1)
    // The handle comes from the profile, not from what was typed.
    expect(done).toMatchObject({ did: ALICE, handle: 'alice.renamed.example.com', pds: 'https://pds.example.test' })
    expect(session.signOut).not.toHaveBeenCalled()
  })

  it('the sub check: another account than the handle named is revoked, and fails', async () => {
    const session = fakeSession(MALLORY)
    const initCallback = vi.fn(async () => ({ session, state: JSON.stringify({ input: 'alice.example.com', expected: ALICE }) }))
    const revoke = vi.fn(async () => {})
    const err = await completeSignIn({ initCallback, revoke }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SignInMismatch)
    expect((err as SignInMismatch).kept).toBe(false)
    expect(revoke).toHaveBeenCalledWith(MALLORY)
  })

  it('the sub check: when that account is already a Caribou account, its new session stays', async () => {
    // The SDK already revoked its earlier session to store this one; this is
    // now its only session (state rule 11).
    const session = fakeSession(MALLORY)
    const initCallback = vi.fn(async () => ({ session, state: JSON.stringify({ input: 'alice.example.com', expected: ALICE }) }))
    const revoke = vi.fn(async () => {})
    const err = await completeSignIn({ initCallback, revoke }, { isKnown: (did) => did === MALLORY }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SignInMismatch)
    expect((err as SignInMismatch).kept).toBe(true)
    expect((err as SignInMismatch).actual).toBe(MALLORY)
    expect(revoke).not.toHaveBeenCalled()
    expect(session.signOut).not.toHaveBeenCalled()
  })

  it('a callback URL with no parameters fails before the SDK is asked', async () => {
    const initCallback = vi.fn()
    await expect(completeSignIn({ initCallback, revoke: vi.fn(), readCallbackParams: () => null }))
      .rejects.toBeInstanceOf(NoCallbackParams)
    expect(initCallback).not.toHaveBeenCalled()
  })

  it('a PDS host: any account on it may sign in', async () => {
    const session = fakeSession(MALLORY, { 'app.bsky.actor.getProfile': () => json({ ...profile, did: MALLORY, handle: 'mallory.example.com' }) })
    const initCallback = vi.fn(async () => ({ session, state: JSON.stringify({ input: 'https://pds.example.test' }) }))
    await expect(completeSignIn({ initCallback, revoke: vi.fn() })).resolves.toMatchObject({ did: MALLORY, handle: 'mallory.example.com' })
  })

  it('a callback without Caribou state stores nothing', async () => {
    const session = fakeSession(ALICE)
    const revoke = vi.fn(async () => {})
    await expect(completeSignIn({ initCallback: async () => ({ session, state: null }), revoke })).rejects.toBeInstanceOf(ForeignCallback)
    expect(revoke).toHaveBeenCalledWith(ALICE)
  })

  it('a failed profile read keeps the sign-in, with the typed handle', async () => {
    const session = fakeSession(ALICE)
    const initCallback = async () => ({ session, state: JSON.stringify({ input: 'alice.example.com', expected: ALICE }) })
    await expect(completeSignIn({ initCallback, revoke: vi.fn() })).resolves.toMatchObject({ did: ALICE, handle: 'alice.example.com', profile: null })
  })
})

describe('restoreClient', () => {
  const userKey = `${ALICE}@bsky` as const

  it('restores by the stored DID and builds a client with the reader prefs and definitions', async () => {
    const session = fakeSession(ALICE, {
      'app.bsky.actor.getPreferences': () => json({ preferences: [] }),
      // The SDK writes back prefs it migrated.
      'app.bsky.actor.putPreferences': () => new Response(null, { status: 200 }),
      'app.bsky.labeler.getServices': () => json({ views: [] }),
    })
    const restore = vi.fn(async () => session)
    const out = await restoreClient({ restore } as never, ALICE, { userKey, onExpired: () => {}, key: 'G1' })
    expect(restore).toHaveBeenCalledWith(ALICE)
    expect(out.client.userKey).toBe(userKey)
    expect(out.client.capabilities.network).toBe('bluesky')
    expect(out.prefs).not.toBeNull()
    expect(out.labelDefs).toEqual({})
  })

  it('prefs or definitions that fail to load are null (fail closed)', async () => {
    const session = fakeSession(ALICE)
    const out = await restoreClient({ restore: async () => session } as never, ALICE, { userKey, onExpired: () => {}, key: 'G1' })
    expect(out.prefs).toBeNull()
    expect(out.labelDefs).toBeNull()
  })

  it('the deleted event expires the client only when no session can be restored now', async () => {
    const session = fakeSession(ALICE)
    const restore = vi.fn(async () => session)
    const onExpired = vi.fn()
    await restoreClient({ restore } as never, ALICE, { userKey, onExpired, key: 'DEL' })
    // A late event: a newer sign-in stored a session for the DID.
    notifySessionDeleted(ALICE)
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(2))
    expect(restore).toHaveBeenLastCalledWith(ALICE, false)
    expect(onExpired).not.toHaveBeenCalled()
    // Offline during the check: nothing changes.
    restore.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    notifySessionDeleted(ALICE)
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(3))
    await Promise.resolve()
    expect(onExpired).not.toHaveBeenCalled()
    // Really gone. The check's own "deleted" report is ignored.
    restore.mockImplementationOnce(async () => {
      notifySessionDeleted(ALICE)
      throw new TokenRefreshError(ALICE, 'The session was deleted by another process')
    })
    notifySessionDeleted(ALICE)
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1))
    expect(restore).toHaveBeenCalledTimes(4)
    // Once expired, it no longer listens.
    notifySessionDeleted(ALICE)
    await Promise.resolve()
    expect(restore).toHaveBeenCalledTimes(4)
  })

  it('reloadModeration loads prefs and definitions again; later decisions use them', async () => {
    let servicesUp = false
    let prefsUp = false
    const session = fakeSession(ALICE, {
      'app.bsky.actor.getPreferences': () => prefsUp ? json({ preferences: [] }) : json({ error: 'x' }, 502),
      'app.bsky.actor.putPreferences': () => new Response(null, { status: 200 }),
      'app.bsky.labeler.getServices': () => servicesUp ? json({ views: [] }) : json({ error: 'x' }, 502),
    })
    const out = await restoreClient({ restore: async () => session } as never, ALICE, { userKey, onExpired: () => {}, key: 'R1' })
    expect(out.prefs).toBeNull()
    expect(out.labelDefs).toBeNull()
    servicesUp = true
    prefsUp = true
    const again = await out.reloadModeration()
    expect(again.prefs).not.toBeNull()
    expect(again.labelDefs).toEqual({})
    expect(out.prefs).toBe(again.prefs)
    expect(out.labelDefs).toBe(again.labelDefs)
  })

  it('a 401 without a token challenge expires the session too', async () => {
    const session = fakeSession(ALICE, {
      'app.bsky.feed.getTimeline': () => json({ error: 'AuthRequired', message: 'no' }, 401),
    })
    const onExpired = vi.fn()
    const { client } = await restoreClient({ restore: async () => session } as never, ALICE, { userKey, onExpired, key: 'G1' })
    await expect(client.fetchTimeline('home', {})).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('a 5xx is not a 401: no expiry', async () => {
    const session = fakeSession(ALICE, { 'app.bsky.feed.getTimeline': () => json({ error: 'InternalServerError' }, 502) })
    const onExpired = vi.fn()
    const { client } = await restoreClient({ restore: async () => session } as never, ALICE, { userKey, onExpired, key: 'G1' })
    await expect(client.fetchTimeline('home', {})).rejects.toBeTruthy()
    expect(onExpired).not.toHaveBeenCalled()
  })

  it('a restore for a new sign-in drops the deleted listener of the earlier one', async () => {
    const old = vi.fn()
    const restore = vi.fn(async () => fakeSession(ALICE))
    await restoreClient({ restore } as never, ALICE, { userKey, onExpired: old, key: 'OLD' })
    const fresh = vi.fn()
    await restoreClient({ restore } as never, ALICE, { userKey, onExpired: fresh, key: 'NEW' })
    restore.mockImplementation(async () => { throw new TokenRevokedError(ALICE) })
    const calls = restore.mock.calls.length
    notifySessionDeleted(ALICE)
    await vi.waitFor(() => expect(fresh).toHaveBeenCalledTimes(1))
    expect(old).not.toHaveBeenCalled()
    expect(restore.mock.calls.length - calls).toBe(1)
  })

  it('a refused refresh or a revoked token is SessionGone', async () => {
    for (const err of [new TokenRefreshError(ALICE, 'refused'), new TokenRevokedError(ALICE)]) {
      await expect(restoreClient({ restore: async () => { throw err } } as never, ALICE, { userKey, onExpired: () => {}, key: 'G1' }))
        .rejects.toBeInstanceOf(SessionGone)
    }
  })

  it('a network error is passed on as it is', async () => {
    const err = new TypeError('Failed to fetch')
    await expect(restoreClient({ restore: async () => { throw err } } as never, ALICE, { userKey, onExpired: () => {}, key: 'G1' }))
      .rejects.toBe(err)
  })
})

describe('signOut', () => {
  // The SDK's own revoke, on an in-memory store, with the issuer unreachable.
  function sdkClient(stored: Map<string, unknown>, fromIssuer: () => Promise<unknown>) {
    const client = Object.create(OAuthClient.prototype) as OAuthClient
    Object.defineProperty(client, 'sessionGetter', { value: {
      getSession: async (sub: string) => {
        const v = stored.get(sub)
        if (!v) throw new TokenRefreshError(sub, 'none')
        return v
      },
      delStored: async (sub: string) => { stored.delete(sub) },
    } })
    Object.defineProperty(client, 'serverFactory', { value: { fromIssuer } })
    return client
  }
  const tokens = { dpopKey: {}, authMethod: 'none', tokenSet: { iss: 'https://auth.example.test', sub: ALICE, access_token: 'a', aud: 'x', scope: 'atproto' } }

  it('offline before the revoke starts: the stored tokens are still deleted', async () => {
    const stored = new Map<string, unknown>([[ALICE, tokens]])
    const client = sdkClient(stored, async () => { throw new TypeError('Failed to fetch') })
    await signOut(client, ALICE).catch(() => {})
    expect(stored.has(ALICE)).toBe(false)
  })

  it('a revoke that hangs is cut off, and the stored tokens are deleted', async () => {
    const stored = new Map<string, unknown>([[ALICE, tokens]])
    // The revoke request goes out through the SDK fetch and never answers.
    const base = vi.fn((_: unknown, init?: RequestInit) => new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    }))
    vi.stubGlobal('fetch', base)
    try {
      const client = sdkClient(stored, async () => ({ revoke: () => sdkFetch('https://auth.example.test/oauth/revoke', { method: 'POST' }) }))
      const started = Date.now()
      await signOut(client, ALICE, { timeoutMs: 30 }).catch(() => {})
      expect(Date.now() - started).toBeLessThan(2000)
      expect(stored.has(ALICE)).toBe(false)
      expect(base).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('no stored session: nothing to do', async () => {
    const client = sdkClient(new Map(), async () => { throw new Error('not reached') })
    await expect(signOut(client, ALICE)).resolves.toBeUndefined()
  })

  it('outside a sign-out, SDK requests are not cut off', async () => {
    const base = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', base)
    try {
      await sdkFetch('https://pds.example.test/xrpc/x')
      expect(base.mock.calls[0]).toEqual(['https://pds.example.test/xrpc/x', undefined])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
