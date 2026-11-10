// Bluesky delete and redraft on the card (#190; app README, "Bluesky delete and redraft").
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueskyGates, BlueskyOwnPost, BlueskyPostRecord, Capabilities, CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, blueskyUserKey, deletedStatusIds, findRedraftSlot, getDraftFiles, loadDraft,
  saveDraft, emptyDraft, setBlueskyDriver, statusCache, storedDrafts, users, _testOnlyClearDraftFiles,
  type BlueskyDriver, type DraftSlot, type UserSession,
} from '@beatzball/caribou-state'
import { BLUESKY_CAPABILITIES } from '@beatzball/caribou-bluesky-client'
import '../caribou-status-card.js'

// The canvas re-encode: new bytes, so a new CID.
vi.mock('../_image-fit.js', () => ({
  fitImage: vi.fn(async (b: Blob) => ({ ok: true, blob: new Blob([`re ${await b.text()}`], { type: 'image/jpeg' }), width: 4, height: 3, resized: false })),
}))

// Moderation is not under test here: the reader's check counts as done.
vi.mock('../_bluesky-moderation.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  blueskyDecisionSettled: () => true,
}))
import type { CaribouStatusCard } from '../caribou-status-card.js'
import type { CaribouConfirmDialog } from '../caribou-confirm-dialog.js'

const DID = 'did:plc:reader'
const KEY = blueskyUserKey(DID)
const URI = `at://${DID}/app.bsky.feed.post/3kold`
const PARENT = { uri: 'at://did:plc:bob/app.bsky.feed.post/p1', cid: 'bafyparent' }

const me = { id: DID, acct: 'reader.example.com', username: 'reader.example.com', displayName: 'Reader', avatar: '', avatarStatic: '' }

const CLEAR = {
  contexts: Object.fromEntries(['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView']
    .map((c) => [c, { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }])),
  labelersCovered: [],
}

function post(over: Record<string, unknown> = {}, bsky: Record<string, unknown> = {}): Status {
  return {
    id: URI, uri: URI, url: null, content: '<p>hello</p>', createdAt: '2026-11-01T00:00:00Z', visibility: 'public',
    spoilerText: '', sensitive: false, language: null, inReplyToId: null, editedAt: null, mediaAttachments: [],
    mentions: [], tags: [], emojis: [], account: me,
    favouritesCount: 0, reblogsCount: 0, repliesCount: 0,
    bluesky: {
      uri: URI, cid: 'bafyold', likeUri: null, repostUri: null, replyRef: null, replyDisabled: false,
      embeddingDisabled: false, labels: [], viewerOf: KEY, moderation: CLEAR, ...bsky,
    },
    ...over,
  } as unknown as Status
}

const RECORD = {
  $type: 'app.bsky.feed.post',
  text: 'hello',
  reply: { root: PARENT, parent: PARENT },
  embed: { $type: 'app.bsky.embed.images', images: [{ image: { $type: 'blob', ref: { $link: 'bafkA' }, mimeType: 'image/jpeg', size: 3 }, alt: 'a cat' }] },
  langs: ['en'],
  createdAt: '2026-11-01T00:00:00.000Z',
} as unknown as BlueskyPostRecord

const calls: string[] = []

function fakeClient() {
  const client = {
    userKey: KEY,
    capabilities: BLUESKY_CAPABILITIES,
    timelineOrder: () => null,
    blueskyGetOwnPost: vi.fn(async (rkey: string): Promise<BlueskyOwnPost | null> => {
      calls.push(`read ${rkey}`)
      return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafyold', value: RECORD }
    }),
    blueskyGetBlob: vi.fn(async (cid: string) => {
      calls.push(`blob ${cid}`)
      return new Blob(['abc'], { type: 'image/jpeg' })
    }),
    blueskyDeletePost: vi.fn(async (uri: string) => { calls.push(`delete ${uri}`) }),
    blueskyUploadBlob: vi.fn(async (b: Blob) => {
      calls.push(`upload ${await b.text()}`)
      return { $type: 'blob' as const, ref: { $link: 'bafkNEW' }, mimeType: b.type, size: b.size }
    }),
    blueskyNextRkey: vi.fn(async () => { calls.push('rkey'); return '3knewkey00001' }),
    blueskyGetOwnGates: vi.fn(async (_rkey: string): Promise<BlueskyGates> => ({ replies: null, quotes: true })),
    deleteStatus: vi.fn(async () => { throw new Error('Mastodon only') }),
    fetchStatus: vi.fn(async (id: string) => {
      calls.push(`fetch ${id}`)
      return { ...post(), id, uri: id, account: { ...me, id: 'did:plc:bob' }, bluesky: { ...post().bluesky!, uri: id } } as Status
    }),
    fetchRelationships: vi.fn(async () => []),
    verifyCredentials: vi.fn(() => new Promise(() => {})),
  }
  return client
}

let pds: ReturnType<typeof fakeClient>

function signIn() {
  pds = fakeClient()
  const driver: BlueskyDriver = {
    capabilities: BLUESKY_CAPABILITIES as Readonly<Capabilities>,
    timelineOrder: () => null,
    restore: async () => pds as unknown as CaribouClient,
    signOut: async () => {},
  }
  setBlueskyDriver(driver)
  addUserSession({
    network: 'bluesky', userKey: KEY, did: DID, handle: 'reader.example.com', pds: 'https://pds.example.test',
    account: me, createdAt: 1,
  } as unknown as UserSession)
}

async function settle(el: CaribouStatusCard) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await el.updateComplete
  }
}

async function mount(status: Status): Promise<CaribouStatusCard> {
  statusCache.value = new Map([...statusCache.value, [status.id, status]])
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.setAttribute('filter-context', 'home')
  el.status = status
  document.body.appendChild(el)
  await settle(el)
  // The client restores asynchronously.
  for (let i = 0; i < 20 && !activeClient.value; i++) await settle(el)
  await settle(el)
  return el
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)
const item = (el: Element, action: string) => $(el, `caribou-menu.more button[data-action="${action}"]`)
const confirmEl = () => document.querySelector<CaribouConfirmDialog>('caribou-confirm-dialog')
const confirmText = () => confirmEl()!.shadowRoot!.textContent ?? ''
const confirmYes = () => confirmEl()!.shadowRoot!.querySelector<HTMLElement>('caribou-button.confirm')!.click()

const events: CustomEvent[] = []
const onCompose = (e: Event) => events.push(e as CustomEvent)
const toasts: { kind: string; message: string }[] = []
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(async () => {
  await _testOnlyClearDraftFiles()
  document.body.replaceChildren()
  statusCache.value = new Map()
  deletedStatusIds.value = new Set()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  events.length = 0
  toasts.length = 0
  calls.length = 0
  window.addEventListener('caribou:compose', onCompose)
  window.addEventListener('caribou:toast', onToast)
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => {
  window.removeEventListener('caribou:compose', onCompose)
  window.removeEventListener('caribou:toast', onToast)
  vi.restoreAllMocks()
})

describe('<caribou-status-card> own Bluesky post', () => {
  it('offers Delete and Delete & redraft, and no Edit (Bluesky has none)', async () => {
    signIn()
    const el = await mount(post())
    expect(item(el, 'delete')).not.toBeNull()
    expect(item(el, 'redraft')).not.toBeNull()
    expect(item(el, 'edit')).toBeNull()
  })

  it('Delete asks, then deletes the record by its URI; the post leaves the cache', async () => {
    signIn()
    const el = await mount(post())
    item(el, 'delete')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(pds.blueskyDeletePost).toHaveBeenCalledWith(URI)
    expect(pds.deleteStatus).not.toHaveBeenCalled()
    expect(statusCache.value.has(URI)).toBe(false)
    expect(toasts.at(-1)).toEqual({ kind: 'info', message: 'Post deleted' })
  })

  it('a refused delete brings the post back and says so', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyDeletePost.mockRejectedValueOnce(new Error('500'))
    item(el, 'delete')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(statusCache.value.has(URI)).toBe(true)
    expect(toasts.at(-1)).toEqual({ kind: 'error', message: 'Could not delete this post. Try again.' })
  })

  it('Delete & redraft: read, ask, build and store, then delete, then open the stored draft', async () => {
    signIn()
    const el = await mount(post())
    // The draft is stored before the delete is sent.
    // Staged, where no composer finds it until the delete answers (D1).
    let storedAtDelete: string | null = null
    let foundAtDelete: DraftSlot | null = null
    pds.blueskyDeletePost.mockImplementationOnce(async (uri: string) => {
      calls.push(`delete ${uri}`)
      storedAtDelete = storedDrafts(KEY).find(([slot]) => slot.startsWith('staged:'))?.[1].text ?? null
      foundAtDelete = findRedraftSlot(KEY)
    })
    item(el, 'redraft')!.click()
    await settle(el)
    expect(confirmText()).toContain('Its likes, reposts and replies are lost.')
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    confirmYes()
    await settle(el)
    expect(calls).toEqual(['read 3kold', 'blob bafkA', `fetch ${PARENT.uri}`, 'upload re abc', 'rkey', `delete ${URI}`])
    expect(storedAtDelete).toBe('hello')
    expect(foundAtDelete).toBeNull()
    expect(events).toHaveLength(1)
    const detail = events[0]!.detail as { blueskyRedraft: { userKey: string; slot: DraftSlot } }
    expect(detail.blueskyRedraft.userKey).toBe(KEY)
    // Moved where a new post finds it.
    expect(detail.blueskyRedraft.slot).toMatch(/^redraft:/)
    expect(findRedraftSlot(KEY)).toBe(detail.blueskyRedraft.slot)
    expect(storedDrafts(KEY).map(([slot]) => slot)).toEqual([detail.blueskyRedraft.slot])
    const d = loadDraft(KEY, detail.blueskyRedraft.slot)!
    expect(d.text).toBe('hello')
    expect(d.language).toBe('en')
    expect(d.bluesky!.reply).toEqual({ root: PARENT, parent: PARENT })
    expect(d.bluesky!.rkey).toBe('3knewkey00001')
    expect(d.bluesky!.images.map((i) => [i.alt, i.blob.ref.$link])).toEqual([['a cat', 'bafkNEW']])
    expect(d.bluesky!.source).toBe(URI)
    const files = await getDraftFiles(KEY, detail.blueskyRedraft.slot)
    expect(await files[d.bluesky!.images[0]!.id]!.text()).toBe('re abc')
  })

  it('when no composer opens it (one is open already), the draft stays stored and a toast says where', async () => {
    signIn()
    const el = await mount(post())
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(events).toHaveLength(1)
    expect(findRedraftSlot(KEY)).not.toBeNull()
    expect(toasts.at(-1)).toEqual({ kind: 'info', message: 'Your redraft is saved. It opens the next time you write a new post.' })
  })

  it('a second click while a redraft runs does nothing, and a status line says what it is doing', async () => {
    signIn()
    const el = await mount(post())
    let release!: () => void
    pds.blueskyGetOwnPost.mockImplementationOnce(async (rkey) => {
      await new Promise<void>((r) => { release = r })
      return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafyold', value: RECORD }
    })
    item(el, 'redraft')!.click()
    await settle(el)
    expect($(el, '.redraft-status[role="status"]')!.textContent).toBe('Reading the post…')
    item(el, 'redraft')!.click()
    await settle(el)
    expect(pds.blueskyGetOwnPost).toHaveBeenCalledTimes(1)
    release()
    await settle(el)
    expect($(el, '.redraft-status')!.textContent).toBe('')
  })

  it('the question says what is not kept, and a gone reply target', async () => {
    signIn()
    pds.fetchStatus.mockRejectedValue(Object.assign(new Error('gone'), { code: 'not_found' }))
    const el = await mount(post({ mediaAttachments: [{ id: 'v', type: 'video', url: 'https://x.example/v.m3u8' }], card: { url: 'https://example.com' } }))
    item(el, 'redraft')!.click()
    await settle(el)
    expect(confirmText()).toContain('The video is not kept.')
    expect(confirmText()).toContain('The link card is not kept.')
    expect(confirmText()).toContain('The post it replies to is gone, so the redraft cannot be posted as a reply.')
  })

  it('when the record cannot be read, nothing is deleted or stored, and nothing opens', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyGetOwnPost.mockRejectedValueOnce(new Error('502'))
    item(el, 'redraft')!.click()
    await settle(el)
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(confirmEl()?.shadowRoot?.querySelector('dialog[open]') ?? null).toBeNull()
    expect(events).toEqual([])
    expect(findRedraftSlot(KEY)).toBeNull()
    expect(toasts.at(-1)).toEqual({ kind: 'error', message: 'Could not read this post, so it was not deleted.' })
  })

  it('when an image cannot be uploaded, nothing is deleted or stored, and a toast says why', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyUploadBlob.mockRejectedValueOnce(new Error('Upload refused.'))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(findRedraftSlot(KEY)).toBeNull()
    expect(toasts.at(-1)).toEqual({ kind: 'error', message: 'Could not get the redraft ready, so the post was not deleted: Upload refused' })
  })

  it('when the delete fails, the stored draft and its bytes go, and nothing opens', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyDeletePost.mockRejectedValueOnce(new Error('400'))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(events).toEqual([])
    expect(findRedraftSlot(KEY)).toBeNull()
    expect(statusCache.value.has(URI)).toBe(true)
    expect(toasts.at(-1)).toEqual({ kind: 'error', message: 'Could not delete this post. Try again.' })
  })

  it('a delete in doubt keeps the stored draft and says so, without saying "not deleted"', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyDeletePost.mockRejectedValueOnce(Object.assign(new Error('?'), { name: 'BlueskyDeleteUnknown' }))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(events).toEqual([])
    expect(loadDraft(KEY, findRedraftSlot(KEY)!)!.text).toBe('hello')
    expect(toasts.at(-1)!.message).toBe('Could not tell whether the post was deleted. Your redraft is saved and opens the next time you write a new post. '
      + 'Check your profile first, so it is not posted twice.')
  })

  it('an account switch during the delete: the draft stays stored for that account, nothing opens or is said', async () => {
    signIn()
    const el = await mount(post())
    let release!: () => void
    pds.blueskyDeletePost.mockImplementationOnce(() => new Promise<void>((r) => { release = r }))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    const before = toasts.length
    activeUserKey.value = null
    release()
    await settle(el)
    expect(events).toEqual([])
    expect(toasts.length).toBe(before)
    expect(loadDraft(KEY, findRedraftSlot(KEY)!)!.text).toBe('hello')
  })

  it('an account switch while the record is read deletes nothing', async () => {
    signIn()
    const el = await mount(post())
    let release!: () => void
    pds.blueskyGetOwnPost.mockImplementationOnce(async (rkey) => {
      await new Promise<void>((r) => { release = r })
      return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafyold', value: RECORD }
    })
    item(el, 'redraft')!.click()
    await settle(el)
    activeUserKey.value = null
    release()
    await settle(el)
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
  it('a draft written while the delete runs is not erased when the delete is refused (D1, Codex 1)', async () => {
    signIn()
    const el = await mount(post())
    let refuse!: (e: unknown) => void
    pds.blueskyDeletePost.mockImplementationOnce(() => new Promise<void>((_, rej) => { refuse = rej }))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(pds.blueskyDeletePost).toHaveBeenCalled()
    // A new post opened now does not find the staged redraft: it gets "new".
    expect(findRedraftSlot(KEY)).toBeNull()
    saveDraft(KEY, 'new', emptyDraft({ text: 'written meanwhile' }))
    refuse(new Error('400'))
    await settle(el)
    expect(loadDraft(KEY, 'new')!.text).toBe('written meanwhile')
    expect(storedDrafts(KEY).map(([slot]) => slot)).toEqual(['new'])
    expect(statusCache.value.has(URI)).toBe(true)
  })

  it('a post with no text and only a link card is not deleted: nothing could be kept (D3)', async () => {
    signIn()
    const external = { ...RECORD, text: '', reply: undefined, embed: { $type: 'app.bsky.embed.external', external: { uri: 'https://example.com', title: 't', description: '' } } }
    pds.blueskyGetOwnPost.mockResolvedValue({ uri: URI, cid: 'bafyold', value: external as unknown as BlueskyPostRecord })
    const el = await mount(post())
    item(el, 'redraft')!.click()
    await settle(el)
    expect(confirmEl()?.shadowRoot?.querySelector('dialog[open]') ?? null).toBeNull()
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(storedDrafts(KEY)).toEqual([])
    expect(toasts).toEqual([{ kind: 'info', message: 'Nothing in this post can be kept in a draft. Use Delete.' }])
    expect(statusCache.value.has(URI)).toBe(true)
  })

  it('a post already deleted: "This post is already deleted." and the card goes (N1)', async () => {
    signIn()
    pds.blueskyGetOwnPost.mockResolvedValue(null)
    const el = await mount(post())
    item(el, 'redraft')!.click()
    await settle(el)
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(statusCache.value.has(URI)).toBe(false)
    expect(deletedStatusIds.value.has(URI)).toBe(true)
    expect(toasts).toEqual([{ kind: 'info', message: 'This post is already deleted.' }])
  })

  it('a second redraft after a delete in doubt opens the stored one, with its edits; nothing is read, uploaded or deleted (D4, Fable P15)', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyDeletePost.mockRejectedValueOnce(Object.assign(new Error('?'), { name: 'BlueskyDeleteUnknown' }))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    const first = findRedraftSlot(KEY)!
    // The reader writes more in it and closes it.
    saveDraft(KEY, first, { ...loadDraft(KEY, first)!, text: 'hello, plus what the reader wrote' })
    calls.length = 0
    item(el, 'redraft')!.click()
    await settle(el)
    expect(calls).toEqual([])
    expect(confirmEl()?.shadowRoot?.querySelector('dialog[open]') ?? null).toBeNull()
    expect(storedDrafts(KEY).map(([slot]) => slot)).toEqual([first])
    expect(loadDraft(KEY, first)!.text).toBe('hello, plus what the reader wrote')
    expect((events.at(-1)!.detail as { blueskyRedraft: { slot: DraftSlot } }).blueskyRedraft.slot).toBe(first)
    expect(toasts.at(-1)).toEqual({ kind: 'info', message: 'You already have a redraft of this post. It opens the next time you write a new post. The post was not deleted. If it is still up, use Delete.' })
  })

  it('the stored redraft opens when a composer can: the toast says so (R4-N2, R4-N4)', async () => {
    signIn()
    const kept = emptyDraft({ text: 'kept', bluesky: { reply: null, quote: null, labels: [], images: [], rkey: 'k', sent: null, source: URI } })
    saveDraft(KEY, `redraft:${kept.idempotencyKey}`, kept)
    // A composer that opens it.
    const opens = (e: Event) => { (e as CustomEvent<{ opened?: boolean }>).detail.opened = true }
    window.addEventListener('caribou:compose', opens)
    try {
      const el = await mount(post())
      item(el, 'redraft')!.click()
      await settle(el)
    } finally {
      window.removeEventListener('caribou:compose', opens)
    }
    expect(pds.blueskyGetOwnPost).not.toHaveBeenCalled()
    expect(toasts.at(-1)).toEqual({ kind: 'info', message: 'You already have a redraft of this post, so it opens. The post was not deleted. If it is still up, use Delete.' })
  })

  it('a switch during the upload: no delete (R3-N4)', async () => {
    signIn()
    const el = await mount(post())
    let release!: () => void
    pds.blueskyUploadBlob.mockImplementationOnce(async (b: Blob) => {
      await new Promise<void>((r) => { release = r })
      return { $type: 'blob' as const, ref: { $link: 'bafkNEW' }, mimeType: b.type, size: b.size }
    })
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(pds.blueskyUploadBlob).toHaveBeenCalled()
    activeUserKey.value = null
    release()
    await settle(el)
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(storedDrafts(KEY)).toEqual([])
  })

  it('plain Delete removes no draft, staged or not (rule E)', async () => {
    signIn()
    const left = emptyDraft({ text: 'left behind', bluesky: { reply: null, quote: null, labels: [], images: [], rkey: 'x', sent: null, source: URI, stagedAt: Date.now() } })
    saveDraft(KEY, `staged:${left.idempotencyKey}`, left)
    const shown = emptyDraft({ text: 'shown and edited', bluesky: { reply: null, quote: null, labels: [], images: [], rkey: 'y', sent: null, source: URI, exposed: true } })
    saveDraft(KEY, `staged:${shown.idempotencyKey}`, shown)
    const el = await mount(post())
    item(el, 'delete')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(pds.blueskyDeletePost).toHaveBeenCalledWith(URI)
    expect(storedDrafts(KEY).map(([, d]) => d.text).sort()).toEqual(['left behind', 'shown and edited'])
  })

  // #262: a failed limits read says so; the post is not deleted.
  it('when the limits cannot be read, nothing is deleted, and the toast says why', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyGetOwnGates.mockRejectedValueOnce(new Error('502'))
    item(el, 'redraft')!.click()
    await settle(el)
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(findRedraftSlot(KEY)).toBeNull()
    expect(toasts.at(-1)).toEqual({ kind: 'error', message: "Could not read the post's reply and quote limits, so it was not deleted." })
  })

  it.each([
    ['a reply with limits (G1)', RECORD,
      () => { pds.blueskyGetOwnGates.mockResolvedValue({ replies: null, quotes: false }) },
      'Its reply and quote limits are not kept.'],
    ['a menu label on a post with no images', { ...RECORD, embed: undefined, labels: { values: [{ val: 'porn' }] } }, () => {}, 'Its labels are not kept.'],
    ['the quoted post gone', { ...RECORD, reply: undefined, embed: { $type: 'app.bsky.embed.record', record: { uri: 'at://did:plc:carol/app.bsky.feed.post/q1', cid: 'bafyq' } } },
      () => { pds.fetchStatus.mockRejectedValue(Object.assign(new Error('gone'), { code: 'not_found' })) },
      'The post it quotes is gone, so the redraft cannot be posted with the quote.'],
    ['the quoted post with quotes off', { ...RECORD, reply: undefined, embed: { $type: 'app.bsky.embed.record', record: { uri: 'at://did:plc:carol/app.bsky.feed.post/q1', cid: 'bafyq' } } },
      () => { pds.fetchStatus.mockImplementation(async (id: string) => post({ id, uri: id }, { uri: id, embeddingDisabled: true })) },
      'The author of the post it quotes turned off quotes, so the redraft cannot be posted with the quote.'],
    ['a reply to a post with replies limited', RECORD,
      () => { pds.fetchStatus.mockImplementation(async (id: string) => post({ id, uri: id }, { uri: id, replyDisabled: true })) },
      'The author of the post it replies to limited replies, so the redraft cannot be posted as a reply.'],
  ])('the question names %s', async (_, record, setup, sentence) => {
    signIn()
    pds.blueskyGetOwnPost.mockResolvedValue({ uri: URI, cid: 'bafyold', value: record as unknown as BlueskyPostRecord })
    setup()
    const el = await mount(post())
    item(el, 'redraft')!.click()
    await settle(el)
    expect(confirmText()).toContain(sentence)
  })

  async function twoInAList() {
    const list = document.createElement('ul')
    document.body.appendChild(list)
    const mountIn = async (status: Status) => {
      const li = document.createElement('li')
      list.appendChild(li)
      statusCache.value = new Map([...statusCache.value, [status.id, status]])
      const el = document.createElement('caribou-status-card') as CaribouStatusCard
      el.setAttribute('filter-context', 'home')
      el.status = status
      li.appendChild(el)
      await settle(el)
      for (let i = 0; i < 20 && !activeClient.value; i++) await settle(el)
      await settle(el)
      return el
    }
    const el = await mountIn(post())
    const other = `at://${DID}/app.bsky.feed.post/3kother`
    const next = await mountIn(post({ id: other, uri: other }, { uri: other }))
    return { el, focusPost: vi.spyOn(next, 'focusPost') }
  }

  it.each([
    ['in the card: focus goes to the next post', true],
    ['elsewhere: focus stays', false],
  ])('a post found already deleted, focus %s (R3-N1)', async (_, inCard) => {
    signIn()
    pds.blueskyGetOwnPost.mockResolvedValue(null)
    const { el, focusPost } = await twoInAList()
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    if (inCard) await el.focusPost()
    else elsewhere.focus()
    item(el, 'redraft')!.click()
    await settle(el)
    expect(statusCache.value.has(URI)).toBe(false)
    expect(focusPost).toHaveBeenCalledTimes(inCard ? 1 : 0)
  })

  it.each([
    ['moved on: focus stays where the reader is', false],
    ['still in this card: focus goes to the next post', true],
  ])('focus after the delete (N7), the reader %s', async (_, inCard) => {
    signIn()
    const { el, focusPost } = await twoInAList()
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    // Where the reader is while the draft is made.
    if (inCard) await el.focusPost()
    else elsewhere.focus()
    await settle(el)
    expect(pds.blueskyDeletePost).toHaveBeenCalled()
    expect(focusPost).toHaveBeenCalledTimes(inCard ? 1 : 0)
    if (!inCard) expect(document.activeElement).toBe(elsewhere)
  })
})
