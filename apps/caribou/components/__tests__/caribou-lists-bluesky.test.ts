import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import type * as ConfirmModule from '../caribou-confirm-dialog.js'
import type { Account } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import { createBlueskyClient, type BlueskyAgent } from '@beatzball/caribou-bluesky-client/browser'
import {
  accountListsCache, activeClient, activeUserKey, addUserSession, listMembersCache, listsCache, users,
} from '@beatzball/caribou-state'
import '../caribou-lists.js'
import '../caribou-list-header.js'
import type { CaribouLists } from '../caribou-lists.js'
import type { CaribouListHeader } from '../caribou-list-header.js'
import { listDialog, type CaribouListDialog } from '../caribou-list-dialog.js'
import { openListPicker, type CaribouListPicker } from '../caribou-list-picker.js'
import { newListFlow } from '../_list-flows.js'
import { blueskyClients } from './_bluesky-clients.js'
import {
  ALICE, BOB, BSKY_LABELER, READER_DID, READER_KEY, fakeAgent, label, moderationSource, readerOf, signInBluesky,
  type ModerationOptions,
} from './_bluesky-helpers.js'
import { _testOnlyVeilLoaded, setBlueskyReader } from '../_bluesky-moderation.js'
import { confirmDialog } from '../caribou-confirm-dialog.js'

// Bluesky lists (#195; app README, "Bluesky lists"). The real client over
// an in-memory PDS, the real moderation, the real screens.

vi.mock('../caribou-confirm-dialog.js', async (importOriginal) => {
  const real = await importOriginal<typeof ConfirmModule>()
  return { ...real, confirmDialog: vi.fn(async () => false) }
})

vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  const { blueskyClients: made } = await import('./_bluesky-clients.js')
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) =>
      (made.get(args[0]) as ReturnType<typeof real.createCaribouClient> | undefined) ?? real.createCaribouClient(...args),
  }
})

const LIST = 'app.bsky.graph.list'
const ITEM = 'app.bsky.graph.listitem'
const CURATE = 'app.bsky.graph.defs#curatelist'
const FRIENDS = '3lfriendsaaa2'
const GONE = 'did:plc:gone'
const PUBLIC_NOTE = 'Bluesky lists are public. Anyone can see the list\'s name and who is in it.'

function pds() {
  const repo = new Map<string, Map<string, { uri: string; cid: string; value: Record<string, unknown> }>>()
  const coll = (c: string) => repo.get(c) ?? repo.set(c, new Map()).get(c)!
  let n = 0
  const put = (c: string, rkey: string, value: Record<string, unknown>) =>
    coll(c).set(rkey, { uri: `at://${READER_DID}/${c}/${rkey}`, cid: `bafy${++n}`, value })
  put(LIST, FRIENDS, { $type: LIST, name: 'Friends', purpose: CURATE, createdAt: 'x' })
  const api = {
    listRecords: vi.fn(async (q: { collection: string }) => ({ data: { records: [...coll(q.collection).values()] } })),
    getRecord: vi.fn(async (q: { collection: string; rkey: string }) => {
      const r = coll(q.collection).get(q.rkey)
      if (!r) throw Object.assign(new Error('Could not locate record'), { status: 400, error: 'RecordNotFound' })
      return { data: r }
    }),
    createRecord: vi.fn(async (q: { collection: string; rkey: string; record: Record<string, unknown> }) => {
      put(q.collection, q.rkey, q.record)
      return { data: { uri: `at://${READER_DID}/${q.collection}/${q.rkey}`, cid: 'bafynew' } }
    }),
    putRecord: vi.fn(async (q: { collection: string; rkey: string; record: Record<string, unknown> }) => {
      put(q.collection, q.rkey, q.record)
      return { data: { uri: '', cid: '' } }
    }),
    applyWrites: vi.fn(async (q: { writes: { collection: string; rkey: string }[] }) => {
      for (const w of q.writes) coll(w.collection).delete(w.rkey)
      return { data: {} }
    }),
  }
  return { api, put, coll }
}

function profile(did: string, handle: string, labels: unknown[] = []) {
  return { did, handle, displayName: `${handle.split('.')[0]!.toUpperCase()} name`, avatar: `https://cdn.example/${handle}.jpg`, labels, viewer: {} }
}

let store: ReturnType<typeof pds>
let rkeys: string[]

function signInBlueskyLists(mod: ModerationOptions = {}) {
  store = pds()
  rkeys = ['3lnewlistaaa2', '3lnewitemaaa2']
  const agent = fakeAgent({
    getProfiles: vi.fn(async ({ actors }: { actors: string[] }) => ({
      data: {
        profiles: actors.filter((a) => a !== GONE).map((a) => a === ALICE
          // A label that hides the account in lists, from Bluesky's labeler.
          ? profile(a, 'alice.example.com', [label('!hide', BSKY_LABELER, a)])
          : profile(a, 'bob.example.com')),
      },
      headers: { 'atproto-content-labelers': BSKY_LABELER },
    })),
    com: { atproto: { repo: store.api } },
  })
  const client = createBlueskyClient({
    userKey: READER_KEY,
    agent: agent as unknown as BlueskyAgent,
    moderation: moderationSource(mod) as never,
    compose: { nextRkey: () => rkeys.shift()!, detectFacets: async () => [] },
  })
  signInBluesky(client)
  return client
}

function signInMastodon() {
  addUserSession({
    userKey: toUserKey('alice', 'example.social'), server: 'example.social', token: 't', vapidKey: '', createdAt: 0,
    account: { id: 'me', acct: 'alice', username: 'alice' } as Account,
  })
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))
async function settle(el: Element & { updateComplete: Promise<boolean> }) {
  for (let i = 0; i < 6; i++) {
    await flush()
    while (!(await el.updateComplete)) { /* settle */ }
  }
}
async function mount<T extends HTMLElement & { updateComplete: Promise<boolean> }>(tag: string, set?: (el: T) => void): Promise<T> {
  const el = document.createElement(tag) as T
  set?.(el)
  document.body.appendChild(el)
  await settle(el)
  return el
}
async function dialogOf<T extends HTMLElement & { updateComplete: Promise<boolean> }>(tag: string): Promise<T> {
  await flush()
  const el = document.querySelector(tag) as T
  await el.updateComplete
  return el
}
const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)
const $$ = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)]

let toasts: string[]
const onToast = (e: Event) => toasts.push((e as CustomEvent<{ message: string }>).detail.message)

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  document.body.replaceChildren()
  users.value = new Map()
  activeUserKey.value = null
  blueskyClients.clear()
  listsCache.value = new Map()
  listMembersCache.value = new Map()
  accountListsCache.value = new Map()
  localStorage.clear()
  toasts = []
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  document.body.replaceChildren()
})

describe('the list dialog on Bluesky', () => {
  it('says lists are public, tied to the title, and asks for the title only', async () => {
    signInBlueskyLists()
    void listDialog({ title: 'New list', submitLabel: 'Create', exclusive: false, network: 'bluesky' })
    const el = await dialogOf<CaribouListDialog>('caribou-list-dialog')
    const note = $(el, '#public-note')!
    expect(note.textContent!.trim()).toBe(PUBLIC_NOTE)
    expect($(el, '#title')!.getAttribute('aria-describedby')).toContain('public-note')
    expect($(el, 'input[name="policy"]')).toBeNull()
    expect($(el, '#exclusive')).toBeNull()
    el.cancel()
  })

  it('a title over 64 bytes is refused with a reason, and nothing is sent', async () => {
    signInBlueskyLists()
    const answer = listDialog({ title: 'New list', submitLabel: 'Create', exclusive: false, network: 'bluesky' })
    const el = await dialogOf<CaribouListDialog>('caribou-list-dialog')
    const input = $(el, '#title') as HTMLInputElement
    input.value = '🌷'.repeat(17)
    input.dispatchEvent(new Event('input'))
    $(el, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await el.updateComplete
    expect($(el, '#title-error')!.textContent).toBe('This title is too long for Bluesky.')
    input.value = '🌷'.repeat(16)
    input.dispatchEvent(new Event('input'))
    $(el, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(await answer).toEqual({ title: '🌷'.repeat(16) })
  })

  it('a Mastodon account sees no public note and keeps the replies policy', async () => {
    signInMastodon()
    void listDialog({ title: 'New list', submitLabel: 'Create', exclusive: false, network: 'mastodon' })
    const el = await dialogOf<CaribouListDialog>('caribou-list-dialog')
    expect($(el, '#public-note')).toBeNull()
    expect($$(el, 'input[name="policy"]')).toHaveLength(3)
    el.cancel()
  })

  it('New list through the flow writes one curate list record', async () => {
    signInBlueskyLists()
    const made = newListFlow([])
    const el = await dialogOf<CaribouListDialog>('caribou-list-dialog')
    expect($(el, '#public-note')).not.toBeNull()
    const input = $(el, '#title') as HTMLInputElement
    input.value = 'Cats'
    input.dispatchEvent(new Event('input'))
    $(el, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(await made).toMatchObject({ id: '3lnewlistaaa2', title: 'Cats' })
    expect(store.api.createRecord).toHaveBeenCalledTimes(1)
    expect(store.coll(LIST).get('3lnewlistaaa2')!.value).toMatchObject({ name: 'Cats', purpose: CURATE })
  })
})

describe('<caribou-lists> on Bluesky', () => {
  it('lists the curate lists and says lists are public when there are none', async () => {
    signInBlueskyLists()
    const el = await mount<CaribouLists>('caribou-lists')
    expect($$(el, 'a.title').map((a) => a.textContent)).toEqual(['Friends'])
    store.coll(LIST).clear()
    listsCache.value = new Map()
    const empty = await mount<CaribouLists>('caribou-lists')
    expect($(empty, '.notice')!.textContent).toContain('Bluesky lists are public.')
  })
})

describe('<caribou-list-header> on Bluesky', () => {
  it('member rows go through moderation; a member with no decision is covered; Remove always shows', async () => {
    signInBlueskyLists()
    store.put(ITEM, '3litembobaaa2', { subject: BOB, list: `at://${READER_DID}/${LIST}/${FRIENDS}`, createdAt: 'x' })
    store.put(ITEM, '3litemalice22', { subject: ALICE, list: `at://${READER_DID}/${LIST}/${FRIENDS}`, createdAt: 'x' })
    store.put(ITEM, '3litemgone222', { subject: GONE, list: `at://${READER_DID}/${LIST}/${FRIENDS}`, createdAt: 'x' })
    const el = await mount<CaribouListHeader>('caribou-list-header', (h) => { h.list = FRIENDS })
    $(el, 'button.members')!.click()
    await settle(el)
    await _testOnlyVeilLoaded()
    await settle(el)
    const row = (id: string) => $(el, `li[data-account-id="${id}"]`)!
    // Clean: name and avatar.
    expect(row(BOB).textContent).toContain('BOB name')
    expect(row(BOB).querySelector('img')).not.toBeNull()
    // Labeled: no name, no avatar; the handle and a note.
    expect(row(ALICE).textContent).not.toContain('ALICE name')
    expect(row(ALICE).querySelector('img')).toBeNull()
    expect(row(ALICE).textContent).toContain('@alice.example.com')
    expect(row(ALICE).textContent).toContain('Content warning')
    // No decision (the AppView did not return it): covered too.
    expect(row(GONE).querySelector('img')).toBeNull()
    expect(row(GONE).textContent).toContain('Content warning')
    for (const id of [BOB, ALICE, GONE]) expect(row(id).querySelector('caribou-button.remove')).not.toBeNull()
    // Bluesky links: the handle, or the DID when the handle is not known.
    expect(row(BOB).querySelector('a.who')!.getAttribute('href')).toBe('/@bob.example.com')
    expect(row(GONE).querySelector('a.who')!.getAttribute('href')).toBe(`/@${GONE}`)
  })

  it('the empty Members panel does not ask for a follow', async () => {
    signInBlueskyLists()
    const el = await mount<CaribouListHeader>('caribou-list-header', (h) => { h.list = FRIENDS })
    $(el, 'button.members')!.click()
    await settle(el)
    expect($(el, '#members .notice')!.textContent).toBe('No one is in this list yet. Open a profile and choose Add to lists.')
  })

  it('Remove deletes the member\'s item record', async () => {
    signInBlueskyLists()
    store.put(ITEM, '3litembobaaa2', { subject: BOB, list: `at://${READER_DID}/${LIST}/${FRIENDS}`, createdAt: 'x' })
    const el = await mount<CaribouListHeader>('caribou-list-header', (h) => { h.list = FRIENDS })
    $(el, 'button.members')!.click()
    await settle(el)
    $(el, `li[data-account-id="${BOB}"] caribou-button.remove`)!.click()
    await settle(el)
    expect(store.coll(ITEM).size).toBe(0)
    expect(toasts.some((t) => t.startsWith('Removed @bob.example.com'))).toBe(true)
  })
})

describe('the list picker on Bluesky', () => {
  it('does not say only followed accounts can join, and adds a member not followed', async () => {
    const client = signInBlueskyLists()
    const bob = await client.fetchListAccounts(FRIENDS).then(() => ({ ...profileAccount(BOB) }))
    const done = openListPicker(bob, false)
    const el = await dialogOf<CaribouListPicker>('caribou-list-picker')
    await settle(el)
    expect($(el, '#hint')).toBeNull()
    const box = $(el, `input[data-list-id="${FRIENDS}"]`) as HTMLInputElement
    expect(box.checked).toBe(false)
    box.checked = true
    box.dispatchEvent(new Event('change'))
    await settle(el)
    expect([...store.coll(ITEM).values()].map((r) => r.value.subject)).toEqual([BOB])
    el.cancel()
    await done
    expect(activeClient.value?.userKey).toBe(READER_KEY)
  })
})

function profileAccount(did: string): Account {
  return {
    id: did, acct: 'bob.example.com', username: 'bob.example.com', displayName: 'BOB name', avatar: '', avatarStatic: '',
    bluesky: { did, handleInvalid: false, labels: [] },
  } as unknown as Account
}

describe('review fix 1', () => {
  async function membersOf(mod: ModerationOptions = {}) {
    signInBlueskyLists(mod)
    store.put(ITEM, '3litembobaaa2', { subject: BOB, list: `at://${READER_DID}/${LIST}/${FRIENDS}`, createdAt: 'x' })
    const el = await mount<CaribouListHeader>('caribou-list-header', (h) => { h.list = FRIENDS })
    $(el, 'button.members')!.click()
    await settle(el)
    await _testOnlyVeilLoaded()
    await settle(el)
    return { el, row: () => $(el, `li[data-account-id="${BOB}"]`)! }
  }
  const covered = (row: HTMLElement) => {
    expect(row.textContent).not.toContain('BOB name')
    expect(row.querySelector('img')).toBeNull()
    expect(row.textContent).toContain('@bob.example.com')
    expect(row.querySelector('caribou-button.remove')).not.toBeNull()
  }

  it('L4: a subscribed labeler missing from an otherwise good answer covers the row', async () => {
    const { row } = await membersOf({ covered: [BSKY_LABELER] })
    covered(row())
  })

  it('L4: a definitions recheck covers a row that was shown', async () => {
    const { el, row } = await membersOf()
    expect(row().textContent).toContain('BOB name')
    setBlueskyReader(readerOf({ defs: null }))
    await settle(el)
    covered(row())
  })

  it('Fable 5: the Bluesky delete confirm does not say the accounts stay followed', async () => {
    signInBlueskyLists()
    const el = await mount<CaribouLists>('caribou-lists')
    $(el, 'caribou-button.delete')!.click()
    await settle(el)
    const asked = vi.mocked(confirmDialog).mock.calls.at(-1)![0]
    expect(asked.message).toBe('The list goes for good.')
  })
})

describe('review fix 2', () => {
  it('a dropped members cache makes an open panel load again, never keep the old rows as current', async () => {
    signInBlueskyLists()
    store.put(ITEM, '3litembobaaa2', { subject: BOB, list: `at://${READER_DID}/${LIST}/${FRIENDS}`, createdAt: 'x' })
    const el = await mount<CaribouListHeader>('caribou-list-header', (h) => { h.list = FRIENDS })
    $(el, 'button.members')!.click()
    await settle(el)
    expect($(el, `li[data-account-id="${BOB}"]`)).not.toBeNull()
    // The server lost Bob meanwhile; a failed re-read dropped the cache.
    store.coll(ITEM).clear()
    const next = new Map(listMembersCache.value)
    next.delete(`${READER_KEY} ${FRIENDS}`)
    listMembersCache.value = next
    await settle(el)
    expect($(el, `li[data-account-id="${BOB}"]`)).toBeNull()
    expect($(el, '#members .notice')!.textContent).toContain('No one is in this list yet.')
  })
})

describe('review fix 3', () => {
  it('an open picker whose memberships drop (unknown add, failed re-read) loads them again', async () => {
    signInBlueskyLists()
    const done = openListPicker(profileAccount(BOB), false)
    const el = await dialogOf<CaribouListPicker>('caribou-list-picker')
    await settle(el)
    const box = () => $(el, `input[data-list-id="${FRIENDS}"]`) as HTMLInputElement | null
    expect(box()).not.toBeNull()
    // The add gets no answer, and its read-back fails: the outcome is unknown.
    store.api.createRecord.mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { status: 503, error: 'Unavailable' }))
    store.api.getRecord.mockImplementation(async (q: { collection: string; rkey: string }) => {
      if (q.collection === ITEM) throw Object.assign(new Error('Unavailable'), { status: 503, error: 'Unavailable' })
      const r = store.coll(q.collection).get(q.rkey)
      if (!r) throw Object.assign(new Error('Could not locate record'), { status: 400, error: 'RecordNotFound' })
      return { data: r }
    })
    // The re-read of the memberships fails once, so the cache is dropped.
    const listRecords = store.api.listRecords.getMockImplementation()!
    let failed = false
    store.api.listRecords.mockImplementation(async (q: { collection: string }) => {
      if (q.collection === ITEM && toasts.length > 0 && !failed) {
        failed = true
        throw Object.assign(new Error('Unavailable'), { status: 503, error: 'Unavailable' })
      }
      return listRecords(q)
    })
    box()!.checked = true
    box()!.dispatchEvent(new Event('change'))
    for (let i = 0; i < 4; i++) await settle(el)
    expect(failed).toBe(true)
    expect(toasts.some((t) => t.startsWith('Could not tell whether @bob.example.com was added'))).toBe(true)
    // Not stuck on "Loading your lists…": the boxes are back, read again.
    expect(el.shadowRoot!.textContent).not.toContain('Loading your lists')
    expect(box()).not.toBeNull()
    el.cancel()
    await done
  })
})
