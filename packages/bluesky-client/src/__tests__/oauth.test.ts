import { describe, expect, it, vi } from 'vitest'
import { TokenRefreshError, TokenRevokedError, type OAuthSession } from '@atproto/oauth-client-browser'
import {
  beginSignIn, completeSignIn, parseSignInInput, restoreClient, signOut, resolveHandle,
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
    const done = await completeSignIn({ initCallback })
    expect(initCallback).toHaveBeenCalledTimes(1)
    // The handle comes from the profile, not from what was typed.
    expect(done).toMatchObject({ did: ALICE, handle: 'alice.renamed.example.com', pds: 'https://pds.example.test' })
    expect(session.signOut).not.toHaveBeenCalled()
  })

  it('the sub check: another account than the handle named is revoked, and fails', async () => {
    const session = fakeSession(MALLORY)
    const initCallback = vi.fn(async () => ({ session, state: JSON.stringify({ input: 'alice.example.com', expected: ALICE }) }))
    await expect(completeSignIn({ initCallback })).rejects.toBeInstanceOf(SignInMismatch)
    expect(session.signOut).toHaveBeenCalledTimes(1)
  })

  it('a PDS host: any account on it may sign in', async () => {
    const session = fakeSession(MALLORY, { 'app.bsky.actor.getProfile': () => json({ ...profile, did: MALLORY, handle: 'mallory.example.com' }) })
    const initCallback = vi.fn(async () => ({ session, state: JSON.stringify({ input: 'https://pds.example.test' }) }))
    await expect(completeSignIn({ initCallback })).resolves.toMatchObject({ did: MALLORY, handle: 'mallory.example.com' })
  })

  it('a callback without Caribou state stores nothing', async () => {
    const session = fakeSession(ALICE)
    await expect(completeSignIn({ initCallback: async () => ({ session, state: null }) })).rejects.toThrow()
    expect(session.signOut).toHaveBeenCalled()
  })

  it('a failed profile read keeps the sign-in, with the typed handle', async () => {
    const session = fakeSession(ALICE)
    const initCallback = async () => ({ session, state: JSON.stringify({ input: 'alice.example.com', expected: ALICE }) })
    await expect(completeSignIn({ initCallback })).resolves.toMatchObject({ did: ALICE, handle: 'alice.example.com', profile: null })
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
    const out = await restoreClient({ restore } as never, ALICE, { userKey, onExpired: () => {} })
    expect(restore).toHaveBeenCalledWith(ALICE)
    expect(out.client.userKey).toBe(userKey)
    expect(out.client.capabilities.network).toBe('bluesky')
    expect(out.prefs).not.toBeNull()
    expect(out.labelDefs).toEqual({})
  })

  it('prefs or definitions that fail to load are null (fail closed)', async () => {
    const session = fakeSession(ALICE)
    const out = await restoreClient({ restore: async () => session } as never, ALICE, { userKey, onExpired: () => {} })
    expect(out.prefs).toBeNull()
    expect(out.labelDefs).toBeNull()
  })

  it('a refused refresh or a revoked token is SessionGone', async () => {
    for (const err of [new TokenRefreshError(ALICE, 'refused'), new TokenRevokedError(ALICE)]) {
      await expect(restoreClient({ restore: async () => { throw err } } as never, ALICE, { userKey, onExpired: () => {} }))
        .rejects.toBeInstanceOf(SessionGone)
    }
  })

  it('a network error is passed on as it is', async () => {
    const err = new TypeError('Failed to fetch')
    await expect(restoreClient({ restore: async () => { throw err } } as never, ALICE, { userKey, onExpired: () => {} }))
      .rejects.toBe(err)
  })
})

describe('signOut', () => {
  it('revokes the restored session', async () => {
    const session = fakeSession(ALICE)
    const restore = vi.fn(async () => session)
    await signOut({ restore } as never, ALICE)
    expect(restore).toHaveBeenCalledWith(ALICE, false)
    expect(session.signOut).toHaveBeenCalled()
  })

  it('no stored session: nothing to do', async () => {
    await expect(signOut({ restore: async () => { throw new TokenRefreshError(ALICE, 'gone') } } as never, ALICE)).resolves.toBeUndefined()
  })
})
