import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeClient, activeUserKey, addUserSession, blueskyUserKey, loadDraft, setBlueskyDriver, statusCache, users,
  type BlueskyDriver, type UserSession,
} from '@beatzball/caribou-state'
import {
  CaribouError, type BlueskyOwnPost, type BlueskyPostRecord, type Capabilities, type CaribouClient, type Status,
} from '@beatzball/caribou-mastodon-client'
import { BLUESKY_CAPABILITIES, BlueskyBlobNotFound } from '@beatzball/caribou-bluesky-client'
import * as compose from '../../../../packages/bluesky-client/src/compose.js'
import '../caribou-compose-dialog.js'
import type { CaribouComposeDialog } from '../caribou-compose-dialog.js'
import { LINK_CARD_DELAY_MS } from '../_bluesky-link-card.js'

const LINK = 'https://example.com/a'
const IMAGE = 'https://cardyb.bsky.app/v1/image?url=x'

// The link card fetch, controlled by each test. Never the network.
const cards = vi.hoisted(() => ({
  fetchLinkCard: null as unknown as ReturnType<typeof vi.fn>,
  fetchCardImage: null as unknown as ReturnType<typeof vi.fn>,
}))
vi.mock('../_bluesky.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadBluesky: async () => ({
    ...compose,
    fetchLinkCard: (...a: unknown[]) => cards.fetchLinkCard(...a),
    fetchCardImage: (...a: unknown[]) => cards.fetchCardImage(...a),
  }),
}))
vi.mock('../_image-fit.js', () => ({
  fitImage: vi.fn(async (f: Blob) => ({ ok: true, blob: f, width: 4, height: 3, resized: false })),
}))

const DID = 'did:plc:reader'
const KEY = blueskyUserKey(DID)

function fakeBluesky() {
  const records = new Map<string, BlueskyPostRecord>()
  let n = 0
  let blobs = 0
  const client = {
    userKey: KEY,
    capabilities: BLUESKY_CAPABILITIES,
    timelineOrder: () => null,
    blueskyNextRkey: vi.fn(async () => `3krkey${String(++n).padStart(7, '0')}`),
    blueskyDetectFacets: vi.fn(async () => []),
    blueskyUploadBlob: vi.fn(async (b: Blob) => ({ $type: 'blob' as const, ref: { $link: `bafkthumb${++blobs}` }, mimeType: b.type || 'image/jpeg', size: b.size })),
    blueskyCreatePost: vi.fn(async (record: BlueskyPostRecord, rkey: string) => {
      records.set(rkey, record)
      return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafynew' }
    }),
    blueskyGetOwnPost: vi.fn(async (rkey: string): Promise<BlueskyOwnPost | null> => {
      const value = records.get(rkey)
      return value ? { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafynew', value } : null
    }),
    fetchStatus: vi.fn(async (id: string) => ({ id, uri: id, account: { id: DID } }) as unknown as Status),
    fetchInstance: vi.fn(),
    verifyCredentials: vi.fn(() => new Promise(() => {})),
  }
  const driver: BlueskyDriver = {
    capabilities: BLUESKY_CAPABILITIES as Readonly<Capabilities>,
    timelineOrder: () => null,
    restore: async () => client as unknown as CaribouClient,
    signOut: async () => {},
  }
  return { client, driver, records }
}

function signInBluesky() {
  const pds = fakeBluesky()
  setBlueskyDriver(pds.driver)
  addUserSession({
    network: 'bluesky', userKey: KEY, did: DID, handle: 'reader.example.com', pds: 'https://pds.example.test',
    account: null, createdAt: 1,
  } as UserSession)
  return pds
}

function signInMastodonOffline(userKey: string) {
  addUserSession({ userKey, server: 'example.social', token: 'T', vapidKey: '', account: null, createdAt: 1 } as unknown as UserSession)
  const client = activeClient.value!
  vi.spyOn(client, 'fetchInstance').mockResolvedValue({ configuration: {} } as never)
  vi.spyOn(client, 'verifyCredentials').mockReturnValue(new Promise(() => {}))
  return client
}

async function settle(el: CaribouComposeDialog) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* wait */ }
  }
}

const pause = (el: CaribouComposeDialog) => new Promise((r) => setTimeout(r, LINK_CARD_DELAY_MS + 50)).then(() => settle(el))

async function mount(): Promise<CaribouComposeDialog> {
  const el = document.createElement('caribou-compose-dialog')
  document.body.appendChild(el)
  await settle(el)
  return el
}

function $<T extends Element = HTMLElement>(el: CaribouComposeDialog, sel: string): T | null {
  return el.shadowRoot!.querySelector<T>(sel)
}

async function open(el: CaribouComposeDialog) {
  window.dispatchEvent(new CustomEvent('caribou:compose', { detail: {} }))
  await settle(el)
}

async function type(el: CaribouComposeDialog, text: string) {
  const ta = $<HTMLTextAreaElement>(el, 'textarea')!
  ta.value = text
  ta.dispatchEvent(new Event('input'))
  await settle(el)
}

async function submit(el: CaribouComposeDialog) {
  $<HTMLFormElement>(el, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await settle(el)
}

async function addImage(el: CaribouComposeDialog) {
  const input = $<HTMLInputElement>(el, 'input[type="file"]')!
  Object.defineProperty(input, 'files', { value: [new File(['img'], 'a.jpg', { type: 'image/jpeg' })], configurable: true })
  input.dispatchEvent(new Event('change'))
  await settle(el)
}

function card(url: string) {
  return { uri: url, title: 'A title', description: 'A description', image: IMAGE }
}

const toasts: { kind: string; message: string }[] = []
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  localStorage.clear()
  toasts.length = 0
  cards.fetchLinkCard = vi.fn(async (url: string) => card(url))
  cards.fetchCardImage = vi.fn(async () => new Blob(['thumb'], { type: 'image/jpeg' }))
  window.addEventListener('caribou:toast', onToast)
})

afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  document.body.replaceChildren()
  activeUserKey.value = null
  users.value = new Map()
  statusCache.value = new Map()
  setBlueskyDriver(null)
  vi.restoreAllMocks()
})

describe('Bluesky link cards in compose (#200)', () => {
  it('rule 3 and 6: one fetch after a pause, then the preview', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'see https://exa')
    await type(el, 'see https://example.com/')
    await type(el, `see ${LINK}`)
    expect(cards.fetchLinkCard).not.toHaveBeenCalled()
    await pause(el)
    expect(cards.fetchLinkCard).toHaveBeenCalledTimes(1)
    expect(cards.fetchLinkCard.mock.calls[0]![0]).toBe(LINK)
    const preview = $(el, '[data-link-card]')!
    expect(preview.textContent).toContain('A title')
    expect(preview.textContent).toContain('example.com')
    expect(preview.querySelector('img')!.getAttribute('referrerpolicy')).toBe('no-referrer')
    // K1: the draft keeps it.
    expect(loadDraft(KEY, 'new')?.bluesky?.card).toMatchObject({ uri: LINK, title: 'A title', thumb: null })
  })

  it('rule 4: a late answer for a link the reader deleted shows nothing', async () => {
    signInBluesky()
    let release!: () => void
    cards.fetchLinkCard = vi.fn((url: string) => new Promise((r) => { release = () => r(card(url)) }))
    const el = await mount()
    await open(el)
    await type(el, `see ${LINK}`)
    await pause(el)
    await type(el, 'see nothing')
    release()
    await settle(el)
    expect($(el, '[data-link-card]')).toBeNull()
  })

  it('rule 5: Remove drops the card and it does not come back for that link', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, `see ${LINK}`)
    await pause(el)
    $(el, '[data-action="remove-link-card"]')!.click()
    await settle(el)
    expect($(el, '[data-link-card]')).toBeNull()
    await type(el, `see ${LINK} again`)
    await pause(el)
    expect($(el, '[data-link-card]')).toBeNull()
    expect(cards.fetchLinkCard).toHaveBeenCalledTimes(1)
  })

  it('rule 2: an image removes the card; the post has images, not a card', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, `see ${LINK}`)
    await pause(el)
    expect($(el, '[data-link-card]')).not.toBeNull()
    await addImage(el)
    expect($(el, '[data-link-card]')).toBeNull()
    await submit(el)
    const record = [...pds.records.values()][0]!
    expect(record.embed?.$type).toBe('app.bsky.embed.images')
  })

  it('K4: Post uploads the image once and sends the card with its thumb', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, `see ${LINK}`)
    await pause(el)
    await submit(el)
    expect(cards.fetchCardImage).toHaveBeenCalledWith(IMAGE)
    expect(pds.client.blueskyUploadBlob).toHaveBeenCalledTimes(1)
    const record = [...pds.records.values()][0]!
    expect(record.embed).toEqual({
      $type: 'app.bsky.embed.external',
      external: {
        uri: LINK, title: 'A title', description: 'A description',
        thumb: { $type: 'blob', ref: { $link: 'bafkthumb1' }, mimeType: 'image/jpeg', size: 5 },
      },
    })
    expect(toasts.at(-1)?.message).toBe('Post published')
  })

  it('K4: an image that fails posts the card without it', async () => {
    const pds = signInBluesky()
    cards.fetchCardImage = vi.fn(async () => { throw new Error('nope') })
    const el = await mount()
    await open(el)
    await type(el, `see ${LINK}`)
    await pause(el)
    await submit(el)
    expect(pds.client.blueskyUploadBlob).not.toHaveBeenCalled()
    const record = [...pds.records.values()][0]!
    expect(record.embed).toEqual({
      $type: 'app.bsky.embed.external',
      external: { uri: LINK, title: 'A title', description: 'A description' },
    })
  })

  it('rule 7: a dropped thumb blob is uploaded again on the next Post', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, `see ${LINK}`)
    await pause(el)
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new BlueskyBlobNotFound('Could not find blob: bafkthumb1', 'bafkthumb1'))
    await submit(el)
    expect(pds.records.size).toBe(0)
    expect(toasts.at(-1)?.message).toBe('The server no longer has the link card’s image. Post again to upload it again.')
    await submit(el)
    expect(pds.client.blueskyUploadBlob).toHaveBeenCalledTimes(2)
    const record = [...pds.records.values()][0]!
    expect((record.embed as unknown as { external: { thumb: { ref: { $link: string } } } }).external.thumb.ref.$link).toBe('bafkthumb2')
  })

  it('a create that fails for another reason keeps the card', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, `see ${LINK}`)
    await pause(el)
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new CaribouError('server_error', 'Internal Server Error', { status: 500 }))
    await submit(el)
    expect($(el, '[data-link-card]')).not.toBeNull()
    expect(loadDraft(KEY, 'new')?.bluesky?.card?.thumb?.ref.$link).toBe('bafkthumb1')
  })

  it('rule 8: Mastodon compose never fetches a card', async () => {
    signInMastodonOffline('alice@example.social')
    const el = await mount()
    await open(el)
    await type(el, `see ${LINK}`)
    await pause(el)
    expect(cards.fetchLinkCard).not.toHaveBeenCalled()
    expect($(el, '[data-link-card]')).toBeNull()
  })
})
