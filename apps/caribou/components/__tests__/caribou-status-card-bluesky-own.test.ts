// Bluesky delete and redraft on the card (#190; app README, "Bluesky delete and redraft").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueskyOwnPost, BlueskyPostRecord, Capabilities, CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, blueskyUserKey, deletedStatusIds, setBlueskyDriver, statusCache, users,
  type BlueskyDriver, type ComposeDraft, type UserSession,
} from '@beatzball/caribou-state'
import { BLUESKY_CAPABILITIES } from '@beatzball/caribou-bluesky-client'
import '../caribou-status-card.js'

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
      calls.push('upload')
      return { $type: 'blob' as const, ref: { $link: 'bafkA' }, mimeType: b.type, size: b.size }
    }),
    deleteStatus: vi.fn(async () => { throw new Error('Mastodon only') }),
    fetchStatus: vi.fn(() => new Promise(() => {})),
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

beforeEach(() => {
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

  it('Delete & redraft reads the record and images, deletes, uploads again, and opens a new Bluesky draft', async () => {
    signIn()
    const parent = { ...post({}, {}), id: PARENT.uri, uri: PARENT.uri } as Status
    statusCache.value = new Map([[PARENT.uri, parent]])
    const el = await mount(post())
    item(el, 'redraft')!.click()
    await settle(el)
    expect(confirmText()).toContain('Its likes, reposts and replies are lost.')
    confirmYes()
    await settle(el)
    expect(calls).toEqual(['read 3kold', 'blob bafkA', `delete ${URI}`, 'upload'])
    expect(events).toHaveLength(1)
    const detail = events[0]!.detail as { redraft: ComposeDraft; files: Record<string, Blob>; inReplyTo?: Status }
    expect(detail.redraft.text).toBe('hello')
    expect(detail.redraft.language).toBe('en')
    expect(detail.redraft.bluesky!.reply).toEqual({ root: PARENT, parent: PARENT })
    expect(detail.redraft.bluesky!.rkey).toBeNull()
    expect(detail.redraft.bluesky!.images.map((i) => i.alt)).toEqual(['a cat'])
    expect(Object.keys(detail.files)).toEqual([detail.redraft.bluesky!.images[0]!.id])
    expect(detail.inReplyTo?.id).toBe(PARENT.uri)
  })

  it('the question says a video or a link card is not kept', async () => {
    signIn()
    const el = await mount(post({ mediaAttachments: [{ id: 'v', type: 'video', url: 'https://x.example/v.m3u8' }], card: { url: 'https://example.com' } }))
    item(el, 'redraft')!.click()
    await settle(el)
    expect(confirmText()).toContain('The video is not kept.')
    expect(confirmText()).toContain('The link card is not kept.')
  })

  it('when the record cannot be read, nothing is deleted and no compose opens', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyGetOwnPost.mockRejectedValueOnce(new Error('502'))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(statusCache.value.has(URI)).toBe(true)
    expect(events).toEqual([])
    expect(toasts.at(-1)).toEqual({ kind: 'error', message: 'Could not read this post, so it was not deleted.' })
  })

  it('when an image cannot be read, nothing is deleted', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyGetBlob.mockRejectedValueOnce(new Error('502'))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('when the delete fails, no compose opens and the post comes back', async () => {
    signIn()
    const el = await mount(post())
    pds.blueskyDeletePost.mockRejectedValueOnce(new Error('500'))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(events).toEqual([])
    expect(pds.blueskyUploadBlob).not.toHaveBeenCalled()
    expect(statusCache.value.has(URI)).toBe(true)
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
    confirmYes()
    await settle(el)
    activeUserKey.value = null
    release()
    await settle(el)
    expect(pds.blueskyDeletePost).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})
