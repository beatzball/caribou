import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserOAuthClient, WebcryptoKey, OAuthClient, OAuthServerAgent, OAuthSession,
  SessionGetter, TokenRefreshError, TokenRevokedError, requestLocalLock,
} from '@atproto/oauth-client-browser'
import { loadOAuthClient, restoreClient } from '../oauth.js'
import { readSessionEnds } from '../session-diagnostics.js'

const DID = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const ISSUER = 'https://auth.example.test'
const fresh = () => new Response(JSON.stringify({
  access_token: 'next-access', refresh_token: 'next-refresh', token_type: 'DPoP',
  scope: 'atproto transition:generic', expires_in: 300, sub: DID,
}), { headers: { 'content-type': 'application/json' } })

async function setup(doFetch: typeof fetch) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const key = await WebcryptoKey.fromKeypair(pair)
  const initial = {
    dpopKey: key, authMethod: 'none', tokenSet: {
      iss: ISSUER, aud: 'https://pds.example.test', sub: DID, scope: 'atproto transition:generic',
      token_type: 'DPoP', access_token: 'old-access', refresh_token: 'old-refresh',
      expires_at: '2000-01-01T00:00:00.000Z',
    },
  }
  const stored = new Map<string, unknown>([[DID, initial]])
  const store = {
    get: async (sub: string) => stored.get(sub),
    set: async (sub: string, value: unknown) => { stored.set(sub, value) },
    del: vi.fn(async (sub: string) => { stored.delete(sub) }),
  }
  let getter!: SessionGetter
  let server!: OAuthServerAgent
  let serverFactory!: { fromIssuer: () => Promise<OAuthServerAgent> }
  let deleted!: (sub: string, cause: unknown) => unknown
  vi.spyOn(BrowserOAuthClient, 'load').mockImplementation(async (options) => {
    deleted = options.onSessionDeleted as typeof deleted
    server = new OAuthServerAgent({ method: 'none' }, key, {
      token_endpoint_auth_methods_supported: ['none'], issuer: ISSUER, token_endpoint: `${ISSUER}/oauth/token`, dpop_signing_alg_values_supported: ['ES256'],
    } as never, {
      client_id: 'https://client.example.test/metadata.json', token_endpoint_auth_method: 'none',
    } as never, { get: async () => undefined, set: async () => {}, del: async () => {} }, {
      resolveFromIdentity: async () => ({ metadata: { issuer: ISSUER }, pds: new URL('https://pds.example.test') }),
    } as never, { sha256: async (input: string) => createHash('sha256').update(input).digest('base64url') } as never, undefined, options.fetch ?? doFetch)
    serverFactory = { fromIssuer: async () => server }
    getter = new SessionGetter(store as never, serverFactory as never, {
      hasImplementationLock: true, usingLock: requestLocalLock,
    } as never, { onSessionDeleted: options.onSessionDeleted })
    const client = Object.create(OAuthClient.prototype)
    Object.defineProperties(client, { sessionGetter: { value: getter }, serverFactory: { value: serverFactory } })
    return client
  })
  // Use the test transport for every SDK request.
  vi.stubGlobal('fetch', doFetch)
  const oauth = await loadOAuthClient({ clientId: `https://client.example.test/${crypto.randomUUID()}`, handleResolver: 'https://resolver.example.test' })
  return { getter, stored, store, initial, server, serverFactory, oauth, deleted }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('session recovery rule 1: real SDK token endpoint', () => {
  it.each([
    ['offline', () => { throw new TypeError('Failed to fetch') }],
    ['timeout', () => { throw new DOMException('timed out', 'TimeoutError') }],
    ['abort', () => { throw new DOMException('aborted', 'AbortError') }],
    ['server failure', () => new Response(JSON.stringify({ error: 'server_error' }), { status: 503, headers: { 'content-type': 'application/json' } })],
  ] as const)('%s keeps the session and the next request can refresh', async (_name, fail) => {
    const transport = vi.fn().mockImplementationOnce(fail).mockImplementation(fresh)
    const { getter, stored, store, initial } = await setup(transport)
    await expect(getter.getSession(DID)).rejects.toBeTruthy()
    expect(stored.get(DID)).toBe(initial)
    expect(store.del).not.toHaveBeenCalled()
    expect(transport).toHaveBeenCalledTimes(1) // Never replay a token exchange.
    await expect(getter.getSession(DID)).resolves.toMatchObject({ tokenSet: { access_token: 'next-access' } })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('a real invalid_grant deletes the session', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }))
    const { getter, stored, store } = await setup(transport)
    await expect(getter.getSession(DID)).rejects.toBeInstanceOf(TokenRefreshError)
    expect(stored.has(DID)).toBe(false)
    expect(store.del).toHaveBeenCalledTimes(1)
  })

  it('use_dpop_nonce retries with a fresh proof and keeps the session', async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'use_dpop_nonce' }), {
      status: 400, headers: { 'content-type': 'application/json', 'dpop-nonce': 'next-nonce' },
    })).mockImplementation(fresh)
    const { getter, store } = await setup(transport)
    await expect(getter.getSession(DID)).resolves.toBeTruthy()
    expect(transport).toHaveBeenCalledTimes(2)
    expect(store.del).not.toHaveBeenCalled()
    const proofs = transport.mock.calls.map(([req]) => (req as Request).headers.get('DPoP'))
    expect(proofs[0]).not.toBe(proofs[1])
  })
})


describe('session recovery rule 2: challenged 401 and forced refresh', () => {
  it.each([
    ['offline', () => { throw new TypeError('Failed to fetch') }],
    ['timeout', () => { throw new DOMException('timed out', 'TimeoutError') }],
    ['abort', () => { throw new DOMException('aborted', 'AbortError') }],
    ['503', () => new Response(JSON.stringify({ error: 'server_error' }), { status: 503, headers: { 'content-type': 'application/json' } })],
  ] as const)('%s keeps the account and the next call works', async (_name, fail) => {
    let failRefresh = true
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      const req = input as Request
      if (req.url.endsWith('/oauth/token')) return failRefresh ? fail() : fresh()
      if (req.url.includes('getPreferences')) return Response.json({ preferences: [] })
      if (req.url.includes('getServices')) return Response.json({ views: [] })
      if (req.url.includes('getTimeline')) return req.headers.get('Authorization')?.includes('old-access')
        ? new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'DPoP error="invalid_token"' } })
        : Response.json({ feed: [] })
      return new Response(null, { status: 200 })
    })
    const { getter, initial, server, store } = await setup(transport)
    initial.tokenSet.expires_at = '2999-01-01T00:00:00.000Z'
    const session = new OAuthSession(server, DID, getter, transport)
    const onExpired = vi.fn()
    const restore = vi.fn(async (_did: string, refresh?: boolean) => {
      await getter.getSession(DID, refresh)
      return session
    })
    const { client } = await restoreClient({ restore } as never, DID, {
      userKey: `${DID}@bsky`, key: 'recovery', onExpired,
    })
    await expect(client.fetchTimeline('home', {})).rejects.toMatchObject({ code: 'unauthorized' })
    await vi.waitFor(() => expect(restore).toHaveBeenLastCalledWith(DID, false))
    expect(store.del).not.toHaveBeenCalled()
    expect(onExpired).not.toHaveBeenCalled()
    failRefresh = false
    await expect(client.fetchTimeline('home', {})).resolves.toHaveLength(0)
    expect(onExpired).not.toHaveBeenCalled()
  })
})

it('session recovery rule 4: a late SDK deletion does not log an end for a working newer session', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  })
  const { initial, oauth, deleted } = await setup(vi.fn(async () => Response.json({ preferences: [], views: [] })))
  initial.tokenSet.expires_at = '2999-01-01T00:00:00.000Z'
  const onExpired = vi.fn()
  await restoreClient(oauth, DID, { userKey: `${DID}@bsky`, key: 'new-sign-in', onExpired })
  const restore = vi.spyOn(oauth, 'restore')
  await deleted(DID, new TokenRevokedError(DID))
  await vi.waitFor(() => expect(restore).toHaveBeenCalledWith(DID, false))
  expect(onExpired).not.toHaveBeenCalled()
  expect(readSessionEnds()).toEqual([])
})


function localDiagnostics() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  })
}

function bare401(input: RequestInfo | URL) {
  const request = input as Request
  return request.url.includes('getTimeline')
    ? Response.json({ error: 'AuthRequired' }, { status: 401 })
    : Response.json({ preferences: [], views: [] })
}

// Keep API reads independent of SDK token reads: the review probe uses a
// fake API session returning a bare 401, while every check uses the real
// OAuthClient.restore and SessionGetter. Unfinished preference requests
// must not accidentally trigger another SDK deletion and mask this race.
function checkedApi(oauth: Pick<OAuthClient, 'restore'>) {
  const session = {
    did: DID,
    fetchHandler: async (path: string, init?: RequestInit) =>
      bare401(new Request(new URL(path, 'https://pds.example.test'), init)),
  } as unknown as OAuthSession
  return { restore: vi.fn((did: string, refresh?: boolean) => refresh === false
    ? oauth.restore(did, false)
    : Promise.resolve(session)) }
}

// OAuthClient.restore reads SessionGetter first, then awaits fromIssuer.
// Pause there so the first check will return the credentials read before
// a deletion. A later request must not be needed to notice that deletion.
function pauseAfterRead(factory: { fromIssuer: () => Promise<OAuthServerAgent> }, server: OAuthServerAgent, fail = false) {
  let resume!: () => void
  let read!: () => void
  const readDone = new Promise<void>((resolve) => { read = resolve })
  const gate = new Promise<void>((resolve) => { resume = resolve })
  vi.spyOn(factory, 'fromIssuer').mockImplementationOnce(async () => {
    read()
    await gate
    if (fail) throw new TypeError('Failed to fetch')
    return server
  })
  return { readDone, resume }
}

describe('deleted-event rule: retain independent notices during a check', () => {
  it.each([{ fail: false, missing: false }, { fail: true, missing: false }, { fail: false, missing: true }])(
    'a 401 check (transient failure=$fail, missing-store notice=$missing) retains a deletion after its stored read and logs the terminal cause',
    async ({ fail, missing }) => {
      localDiagnostics()
      const { initial, oauth, getter, stored, server, serverFactory } = await setup(vi.fn(async (input) => bare401(input)))
      initial.tokenSet.expires_at = '2999-01-01T00:00:00.000Z'
      const onExpired = vi.fn()
      const api = checkedApi(oauth)
      const { client } = await restoreClient(api, DID, { userKey: `${DID}@bsky`, key: 'overlap', onExpired })
      const restore = api.restore.mockClear()
      const { readDone, resume } = pauseAfterRead(serverFactory, server, fail)
      await expect(client.fetchTimeline('home', {})).rejects.toMatchObject({ code: 'unauthorized' })
      await readDone
      expect(restore).toHaveBeenCalledTimes(1)
      const terminalCause = missing
        ? new TokenRefreshError(DID, 'The session was deleted by another process')
        : new TokenRevokedError(DID)
      await getter.delStored(DID, terminalCause)
      expect(stored.has(DID)).toBe(false)
      // Repeated independent notifications coalesce and preserve the cause.
      await getter.delStored(DID, terminalCause)
      expect(onExpired).not.toHaveBeenCalled()
      resume()
      await vi.waitFor(() => expect(onExpired).toHaveBeenCalledOnce())
      expect(restore).toHaveBeenCalledTimes(2)
      expect(readSessionEnds()).toEqual([expect.objectContaining({
        errorClass: missing ? 'TokenRefreshError' : 'TokenRevokedError',
        message: missing ? 'No stored session' : 'Token was revoked',
      })])
    },
  )

  it.each([false, true])('a newer working sign-in survives an older deletion (new listener=%s)', async (newListener) => {
    localDiagnostics()
    const { initial, oauth, getter, stored, server, serverFactory } = await setup(vi.fn(async (input) => bare401(input)))
    initial.tokenSet.expires_at = '2999-01-01T00:00:00.000Z'
    const oldExpired = vi.fn()
    const api = checkedApi(oauth)
    const { client } = await restoreClient(api, DID, { userKey: `${DID}@bsky`, key: 'older', onExpired: oldExpired })
    const restore = api.restore.mockClear()
    const { readDone, resume } = pauseAfterRead(serverFactory, server)
    await expect(client.fetchTimeline('home', {})).rejects.toMatchObject({ code: 'unauthorized' })
    await readDone
    const oldCheck = restore.mock.results[0]!.value as Promise<OAuthSession>
    await getter.delStored(DID, new TokenRevokedError(DID))
    await getter.setStored(DID, { ...initial, tokenSet: {
      ...initial.tokenSet, access_token: 'new-generation-access', refresh_token: 'new-generation-refresh',
    } } as never)
    const freshExpired = vi.fn()
    if (newListener) await restoreClient(api, DID, { userKey: `${DID}@bsky`, key: 'newer', onExpired: freshExpired })
    resume()
    await oldCheck
    // Without a replacement listener the queued check must read the newer
    // credentials; with one, only the newer listener may handle notices.
    if (!newListener) await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    expect(restore).toHaveBeenCalledTimes(2)
    expect(oldExpired).not.toHaveBeenCalled()
    expect(freshExpired).not.toHaveBeenCalled()
    expect(stored.get(DID)).toMatchObject({ tokenSet: { access_token: 'new-generation-access' } })
    expect(readSessionEnds()).toEqual([])
  })
})
