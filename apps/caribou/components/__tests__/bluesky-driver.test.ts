import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, addUserSession, users, type BlueskySession } from '@beatzball/caribou-state'
import type * as BlueskyModule from '../_bluesky.js'

// The session glue feeds #184's moderation seams (`_bluesky-moderation.ts`):
// the reader signal, and the Retry event that loads definitions again.

const DID = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const KEY = `${DID}@bsky` as const
const reloadModeration = vi.fn()
const recheckLabelers = vi.fn()
const fetchStatus = vi.fn(async (id: string) => ({ id }))
const restoreClient = vi.fn()

vi.mock('../_bluesky.js', async (importOriginal) => ({
  ...(await importOriginal<typeof BlueskyModule>()),
  loadBluesky: vi.fn(async () => ({
    loadOAuthClient: async () => ({}),
    restoreClient,
    SessionGone: class extends Error {},
    normalizeXrpcError: (e: unknown) => e,
  })),
}))

const { blueskyDriver, installBlueskyDriver, LABELER_RECHECK_MS, FOREGROUND_RECHECK_MIN_MS } = await import('../_bluesky-session.js')
const { blueskyReader, BLUESKY_RETRY_EVENT } = await import('../_bluesky-moderation.js')

function bsky(): BlueskySession {
  return { network: 'bluesky', userKey: KEY, did: DID, handle: 'alice.example.com', pds: 'https://pds.example.test', generation: 'G1', account: null, createdAt: 1 }
}

const hooks = { onExpired: () => {} }

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  blueskyReader.value = null
  reloadModeration.mockReset()
  recheckLabelers.mockReset()
  recheckLabelers.mockResolvedValue({ prefs: null, labelDefs: {} })
  fetchStatus.mockClear()
  restoreClient.mockReset()
  restoreClient.mockImplementation(async () => ({
    client: { userKey: KEY, capabilities: { network: 'bluesky' }, timelineOrder: () => null, fetchStatus },
    prefs: null, labelDefs: null, reloadModeration, recheckLabelers,
  }))
  installBlueskyDriver()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the session glue and the moderation seams', () => {
  it('a restore of the active account sets the one reader signal, keyed by its sign-in', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    expect(restoreClient.mock.calls[0]![2]).toMatchObject({ userKey: KEY, key: 'G1' })
    expect(blueskyReader.value).toEqual({ userKey: KEY, prefs: null, labelDefs: null })
  })

  it('Retry loads the definitions again, sets the reader, and a refetch waits for it', async () => {
    addUserSession(bsky())
    const client = await blueskyDriver.restore(bsky(), hooks)
    let finish!: (v: unknown) => void
    reloadModeration.mockReturnValue(new Promise((r) => { finish = r }))
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: 'x' } }))
    // A second Retry while one runs does not start another.
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: 'y' } }))
    expect(reloadModeration).toHaveBeenCalledTimes(1)
    const refetch = client.fetchStatus('x')
    await Promise.resolve()
    expect(fetchStatus).not.toHaveBeenCalled()
    finish({ prefs: { adultContentEnabled: false }, labelDefs: {} })
    await refetch
    expect(fetchStatus).toHaveBeenCalledWith('x')
    expect(blueskyReader.value).toEqual({ userKey: KEY, prefs: { adultContentEnabled: false }, labelDefs: {} })
  })

  it('a failed reload leaves the reader as it was and lets the refetch go on', async () => {
    addUserSession(bsky())
    const client = await blueskyDriver.restore(bsky(), hooks)
    reloadModeration.mockRejectedValue(new Error('offline'))
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: 'x' } }))
    await client.fetchStatus('x')
    expect(blueskyReader.value).toEqual({ userKey: KEY, prefs: null, labelDefs: null })
  })

  it('Retry with no Bluesky account active does nothing; a switch away clears the reader', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    activeUserKey.value = null
    expect(blueskyReader.value).toBeNull()
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: 'x' } }))
    expect(reloadModeration).not.toHaveBeenCalled()
  })
})

// A labeler taken down after its definitions loaded (#233): the definitions
// are checked again every 10 minutes while visible and on a return to the
// foreground (bluesky-client README, "Labeler coverage").
describe('the labeler definitions are checked again', () => {
  let state: DocumentVisibilityState = 'visible'
  const setVisibility = (v: DocumentVisibilityState) => {
    state = v
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    state = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
    vi.useFakeTimers()
    // Installed again under fake timers; it replaces the earlier schedule.
    installBlueskyDriver()
  })

  it('every 10 minutes while visible, and the reader follows', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    await vi.advanceTimersByTimeAsync(LABELER_RECHECK_MS - 1)
    expect(recheckLabelers).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(recheckLabelers).toHaveBeenCalledTimes(1)
    expect(blueskyReader.value).toEqual({ userKey: KEY, prefs: null, labelDefs: {} })
    // Hidden: no check.
    state = 'hidden'
    await vi.advanceTimersByTimeAsync(LABELER_RECHECK_MS)
    expect(recheckLabelers).toHaveBeenCalledTimes(1)
  })

  it('on a return to the foreground, unless a check ran in the last minute', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    setVisibility('hidden')
    setVisibility('visible')
    // The restore just loaded them.
    expect(recheckLabelers).not.toHaveBeenCalled()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(FOREGROUND_RECHECK_MIN_MS)
    setVisibility('visible')
    expect(recheckLabelers).toHaveBeenCalledTimes(1)
  })

  it('not while a reload runs, and not for an account that is no longer active', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    reloadModeration.mockReturnValue(new Promise(() => {}))
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: 'x' } }))
    await vi.advanceTimersByTimeAsync(LABELER_RECHECK_MS)
    expect(recheckLabelers).not.toHaveBeenCalled()
    activeUserKey.value = null
    await vi.advanceTimersByTimeAsync(LABELER_RECHECK_MS)
    expect(recheckLabelers).not.toHaveBeenCalled()
  })

  it('a failed check leaves the reader as it was', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    recheckLabelers.mockRejectedValue(new Error('offline'))
    await vi.advanceTimersByTimeAsync(LABELER_RECHECK_MS)
    expect(recheckLabelers).toHaveBeenCalledTimes(1)
    expect(blueskyReader.value).toEqual({ userKey: KEY, prefs: null, labelDefs: null })
  })
})
