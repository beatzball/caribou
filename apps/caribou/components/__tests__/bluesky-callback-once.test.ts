import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { users, activeUserKey } from '@beatzball/caribou-state'
import type * as BlueskyModule from '../_bluesky.js'

const DID = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const completeSignIn = vi.fn()

vi.mock('../_bluesky.js', async (importOriginal) => ({
  ...(await importOriginal<typeof BlueskyModule>()),
  loadBluesky: vi.fn(async () => ({
    loadOAuthClient: async () => ({}),
    completeSignIn,
    StorageUnavailable: class extends Error {},
    InvalidSignInInput: class extends Error {},
    SignInMismatch: class extends Error {},
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

  it('a failed run stores nothing', async () => {
    completeSignIn.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = document.createElement('caribou-bluesky-callback')
    document.body.append(el)
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeTruthy())
    expect(users.value.size).toBe(0)
  })
})
