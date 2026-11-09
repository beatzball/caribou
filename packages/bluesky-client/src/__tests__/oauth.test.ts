import { describe, expect, it, vi } from 'vitest'
import { OAuthClient, SessionGetter, TokenRefreshError, TokenRevokedError, requestLocalLock, type OAuthSession } from '@atproto/oauth-client-browser'
import {
  beginSignIn, completeSignIn, parseSignInInput, restoreClient, signOut, resolveHandle, notifySessionDeleted, NoCallbackParams, SignInCancelled, ForeignCallback,
  InvalidSignInInput, SessionGone, SignInMismatch, StorageUnavailable, BLUESKY_SCOPE,
} from '../oauth.js'
import { BSKY_LABELER_DID } from '@atproto/api'
import { blueskyCheckSettled } from '../moderation.js'
import { fixture } from './_helpers.js'

const ALICE = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const BOB = 'did:plc:bobbbbbbbbbbbbbbbbbbbbbb'
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

const L = 'did:web:labeler.example.com'
const labelerService = (did: string) => ({
  $type: 'app.bsky.labeler.defs#labelerViewDetailed',
  uri: `at://${did}/app.bsky.labeler.service/self`, cid: 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm',
  creator: { did, handle: 'labeler.example.com' }, policies: { labelValues: [] }, indexedAt: '2026-01-01T00:00:00.000Z',
})

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

  // Codex's case (#235): labeler L's definitions loaded, then L is taken
  // down. The AppView drops L from a later answer, and the browser cannot
  // read the header that says so. The content shows until the next
  // successful definitions check; that check finds no view for L and covers
  // again. This records the window the owner accepted on 2026-11-09
  // (bluesky-client README, "Known gap: a labeler dropped after its
  // definitions loaded").
  it('accepted gap: a labeler taken down after its definitions loaded shows content until the next successful check, then covers', async () => {
    let lUp = true
    const sent: (string | null)[] = []
    // Like the AppView: a view only for each labeler asked for.
    let asked: string[] = []
    const session = fakeSession(ALICE, {
      'app.bsky.actor.getPreferences': () => json({ preferences: [{ $type: 'app.bsky.actor.defs#labelersPref', labelers: [{ did: L }] }] }),
      'app.bsky.actor.putPreferences': () => new Response(null, { status: 200 }),
      'app.bsky.labeler.getServices': () => json({ views: [BSKY_LABELER_DID, ...lUp ? [L] : []].filter((d) => asked.includes(d)).map(labelerService) }),
      // No `atproto-content-labelers`: the browser cannot read it.
      'app.bsky.actor.getProfile': () => json({ did: BOB, handle: 'bob.example.com' }),
    })
    const handler = session.fetchHandler as unknown as ReturnType<typeof vi.fn>
    const inner = handler.getMockImplementation()!
    handler.mockImplementation(async (path: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get('atproto-accept-labelers'))
      asked = new URLSearchParams(path.split('?')[1]).getAll('dids')
      return inner(path, init)
    })
    const out = await restoreClient({ restore: async () => session } as never, ALICE, { userKey, onExpired: () => {}, key: 'TD' })
    const reader = () => ({ userKey, prefs: out.prefs, labelDefs: out.labelDefs })
    const settled = async () => {
      const a = await out.client.lookupAccount(`bob.example.com${sent.length}`)
      return blueskyCheckSettled({ viewerOf: userKey, moderation: a.bluesky!.moderation! }, reader())
    }
    expect(Object.keys(out.labelDefs!)).toEqual(expect.arrayContaining([BSKY_LABELER_DID, L]))
    expect(await settled()).toBe(true)
    expect(sent.at(-1)).toContain(L)

    // A check while L is up keeps L's definitions.
    const kept = await out.recheckLabelers()
    expect(Object.keys(kept.labelDefs!)).toEqual(expect.arrayContaining([BSKY_LABELER_DID, L]))
    expect(await settled()).toBe(true)

    // L is taken down. The next answer still names nothing: shown, as before.
    lUp = false
    expect(await settled()).toBe(true)

    // The next definitions check finds no view for L: covered.
    const after = await out.recheckLabelers()
    expect(Object.keys(after.labelDefs!)).toEqual([BSKY_LABELER_DID])
    expect(out.labelDefs).toBe(after.labelDefs)
    expect(await settled()).toBe(false)
  })

  // A Retry does not wait for a check in flight (`_bluesky-session.ts`).
  // The slow check began while L was up; the Retry saw L gone.
  it('a full load that starts after a check began wins: the check does not put back a labeler the load saw as gone', async () => {
    let lUp = true
    let release: (() => void) | null = null
    let holdNext = false
    const session = fakeSession(ALICE, {
      'app.bsky.actor.getPreferences': () => json({ preferences: [{ $type: 'app.bsky.actor.defs#labelersPref', labelers: [{ did: L }] }] }),
      'app.bsky.actor.putPreferences': () => new Response(null, { status: 200 }),
      'app.bsky.labeler.getServices': (() => {
        const res = json({ views: [labelerService(BSKY_LABELER_DID), ...lUp ? [labelerService(L)] : []] })
        if (!holdNext) return res
        holdNext = false
        return new Promise<Response>((r) => { release = () => r(res) })
      }) as unknown as () => Response,
    })
    const out = await restoreClient({ restore: async () => session } as never, ALICE, { userKey, onExpired: () => {}, key: 'NW' })
    expect(Object.keys(out.labelDefs!)).toEqual(expect.arrayContaining([L]))

    holdNext = true
    const check = out.recheckLabelers()
    await vi.waitFor(() => expect(release).not.toBeNull())
    lUp = false
    const reload = await out.reloadModeration()
    expect(Object.keys(reload.labelDefs!)).toEqual([BSKY_LABELER_DID])

    release!()
    const late = await check
    expect(Object.keys(late.labelDefs!)).toEqual([BSKY_LABELER_DID])
    expect(Object.keys(out.labelDefs!)).toEqual([BSKY_LABELER_DID])
  })

  it('recheckLabelers: a failed check keeps the definitions; a 401 ends the session', async () => {
    let services: () => Response = () => json({ views: [] })
    const session = fakeSession(ALICE, {
      'app.bsky.actor.getPreferences': () => json({ preferences: [] }),
      'app.bsky.actor.putPreferences': () => new Response(null, { status: 200 }),
      'app.bsky.labeler.getServices': () => services(),
    })
    const onExpired = vi.fn()
    const out = await restoreClient({ restore: async () => session } as never, ALICE, { userKey, onExpired, key: 'RC' })
    const defs = out.labelDefs
    services = () => json({ error: 'x' }, 502)
    expect((await out.recheckLabelers()).labelDefs).toBe(defs)
    expect(onExpired).not.toHaveBeenCalled()
    services = () => json({ error: 'AuthRequired' }, 401)
    await out.recheckLabelers()
    expect(onExpired).toHaveBeenCalled()
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

  it.each(['app.bsky.actor.getPreferences', 'app.bsky.labeler.getServices'])(
    'a 401 from %s at restore expires the session; moderation stays fail closed', async (method) => {
      const routes: Record<string, () => Response> = {
        'app.bsky.actor.getPreferences': () => json({ preferences: [] }),
        'app.bsky.actor.putPreferences': () => new Response(null, { status: 200 }),
        'app.bsky.labeler.getServices': () => json({ views: [] }),
        [method]: () => json({ error: 'AuthRequired', message: 'no' }, 401),
      }
      const onExpired = vi.fn()
      const out = await restoreClient({ restore: async () => fakeSession(ALICE, routes) } as never, ALICE, { userKey, onExpired, key: 'M401' })
      expect(onExpired).toHaveBeenCalledTimes(1)
      expect(method.endsWith('getPreferences') ? out.prefs : out.labelDefs).toBeNull()
    })

  it.each(['app.bsky.actor.getPreferences', 'app.bsky.labeler.getServices'])(
    'a 401 from %s in reloadModeration expires the session too', async (method) => {
      let fail = false
      const routes: Record<string, () => Response> = {
        'app.bsky.actor.getPreferences': () => json({ preferences: [] }),
        'app.bsky.actor.putPreferences': () => new Response(null, { status: 200 }),
        'app.bsky.labeler.getServices': () => json({ views: [] }),
      }
      const ok = routes[method]!
      routes[method] = () => fail ? json({ error: 'AuthRequired' }, 401) : ok()
      const onExpired = vi.fn()
      const out = await restoreClient({ restore: async () => fakeSession(ALICE, routes) } as never, ALICE, { userKey, onExpired, key: 'R401' })
      expect(onExpired).not.toHaveBeenCalled()
      fail = true
      const again = await out.reloadModeration()
      expect(onExpired).toHaveBeenCalledTimes(1)
      expect(method.endsWith('getPreferences') ? again.prefs : again.labelDefs).toBeNull()
    })

  it('a 502 or a network error in the moderation loads: null, no expiry', async () => {
    const onExpired = vi.fn()
    const routes: Record<string, () => Response> = {
      'app.bsky.actor.getPreferences': () => json({ error: 'x' }, 502),
      'app.bsky.labeler.getServices': () => { throw new TypeError('Failed to fetch') },
    }
    const out = await restoreClient({ restore: async () => fakeSession(ALICE, routes) } as never, ALICE, { userKey, onExpired, key: 'M502' })
    expect(out.prefs).toBeNull()
    expect(out.labelDefs).toBeNull()
    expect(onExpired).not.toHaveBeenCalled()
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
  const stored0 = (expiresAt: string) => ({
    dpopKey: {}, authMethod: 'none',
    tokenSet: { iss: 'https://auth.example.test', sub: ALICE, access_token: 'acc-1', refresh_token: 'ref-1', aud: 'x', scope: 'atproto', expires_at: expiresAt },
  })

  // The SDK's own client and session getter, with its own local lock, over
  // an in-memory store. `server` answers fromIssuer.
  function sdk(server: { refresh?: () => Promise<unknown>; revoke: (t: string) => Promise<void> }, initial?: unknown) {
    const map = new Map<string, unknown>(initial ? [[ALICE, initial]] : [])
    const store = {
      get: async (k: string) => map.get(k),
      set: async (k: string, v: unknown) => { map.set(k, v) },
      del: async (k: string) => { map.delete(k) },
    }
    const serverFactory = { fromIssuer: async () => ({ authMethod: 'none', ...server }) }
    const runtime = { hasImplementationLock: true, usingLock: requestLocalLock }
    const getter = new SessionGetter(store as never, serverFactory as never, runtime as never)
    const client = Object.create(OAuthClient.prototype) as OAuthClient
    Object.defineProperty(client, 'sessionGetter', { value: getter })
    Object.defineProperty(client, 'serverFactory', { value: serverFactory })
    return { client, map, getter }
  }

  it('a refresh pending at sign-out that lands with new tokens: the store stays empty', async () => {
    let land!: (v: unknown) => void
    const revoke = vi.fn((_token: string) => new Promise<void>(() => {}))  // the server never answers
    const fresh = { iss: 'https://auth.example.test', sub: ALICE, access_token: 'acc-2', refresh_token: 'ref-2', aud: 'x', scope: 'atproto' }
    const { client, map, getter } = sdk({ refresh: () => new Promise((r) => { land = r }), revoke }, stored0('2000-01-01T00:00:00.000Z'))
    // A stale token: this starts a refresh that holds the SDK's per-DID lock.
    const pending = getter.getSession(ALICE as never).catch(() => {})
    await new Promise((r) => setTimeout(r, 10))
    await signOut(client, ALICE)
    // When sign-out answers (the entry goes), nothing is stored.
    expect(map.has(ALICE)).toBe(false)
    // The refresh lands with new tokens: the write is refused.
    land(fresh)
    await pending
    await new Promise((r) => setTimeout(r, 10))
    expect(map.has(ALICE)).toBe(false)
    // The read tokens and the dropped ones are revoked, best effort.
    expect(revoke.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['ref-1', 'ref-2']))
  })

  it('another DID writes as before while one signs out', async () => {
    const { client, map, getter } = sdk({ revoke: async () => {} }, stored0('2999-01-01T00:00:00.000Z'))
    await signOut(client, ALICE)
    await getter.setStored(BOB as never, { ...stored0('2999-01-01T00:00:00.000Z'), tokenSet: { ...stored0('2999').tokenSet, sub: BOB } } as never)
    expect(map.has(BOB)).toBe(true)
  })

  it('a new sign-in for the DID stores normally again', async () => {
    const { client, map, getter } = sdk({ revoke: async () => {} }, stored0('2999-01-01T00:00:00.000Z'))
    await signOut(client, ALICE)
    await getter.setStored(ALICE as never, stored0('2999-01-01T00:00:00.000Z') as never)
    expect(map.has(ALICE)).toBe(false)
    // beginSignIn for this DID takes it out of the set.
    const signIn = vi.fn(async () => undefined as never)
    await beginSignIn({ signIn }, ALICE, { handleResolver: RESOLVER, indexedDB: okIdb() })
    await getter.setStored(ALICE as never, stored0('2999-01-01T00:00:00.000Z') as never)
    expect(map.has(ALICE)).toBe(true)
  })

  it('offline: the stored tokens are deleted, and sign-out does not throw', async () => {
    const { client, map } = sdk({ revoke: async () => { throw new TypeError('Failed to fetch') } }, stored0('2999-01-01T00:00:00.000Z'))
    await expect(signOut(client, ALICE)).resolves.toBeUndefined()
    expect(map.has(ALICE)).toBe(false)
  })

  it('the issuer cannot be reached: the stored tokens are still deleted', async () => {
    const { client, map } = sdk({ revoke: async () => {} }, stored0('2999-01-01T00:00:00.000Z'))
    const unreachable = Object.create(client) as OAuthClient
    Object.defineProperty(unreachable, 'serverFactory', { value: { fromIssuer: async () => { throw new TypeError('Failed to fetch') } } })
    await signOut(unreachable, ALICE)
    expect(map.has(ALICE)).toBe(false)
  })

  it('no stored session: nothing to do', async () => {
    const revoke = vi.fn(async () => {})
    const { client } = sdk({ revoke })
    await expect(signOut(client, ALICE)).resolves.toBeUndefined()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('an SDK without the session store fails loudly, so an upgrade is noticed', async () => {
    const client = Object.create(OAuthClient.prototype) as OAuthClient
    await expect(signOut(client, ALICE)).rejects.toThrow(/session store/)
  })
})
