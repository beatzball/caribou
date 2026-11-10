import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import type { Account } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import { activeClient, activeUserKey, addUserSession, users } from '@beatzball/caribou-state'
import type * as SessionModule from '../_bluesky-session.js'
import { _testOnlyResetBlueskyVeil, setBlueskyReader } from '../_bluesky-moderation.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  READER_KEY, blueskyClient, fakeAgent, mappedPost, post, prefs, quoting, readerOf, signInBluesky,
} from './_bluesky-helpers.js'

// Bluesky muted words (#196; app README, "Bluesky muted words"). The rule
// each test checks is in its name.

vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  const { blueskyClients: made } = await import('./_bluesky-clients.js')
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) =>
      (made.get(args[0]) as ReturnType<typeof real.createCaribouClient> | undefined) ?? real.createCaribouClient(...args),
  }
})

const editActiveMutedWords = vi.fn()
const reloadActiveModeration = vi.fn()
vi.mock('../_bluesky-session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SessionModule>()),
  editActiveMutedWords: (...a: unknown[]) => editActiveMutedWords(...a),
  reloadActiveModeration: (...a: unknown[]) => reloadActiveModeration(...a),
}))

await import('../caribou-muted-words.js')
await import('../caribou-moderation-settings.js')

type Word = { id?: string; value: string; targets: string[]; actorTarget?: string; expiresAt?: string }
const HOUR = 3600_000
const KEPT: Word = { id: 'a', value: 'spoiler', targets: ['content', 'tag'], actorTarget: 'all' }
const TAG: Word = { id: 'b', value: 'finale', targets: ['tag'], actorTarget: 'exclude-following', expiresAt: new Date(Date.now() + 48 * HOUR).toISOString() }
const OLD: Word = { value: 'legacy', targets: ['content'], expiresAt: '2020-01-01T00:00:00.000Z' }

function readWords(words: Word[] | null, key: `${string}@${string}` = READER_KEY) {
  setBlueskyReader({ ...readerOf({ prefs: words ? prefs({ mutedWords: words as never }) : null }), userKey: key })
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))
const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)
const $$ = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)]

async function mount(): Promise<HTMLElement & { updateComplete: Promise<boolean> }> {
  const el = document.createElement('caribou-muted-words') as HTMLElement & { updateComplete: Promise<boolean> }
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function settle(el: { updateComplete: Promise<boolean> }) {
  await flush()
  await el.updateComplete
  await flush()
  await el.updateComplete
}

function button(el: Element, action: string, n = 0): HTMLElement {
  return $$(el, `caribou-button[data-action="${action}"]`)[n]!
}

async function typeWord(el: Element & { updateComplete: Promise<boolean> }, value: string) {
  const input = $(el, 'input[name="value"]') as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
  await el.updateComplete
}

const submit = (el: Element) => ($(el, 'form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }))

let toasts: { kind: string; message: string }[] = []
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  document.body.replaceChildren()
  users.value = new Map()
  activeUserKey.value = READER_KEY
  _testOnlyResetBlueskyVeil()
  editActiveMutedWords.mockReset()
  reloadActiveModeration.mockReset()
  toasts = []
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  vi.restoreAllMocks()
  blueskyClients.clear()
})

describe('<caribou-muted-words>', () => {
  it('rule 2: lists each word with where, who and when it ends; an expired one stays, marked', async () => {
    readWords([KEPT, TAG, OLD])
    const el = await mount()
    const rows = $$(el, 'li.word')
    expect(rows.map((r) => r.querySelector('strong')!.textContent)).toEqual(['spoiler', 'finale', 'legacy'])
    expect(rows[0]!.querySelector('.meta')!.textContent).toBe('Text and tags · Everyone · Forever')
    expect(rows[1]!.querySelector('.meta')!.textContent).toMatch(/^Tags only · People I do not follow · Until /)
    expect(rows[2]!.querySelector('.meta')!.textContent).toBe('Text and tags · Everyone · Expired')
    expect(rows[2]!.querySelector('caribou-button[data-action="remove"]')).not.toBeNull()
  })

  it('rule 2: before the reader loads it says so; failed prefs offer Retry', async () => {
    const el = await mount()
    expect($(el, '.notice')!.textContent).toBe('Loading muted words…')
    readWords(null)
    await el.updateComplete
    expect($(el, '[role="alert"]')!.textContent).toContain('Could not load your muted words.')
    button(el, 'retry').click()
    expect(reloadActiveModeration).toHaveBeenCalledTimes(1)
  })

  it('rule 2: another account’s reader is no reader', async () => {
    readWords([KEPT], 'did:plc:other@bsky')
    const el = await mount()
    expect($$(el, 'li.word')).toEqual([])
    expect($(el, '.notice')!.textContent).toBe('Loading muted words…')
  })

  it('rule 3: an add sends the word, where, how long and who', async () => {
    readWords([])
    const el = await mount()
    editActiveMutedWords.mockResolvedValue({ outcome: 'added', reloadFailed: false })
    await typeWord(el, ' spoiler ')
    ;($(el, 'input[name="targets"][value="tag"]') as HTMLInputElement).click()
    ;($(el, 'input[name="actor"][value="exclude-following"]') as HTMLInputElement).click()
    const duration = $(el, 'select[name="duration"]') as HTMLSelectElement
    duration.value = '7d'
    duration.dispatchEvent(new Event('change'))
    const before = Date.now()
    submit(el)
    await settle(el)
    expect(editActiveMutedWords).toHaveBeenCalledTimes(1)
    const edit = editActiveMutedWords.mock.calls[0]![0] as Record<string, unknown>
    expect(edit).toMatchObject({ kind: 'add', value: 'spoiler', targets: ['tag'], actorTarget: 'exclude-following' })
    const at = Date.parse(edit.expiresAt as string)
    expect(at - before).toBeGreaterThanOrEqual(7 * 24 * HOUR - 1000)
    expect(at - before).toBeLessThanOrEqual(7 * 24 * HOUR + 5000)
    // Done: the field empties, and the result is announced.
    expect(($(el, 'input[name="value"]') as HTMLInputElement).value).toBe('')
    expect($(el, '.announce')!.textContent).toBe('Muted “spoiler”.')
  })

  it('rule 3: the defaults are text and tags, forever, everyone', async () => {
    readWords([])
    const el = await mount()
    editActiveMutedWords.mockResolvedValue({ outcome: 'added', reloadFailed: false })
    await typeWord(el, 'spoiler')
    submit(el)
    await settle(el)
    expect(editActiveMutedWords.mock.calls[0]![0]).toEqual({ kind: 'add', value: 'spoiler', targets: ['content', 'tag'], actorTarget: 'all' })
  })

  it('rule 3: an empty word says so and sends nothing', async () => {
    readWords([])
    const el = await mount()
    await typeWord(el, '   ')
    submit(el)
    await settle(el)
    expect(editActiveMutedWords).not.toHaveBeenCalled()
    expect($(el, 'form [role="alert"]')!.textContent).toBe('Enter a word to mute.')
  })

  it('rule 3: Remove sends the word’s id, or its value when it has none', async () => {
    readWords([KEPT, OLD])
    const el = await mount()
    editActiveMutedWords.mockResolvedValue({ outcome: 'removed', reloadFailed: false })
    button(el, 'remove', 0).click()
    button(el, 'remove', 1).click()
    await settle(el)
    expect(editActiveMutedWords.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'remove', id: 'a', value: 'spoiler' },
      { kind: 'remove', value: 'legacy' },
    ])
  })

  it('rule 4: a second click on a busy button sends nothing', async () => {
    readWords([KEPT])
    const el = await mount()
    let finish!: (v: unknown) => void
    editActiveMutedWords.mockReturnValue(new Promise((r) => { finish = r }))
    button(el, 'remove').click()
    await el.updateComplete
    button(el, 'remove').click()
    await typeWord(el, 'one')
    submit(el)
    submit(el)
    await el.updateComplete
    // One remove, one add.
    expect(editActiveMutedWords).toHaveBeenCalledTimes(2)
    expect((button(el, 'remove') as unknown as { loading: boolean }).loading).toBe(true)
    finish({ outcome: 'removed', reloadFailed: false })
    await settle(el)
  })

  it('rule 5: an answer after an account change is not shown', async () => {
    readWords([KEPT])
    const el = await mount()
    let finish!: (v: unknown) => void
    editActiveMutedWords.mockReturnValue(new Promise((_r, j) => { finish = j }))
    button(el, 'remove').click()
    await el.updateComplete
    activeUserKey.value = 'bob@example.social' as typeof activeUserKey.value
    finish(new Error('offline'))
    await settle(el)
    expect($(el, '[role="alert"]')).toBeNull()
    expect(toasts).toEqual([])
  })

  it('rule 6: a failed write says so, in a line and a toast; the list stays', async () => {
    readWords([KEPT])
    const el = await mount()
    editActiveMutedWords.mockRejectedValue(new Error('offline'))
    button(el, 'remove').click()
    await settle(el)
    expect($(el, '[role="alert"]')!.textContent).toContain('Could not remove “spoiler”.')
    expect(toasts).toEqual([expect.objectContaining({ kind: 'error' })])
    expect($$(el, 'li.word')).toHaveLength(1)
  })

  it('rule 6: a refused word shows the reason, with no toast', async () => {
    readWords([])
    const el = await mount()
    editActiveMutedWords.mockRejectedValue(Object.assign(new Error('Enter a word to mute.'), { name: 'InvalidMutedWord' }))
    await typeWord(el, '#')
    submit(el)
    await settle(el)
    expect($(el, 'form [role="alert"]')!.textContent).toBe('Enter a word to mute.')
    expect(toasts).toEqual([])
  })

  it('rule 6: written, but the load after it failed: says so, with Retry', async () => {
    readWords([KEPT])
    const el = await mount()
    editActiveMutedWords.mockResolvedValue({ outcome: 'removed', reloadFailed: true })
    button(el, 'remove').click()
    await settle(el)
    expect($(el, '[role="alert"]')!.textContent).toContain('Saved, but your settings did not load again.')
    button(el, 'retry').click()
    expect(reloadActiveModeration).toHaveBeenCalled()
  })

  it('rule 6: the list follows the reader, not the click', async () => {
    readWords([KEPT])
    const el = await mount()
    editActiveMutedWords.mockResolvedValue({ outcome: 'removed', reloadFailed: false })
    button(el, 'remove').click()
    await settle(el)
    expect($$(el, 'li.word')).toHaveLength(1)
    readWords([])
    await el.updateComplete
    expect($$(el, 'li.word')).toHaveLength(0)
    expect($(el, '.notice')!.textContent).toBe('You have not muted any words.')
  })
})

describe('<caribou-moderation-settings> with a Bluesky account (rule 1)', () => {
  it('shows muted words in place of the server filters; mutes and blocks stay', async () => {
    const agent = fakeAgent()
    const client = blueskyClient(agent)
    const filters = vi.spyOn(client, 'fetchFilters')
    signInBluesky(client, readerOf({ prefs: prefs({ mutedWords: [KEPT] as never }) }))
    const el = document.createElement('caribou-moderation-settings')
    document.body.appendChild(el)
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete
    await flush()
    const first = el.shadowRoot!.querySelector('section')!
    expect(first.querySelector('h2')!.textContent).toBe('Muted words')
    expect(first.querySelector('caribou-muted-words')).not.toBeNull()
    expect(el.shadowRoot!.querySelector('#filters-h')).toBeNull()
    expect(el.shadowRoot!.querySelector('#mutes-h')).not.toBeNull()
    expect(el.shadowRoot!.querySelector('#blocks-h')).not.toBeNull()
    expect(filters).not.toHaveBeenCalled()
  })

  it('with a Mastodon account the filters section is as before', async () => {
    addUserSession({
      userKey: toUserKey('alice', 'example.social'), server: 'example.social', token: 't', vapidKey: '', createdAt: 0,
      account: { id: 'me', acct: 'alice', username: 'alice' } as Account,
    })
    const client = activeClient.value!
    const filters = vi.spyOn(client, 'fetchFilters').mockResolvedValue([])
    const empty = async () => Object.assign([], { nextCursor: null })
    vi.spyOn(client, 'fetchMutes').mockImplementation(empty)
    vi.spyOn(client, 'fetchBlocks').mockImplementation(empty)
    const el = document.createElement('caribou-moderation-settings')
    document.body.appendChild(el)
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete
    expect(el.shadowRoot!.querySelector('#filters-h')!.textContent).toBe('Filters')
    expect(el.shadowRoot!.querySelector('caribou-muted-words')).toBeNull()
    expect(filters).toHaveBeenCalledTimes(1)
  })
})

describe('muted words apply through the moderation path (bluesky-client rule 2)', () => {
  const words = { prefs: prefs({ mutedWords: [{ value: 'fixture', targets: ['content'], actorTarget: 'all' }] as never }) }

  it('a list card is hidden, the focused view covered', async () => {
    const s = await mappedPost(post(), words)
    expect(s.bluesky!.moderation!.contexts.contentList.filter).toBe(true)
    expect(s.bluesky!.moderation!.contexts.contentView.blur).toBe(true)
  })

  it('a quoted post is judged on its own', async () => {
    const s = await mappedPost(quoting({}), { prefs: prefs({ mutedWords: [{ value: 'quoted', targets: ['content'], actorTarget: 'all' }] as never }) })
    const quoted = (s.quote as { quotedStatus?: { bluesky?: { moderation?: { contexts: { contentList: { filter: boolean } } } } } }).quotedStatus
    expect(quoted?.bluesky?.moderation?.contexts.contentList.filter).toBe(true)
  })

  it('an expired word does not mute', async () => {
    const s = await mappedPost(post(), { prefs: prefs({ mutedWords: [{ value: 'fixture', targets: ['content'], actorTarget: 'all', expiresAt: '2020-01-01T00:00:00.000Z' }] as never }) })
    expect(s.bluesky!.moderation!.contexts.contentList.filter).toBe(false)
  })
})
