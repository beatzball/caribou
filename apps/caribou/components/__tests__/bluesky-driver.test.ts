import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, addUserSession, createKeepAlive, users, type BlueskySession } from '@beatzball/caribou-state'
import type * as BlueskyModule from '../_bluesky.js'

// The session glue feeds #184's moderation seams (`_bluesky-moderation.ts`):
// the reader signal, and the Retry event that loads definitions again.

const DID = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const KEY = `${DID}@bsky` as const
const reloadModeration = vi.fn()
const recheckLabelers = vi.fn()
const removeGoneLabeler = vi.fn()
const editMutedWords = vi.fn()
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

const { blueskyDriver, editActiveMutedWords, installBlueskyDriver, removeActiveGoneLabeler, LABELER_RECHECK_MS, FOREGROUND_RECHECK_MIN_MS } = await import('../_bluesky-session.js')
const { blueskyGoneLabelers, blueskyReader, BLUESKY_RETRY_EVENT } = await import('../_bluesky-moderation.js')

function bsky(): BlueskySession {
  return { network: 'bluesky', userKey: KEY, did: DID, handle: 'alice.example.com', pds: 'https://pds.example.test', generation: 'G1', account: null, createdAt: 1 }
}

const hooks = { onExpired: () => {} }

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  blueskyReader.value = null
  blueskyGoneLabelers.value = null
  removeGoneLabeler.mockReset()
  editMutedWords.mockReset()
  reloadModeration.mockReset()
  recheckLabelers.mockReset()
  recheckLabelers.mockResolvedValue({ prefs: null, labelDefs: {} })
  fetchStatus.mockClear()
  restoreClient.mockReset()
  restoreClient.mockImplementation(async () => ({
    client: { userKey: KEY, capabilities: { network: 'bluesky' }, timelineOrder: () => null, fetchStatus },
    prefs: null, labelDefs: null, gone: [], reloadModeration, recheckLabelers, removeGoneLabeler, editMutedWords,
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

  it('not while a reload runs', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    reloadModeration.mockReturnValue(new Promise(() => {}))
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: 'x' } }))
    await vi.advanceTimersByTimeAsync(LABELER_RECHECK_MS)
    expect(recheckLabelers).not.toHaveBeenCalled()
  })

  // No reload runs, so the check reaches the account guard.
  it('not for an account that is no longer active', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    activeUserKey.value = null
    await vi.advanceTimersByTimeAsync(LABELER_RECHECK_MS)
    expect(recheckLabelers).not.toHaveBeenCalled()
  })

  it('a Retry counts as a check: a return to the foreground just after it does not check', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    reloadModeration.mockResolvedValue({ prefs: null, labelDefs: {} })
    await vi.advanceTimersByTimeAsync(2 * FOREGROUND_RECHECK_MIN_MS)
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: 'x' } }))
    await vi.advanceTimersByTimeAsync(0)
    setVisibility('hidden')
    setVisibility('visible')
    expect(recheckLabelers).not.toHaveBeenCalled()
  })

  it('a timed check counts as a check: a return to the foreground just after it does not check again', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    await vi.advanceTimersByTimeAsync(LABELER_RECHECK_MS)
    expect(recheckLabelers).toHaveBeenCalledTimes(1)
    setVisibility('hidden')
    setVisibility('visible')
    expect(recheckLabelers).toHaveBeenCalledTimes(1)
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

// A gone labeler (#238; app README, "A gone labeler").
describe('a gone labeler', () => {
  const GONE = 'did:plc:gonelabeleraaaaaaaaaaaaa'

  it('a restore names the gone labelers for the active account; a switch away clears them', async () => {
    restoreClient.mockImplementation(async () => ({
      client: { userKey: KEY, capabilities: { network: 'bluesky' }, timelineOrder: () => null, fetchStatus },
      prefs: null, labelDefs: {}, gone: [GONE], reloadModeration, recheckLabelers, removeGoneLabeler,
    }))
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    expect(blueskyGoneLabelers.value).toEqual({ userKey: KEY, dids: [GONE] })
    activeUserKey.value = null
    expect(blueskyGoneLabelers.value).toBeNull()
  })

  it('a removal runs once per DID and sets the reader from its answer', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    let finish!: (v: unknown) => void
    removeGoneLabeler.mockReturnValue(new Promise((r) => { finish = r }))
    const a = removeActiveGoneLabeler(GONE)
    const b = removeActiveGoneLabeler(GONE)
    expect(b).toBe(a)
    expect(removeGoneLabeler).toHaveBeenCalledTimes(1)
    expect(removeGoneLabeler).toHaveBeenCalledWith(GONE)
    finish({ prefs: { labelers: [] }, labelDefs: { x: [] }, gone: [], outcome: 'removed' })
    expect(await a).toBe('removed')
    expect(blueskyReader.value).toEqual({ userKey: KEY, prefs: { labelers: [] }, labelDefs: { x: [] } })
    expect(blueskyGoneLabelers.value).toEqual({ userKey: KEY, dids: [] })
  })

  it('an answer that lands after a switch to another account changes nothing on screen', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    let finish!: (v: unknown) => void
    removeGoneLabeler.mockReturnValue(new Promise((r) => { finish = r }))
    const a = removeActiveGoneLabeler(GONE)
    activeUserKey.value = 'bob@example.social' as typeof activeUserKey.value
    finish({ prefs: null, labelDefs: {}, gone: [], outcome: 'removed' })
    expect(await a).toBe('stale')
    expect(blueskyReader.value).toBeNull()
    expect(blueskyGoneLabelers.value).toBeNull()
  })

  it('switch away and back before the answer: the answer is dropped and the reader loads again', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    let finish!: (v: unknown) => void
    removeGoneLabeler.mockReturnValue(new Promise((r) => { finish = r }))
    const a = removeActiveGoneLabeler(GONE)
    activeUserKey.value = null
    activeUserKey.value = KEY
    await blueskyDriver.restore(bsky(), hooks)
    reloadModeration.mockResolvedValue({ prefs: null, labelDefs: {}, gone: [] })
    finish({ prefs: null, labelDefs: {}, gone: [], outcome: 'removed' })
    expect(await a).toBe('stale')
    expect(reloadModeration).toHaveBeenCalledTimes(1)
  })

  it('switch back while a reload runs: the recovery is queued after it, and its answer is the last one shown (#253)', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    let finish!: (v: unknown) => void
    removeGoneLabeler.mockReturnValue(new Promise((r) => { finish = r }))
    const a = removeActiveGoneLabeler(GONE)
    activeUserKey.value = null
    activeUserKey.value = KEY
    await blueskyDriver.restore(bsky(), hooks)
    // A Retry starts a reload; it read the prefs before the write landed.
    let oldLoad!: (v: unknown) => void
    reloadModeration.mockReturnValueOnce(new Promise((r) => { oldLoad = r }))
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: 'x' } }))
    expect(reloadModeration).toHaveBeenCalledTimes(1)
    const fresh = { prefs: { labelers: [] }, labelDefs: { f: [] }, gone: [] }
    reloadModeration.mockResolvedValue(fresh)
    finish({ prefs: null, labelDefs: {}, gone: [], outcome: 'removed' })
    expect(await a).toBe('stale')
    // Not started yet: the running reload has not ended.
    expect(reloadModeration).toHaveBeenCalledTimes(1)
    oldLoad({ prefs: { labelers: [{ did: GONE }] }, labelDefs: {}, gone: [GONE] })
    await vi.waitFor(() => expect(reloadModeration).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(blueskyReader.value).toEqual({ userKey: KEY, prefs: fresh.prefs, labelDefs: fresh.labelDefs }))
    expect(blueskyGoneLabelers.value).toEqual({ userKey: KEY, dids: [] })
    expect(reloadModeration).toHaveBeenCalledTimes(2)
  })

  it('switch back while the restore is pending: that restore reloads once when it finishes', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    let finish!: (v: unknown) => void
    removeGoneLabeler.mockReturnValue(new Promise((r) => { finish = r }))
    const a = removeActiveGoneLabeler(GONE)
    activeUserKey.value = null
    activeUserKey.value = KEY
    // The new restore is still in flight when the answer lands.
    const impl = restoreClient.getMockImplementation()!
    let restored!: () => void
    restoreClient.mockImplementationOnce((...args: unknown[]) =>
      new Promise((r) => { restored = () => r(impl(...args)) }))
    const restoring = blueskyDriver.restore(bsky(), hooks)
    reloadModeration.mockResolvedValue({ prefs: null, labelDefs: {}, gone: [] })
    finish({ prefs: null, labelDefs: {}, gone: [], outcome: 'removed' })
    expect(await a).toBe('stale')
    expect(reloadModeration).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(restored).toBeTypeOf('function'))
    restored()
    await restoring
    expect(reloadModeration).toHaveBeenCalledTimes(1)
    // Only once: a later restore does not reload again.
    await blueskyDriver.restore(bsky(), hooks)
    expect(reloadModeration).toHaveBeenCalledTimes(1)
  })

  it('a failed removal throws and leaves the reader as it was', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    const before = blueskyReader.value
    removeGoneLabeler.mockRejectedValue(new Error('offline'))
    await expect(removeActiveGoneLabeler(GONE)).rejects.toThrow('offline')
    expect(blueskyReader.value).toBe(before)
    // The next try runs again.
    removeGoneLabeler.mockResolvedValue({ prefs: null, labelDefs: {}, gone: [], outcome: 'absent' })
    expect(await removeActiveGoneLabeler(GONE)).toBe('absent')
  })

  it('with no Bluesky account active, nothing is sent', async () => {
    expect(await removeActiveGoneLabeler(GONE)).toBe('stale')
    expect(removeGoneLabeler).not.toHaveBeenCalled()
  })
})

// App README, "Bluesky muted words" (#196).
describe('muted words', () => {
  const ADD = { kind: 'add' as const, value: 'spoiler', targets: ['content' as const], actorTarget: 'all' as const }
  const kept = createKeepAlive<number>(4)

  it('rule 7: a save sets the reader from its answer and empties the kept pages', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    kept.set('page', 1)
    const prefs = { labelers: [], mutedWords: [{ value: 'spoiler', targets: ['content'] }] }
    editMutedWords.mockResolvedValue({ prefs, labelDefs: { x: [] }, gone: [], outcome: 'added', reloadFailed: false })
    expect(await editActiveMutedWords(ADD)).toEqual({ outcome: 'added', reloadFailed: false })
    expect(editMutedWords).toHaveBeenCalledWith(ADD)
    expect(blueskyReader.value).toEqual({ userKey: KEY, prefs, labelDefs: { x: [] } })
    expect(kept.size).toBe(0)
  })

  it('rule 7: nothing written (exists) keeps the kept pages', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    kept.set('page', 1)
    editMutedWords.mockResolvedValue({ prefs: null, labelDefs: {}, gone: [], outcome: 'exists', reloadFailed: false })
    expect((await editActiveMutedWords(ADD)).outcome).toBe('exists')
    expect(kept.size).toBe(1)
  })

  it('rule 6: a write that worked with a failed load after it says so', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    editMutedWords.mockResolvedValue({ prefs: null, labelDefs: {}, gone: [], outcome: 'removed', reloadFailed: true })
    expect(await editActiveMutedWords({ kind: 'remove', value: 'x' })).toEqual({ outcome: 'removed', reloadFailed: true })
    expect(blueskyReader.value).toEqual({ userKey: KEY, prefs: null, labelDefs: {} })
  })

  it('rule 5: an answer that lands after a switch shows nothing; the account reloads when back', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    let finish!: (v: unknown) => void
    editMutedWords.mockReturnValue(new Promise((r) => { finish = r }))
    const a = editActiveMutedWords(ADD)
    activeUserKey.value = 'bob@example.social' as typeof activeUserKey.value
    finish({ prefs: { labelers: [] }, labelDefs: {}, gone: [], outcome: 'added', reloadFailed: false })
    expect((await a).outcome).toBe('stale')
    expect(blueskyReader.value).toBeNull()
    activeUserKey.value = KEY
    reloadModeration.mockResolvedValue({ prefs: null, labelDefs: {}, gone: [] })
    await blueskyDriver.restore(bsky(), hooks)
    expect(reloadModeration).toHaveBeenCalledTimes(1)
  })

  it('rule 7: nothing written, but another app changed the words: the reader and kept pages follow', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    kept.set('page', 1)
    const prefs = { labelers: [], mutedWords: [] }
    editMutedWords.mockResolvedValue({ prefs, labelDefs: {}, gone: [], outcome: 'absent', reloadFailed: false, wordsChanged: true })
    expect((await editActiveMutedWords({ kind: 'remove', value: 'x' })).outcome).toBe('absent')
    expect(blueskyReader.value).toEqual({ userKey: KEY, prefs, labelDefs: {} })
    expect(kept.size).toBe(0)
  })

  it('rule 5: a failure that lands after a switch is not thrown: stale', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    let fail!: (e: unknown) => void
    editMutedWords.mockReturnValue(new Promise((_r, j) => { fail = j }))
    const a = editActiveMutedWords(ADD)
    activeUserKey.value = 'bob@example.social' as typeof activeUserKey.value
    fail(new Error('offline'))
    expect((await a).outcome).toBe('stale')
  })

  it('rule 7: the client’s calls wait for an edit in flight', async () => {
    addUserSession(bsky())
    const client = await blueskyDriver.restore(bsky(), hooks)
    let finish!: (v: unknown) => void
    editMutedWords.mockReturnValue(new Promise((r) => { finish = r }))
    const save = editActiveMutedWords(ADD)
    const read = (client as unknown as { fetchStatus: (id: string) => Promise<unknown> }).fetchStatus('p1')
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchStatus).not.toHaveBeenCalled()
    finish({ prefs: null, labelDefs: {}, gone: [], outcome: 'added', reloadFailed: false, wordsChanged: true })
    await save
    await read
    expect(fetchStatus).toHaveBeenCalledWith('p1')
  })

  it('rule 6: a failed write throws and leaves the reader as it was', async () => {
    addUserSession(bsky())
    await blueskyDriver.restore(bsky(), hooks)
    const before = blueskyReader.value
    editMutedWords.mockRejectedValue(new Error('offline'))
    await expect(editActiveMutedWords(ADD)).rejects.toThrow('offline')
    expect(blueskyReader.value).toBe(before)
  })

  it('rule 5: with no Bluesky account active, nothing is sent', async () => {
    expect((await editActiveMutedWords(ADD)).outcome).toBe('stale')
    expect(editMutedWords).not.toHaveBeenCalled()
  })
})
