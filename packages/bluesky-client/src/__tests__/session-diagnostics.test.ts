import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthResponseError, TokenRefreshError } from '@atproto/oauth-client-browser'
import { recordSessionEnd, readSessionEnds, SESSION_END_KEY } from '../session-diagnostics.js'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  })
  vi.stubGlobal('navigator', { onLine: false })
  vi.stubGlobal('document', { visibilityState: 'hidden' })
})
afterEach(() => vi.unstubAllGlobals())

describe('session recovery rule 4: local end diagnostics', () => {
  it('keeps only the last 20 entries and records browser state and HTTP status', () => {
    const err = new TokenRefreshError('did:plc:alice', 'server supplied private message', {
      cause: new OAuthResponseError(new Response(null, { status: 400 }), { error: 'invalid_grant' }),
    })
    for (let n = 0; n < 25; n++) recordSessionEnd('deleted', err)
    const entries = readSessionEnds()
    expect(entries).toHaveLength(20)
    expect(entries[0]).toMatchObject({
      reason: 'deleted', errorClass: 'TokenRefreshError', message: 'Refresh token was refused (invalid_grant)',
      status: 400, online: false, visibility: 'hidden', time: expect.any(String),
    })
  })

  it('never stores tokens, identifiers, raw messages or attacker supplied class names', () => {
    const secret = 'did:plc:alice alice.example.com access-secret refresh-secret https://private.example.test'
    const err = new Error(secret, { cause: new Error(secret) })
    err.name = secret
    recordSessionEnd('deleted', err)
    const text = localStorage.getItem(SESSION_END_KEY)!
    for (const value of secret.split(' ')) expect(text).not.toContain(value)
    expect(readSessionEnds()[0]).toMatchObject({ errorClass: 'Error', message: 'Session deleted; error details redacted' })
  })

  it('rejects untrusted or malformed stored rows instead of displaying raw text', () => {
    localStorage.setItem(SESSION_END_KEY, JSON.stringify([{ time: 'now', errorClass: 'private', message: 'access-secret' }]))
    expect(readSessionEnds()).toEqual([])
    localStorage.setItem(SESSION_END_KEY, '{')
    expect(readSessionEnds()).toEqual([])
  })

  it('unavailable storage cannot break session handling', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(() => recordSessionEnd('sign-out')).not.toThrow()
    expect(readSessionEnds()).toEqual([])
  })
})

describe('session recovery rule 4: preserve the cause across reloads', () => {
  it('a later missing-store check does not replace the reason for the same sign-in', () => {
    const key = 'did:plc:alice generation-one'
    const err = new TokenRefreshError('did:plc:alice', 'refused', {
      cause: new OAuthResponseError(new Response(null, { status: 400 }), { error: 'invalid_grant' }),
    })
    recordSessionEnd('deleted', err, { key })
    recordSessionEnd('restore', new TokenRefreshError('did:plc:alice', 'The session was deleted by another process'), { key })
    // BroadcastChannel may clone an SDK error as a plain Error.
    recordSessionEnd('deleted', new Error('private cloned text'), { key })
    expect(readSessionEnds()).toHaveLength(1)
    expect(readSessionEnds()[0]!.message).toContain('invalid_grant')
    expect(localStorage.getItem(SESSION_END_KEY)).not.toContain(key)
    recordSessionEnd('restore', new TokenRefreshError('did:plc:alice', 'The session was deleted by another process'), { key: 'did:plc:alice generation-two' })
    expect(readSessionEnds()).toHaveLength(2)
  })

  it('records a stable SDK class even when the production bundle renamed its constructor', () => {
    recordSessionEnd('deleted', new Error('private text'), { errorClass: 'TokenInvalidError' })
    expect(readSessionEnds()[0]).toMatchObject({ errorClass: 'TokenInvalidError', message: 'Refreshed token was rejected' })
  })
})
