import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { users, activeUserKey, addUserSession } from '@beatzball/caribou-state'
import type * as BlueskyModule from '../_bluesky.js'

const DID = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const BOB = 'did:plc:bobbbbbbbbbbbbbbbbbbbbbb'
const completeSignIn = vi.fn()
class SignInRejected extends Error {
  constructor(m: string, readonly actual: string, readonly kept: boolean) { super(m) }
}
class SignInMismatch extends SignInRejected {
  constructor(readonly expected: string, actual: string, kept: boolean) { super('mismatch', actual, kept) }
}
class NoCallbackParams extends Error {}

vi.mock('../_bluesky.js', async (importOriginal) => ({
  ...(await importOriginal<typeof BlueskyModule>()),
  loadBluesky: vi.fn(async () => ({
    loadOAuthClient: async () => ({}),
    completeSignIn,
    StorageUnavailable: class extends Error {},
    InvalidSignInInput: class extends Error {},
    SignInCancelled: class extends Error {},
    SignInRejected,
    SignInMismatch,
    NoCallbackParams,
  })),
}))

const { resetFinishForTests } = await import('../_bluesky-session.js')
const { resetCallbackForTests } = await import('../caribou-bluesky-callback.js')

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  resetFinishForTests()
  resetCallbackForTests()
  completeSignIn.mockReset()
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('the Bluesky callback runs once per page load (spec 12.2)', () => {
  it('two elements on one load: one initCallback, one stored session, one navigation home', async () => {
    completeSignIn.mockResolvedValue({ did: DID, handle: 'alice.example.com', pds: 'https://pds.example.test', profile: null })
    const replace = vi.spyOn(location, 'replace').mockImplementation(() => {})
    for (let i = 0; i < 2; i++) document.body.append(document.createElement('caribou-bluesky-callback'))
    await vi.waitFor(() => expect(replace).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(completeSignIn).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/home')
    expect(users.value.get(`${DID}@bsky`)).toMatchObject({ network: 'bluesky', did: DID, handle: 'alice.example.com' })
    expect(activeUserKey.value).toBe(`${DID}@bsky`)
  })

  it('isKnown names the stored Bluesky accounts', async () => {
    addUserSession({ network: 'bluesky', userKey: `${BOB}@bsky`, did: BOB, handle: 'bob.example.com', pds: 'https://pds.example.test', account: null, createdAt: 1 })
    // Asked while the callback runs, before anything is added.
    let seen: boolean[] = []
    completeSignIn.mockImplementation(async (_oauth: unknown, opts: { isKnown(did: string): boolean }) => {
      seen = [opts.isKnown(BOB), opts.isKnown(DID)]
      return { did: DID, handle: 'alice.example.com', pds: 'https://pds.example.test', profile: null }
    })
    vi.spyOn(location, 'replace').mockImplementation(() => {})
    document.body.append(document.createElement('caribou-bluesky-callback'))
    await vi.waitFor(() => expect(completeSignIn).toHaveBeenCalled())
    expect(seen).toEqual([true, false])
  })

  it('a mismatch that kept a stored account: renews it, adds nothing, says so', async () => {
    addUserSession({ network: 'bluesky', userKey: `${BOB}@bsky`, did: BOB, handle: 'bob.example.com', pds: 'https://pds.example.test', account: null, createdAt: 1, generation: 'OLD' })
    users.value = new Map(users.value).set(`${BOB}@bsky`, { ...users.value.get(`${BOB}@bsky`)!, expired: true })
    completeSignIn.mockRejectedValue(new SignInMismatch(DID, BOB, true))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = document.createElement('caribou-bluesky-callback')
    document.body.append(el)
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeTruthy())
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain('an account you already use here')
    expect([...users.value.keys()]).toEqual([`${BOB}@bsky`])
    expect(users.value.get(`${BOB}@bsky`)!.generation).not.toBe('OLD')
    expect(users.value.get(`${BOB}@bsky`)!.expired).toBeUndefined()
  })

  it('a callback with no parameters: the link was used or expired', async () => {
    completeSignIn.mockRejectedValue(new NoCallbackParams())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = document.createElement('caribou-bluesky-callback')
    document.body.append(el)
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain('already used or has expired'))
  })

  it('a failed run stores nothing', async () => {
    completeSignIn.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = document.createElement('caribou-bluesky-callback')
    document.body.append(el)
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeTruthy())
    expect(users.value.size).toBe(0)
  })
})
