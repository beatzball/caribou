import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeClient, activeUserKey, addUserSession, blueskyUserKey, emptyBlueskyDraft, emptyDraft, getDraftFiles, loadDraft,
  putDraftFiles, saveDraft, _testOnlyClearDraftFiles, type DraftSlot,
  setBlueskyDriver, statusCache, users, type BlueskyDriver, type UserSession,
} from '@beatzball/caribou-state'
import {
  CaribouError, type BlueskyOwnPost, type BlueskyPostRecord, type Capabilities, type CaribouClient, type Status,
} from '@beatzball/caribou-mastodon-client'
import { BLUESKY_CAPABILITIES, BlueskyBlobNotFound } from '@beatzball/caribou-bluesky-client'
import * as compose from '../../../../packages/bluesky-client/src/compose.js'
import '../caribou-compose-dialog.js'
import type { CaribouComposeDialog } from '../caribou-compose-dialog.js'
import type { FitResult } from '../_image-fit.js'

// The SDK's counter, without the rest of the browser chunk.
vi.mock('../_bluesky.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadBluesky: async () => compose,
}))

const fit = vi.hoisted(() => ({ result: null as null | ((f: Blob) => FitResult), gate: null as Promise<void> | null }))
vi.mock('../_image-fit.js', () => ({
  fitImage: vi.fn(async (f: Blob) => {
    if (fit.gate) await fit.gate
    return fit.result ? fit.result(f) : { ok: true, blob: f, width: 4, height: 3, resized: false }
  }),
}))

// Storage that refuses draft writes while `refusing.on`. Reset after every
// test, so one failing test cannot leak it (review R2-N5).
const realSetItem = localStorage.setItem.bind(localStorage)
const refusing = { on: false }
Object.defineProperty(localStorage, 'setItem', {
  configurable: true,
  value: (k: string, v: string) => {
    if (refusing.on && k.startsWith('caribou.drafts.')) throw new DOMException('full', 'QuotaExceededError')
    return realSetItem(k, v)
  },
})

// A Mastodon account whose client makes no network call (review R2-N4).
function signInMastodonOffline(userKey: string) {
  addUserSession({
    userKey, server: 'example.social', token: 'T', vapidKey: '', account: null, createdAt: 1,
  } as unknown as UserSession)
  const client = activeClient.value!
  vi.spyOn(client, 'fetchInstance').mockResolvedValue({ configuration: {} } as never)
  vi.spyOn(client, 'verifyCredentials').mockReturnValue(new Promise(() => {}))
  return client
}

const DID = 'did:plc:reader'
const KEY = blueskyUserKey(DID)

function bobPost(over: Partial<NonNullable<Status['bluesky']>> = {}, id = 'at://did:plc:bob/app.bsky.feed.post/p1'): Status {
  return {
    id, uri: id, content: '<p>bob says hi</p>', visibility: 'public', spoilerText: '', mentions: [],
    account: { id: 'did:plc:bob', acct: 'bob.example.com', username: 'bob.example.com', displayName: 'Bob' },
    bluesky: {
      uri: id, cid: 'bafyp1', likeUri: null, repostUri: null, replyRef: null, replyDisabled: false,
      embeddingDisabled: false, labels: [], viewerOf: KEY, ...over,
    },
  } as unknown as Status
}

/** A fake PDS behind the Bluesky client, as the session driver restores it. */
function fakeBluesky() {
  const records = new Map<string, BlueskyPostRecord>()
  let n = 0
  let blobs = 0
  const cids = new Map<string, string>()
  const loseNext = { value: false }
  const client = {
    userKey: KEY,
    capabilities: BLUESKY_CAPABILITIES,
    timelineOrder: () => null,
    blueskyNextRkey: vi.fn(async () => `3krkey${String(++n).padStart(7, '0')}`),
    blueskyDetectFacets: vi.fn(async () => []),
    // Like a real PDS: the CID follows the bytes, so the same file gives the same CID.
    blueskyUploadBlob: vi.fn(async (b: Blob) => {
      const bytes = await b.text()
      if (!cids.has(bytes)) cids.set(bytes, `bafkblob${++blobs}`)
      return { $type: 'blob' as const, ref: { $link: cids.get(bytes)! }, mimeType: b.type || 'image/jpeg', size: b.size }
    }),
    blueskyCreatePost: vi.fn(async (record: BlueskyPostRecord, rkey: string) => {
      if (records.has(rkey)) throw new CaribouError('server_error', 'Internal Server Error', { status: 500 })
      records.set(rkey, record)
      if (loseNext.value) {
        loseNext.value = false
        throw new CaribouError('unreachable', 'timeout')
      }
      return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafynew' }
    }),
    blueskyGetOwnPost: vi.fn(async (rkey: string): Promise<BlueskyOwnPost | null> => {
      const value = records.get(rkey)
      return value ? { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafynew', value } : null
    }),
    fetchStatus: vi.fn(async (id: string) => id.includes(DID)
      ? { ...bobPost({}, id), account: { id: DID, acct: 'reader.example.com', username: 'reader', displayName: '' } } as Status
      : bobPost({}, id)),
    fetchInstance: vi.fn(),
    verifyCredentials: vi.fn(() => new Promise(() => {})),
  }
  const driver: BlueskyDriver = {
    capabilities: BLUESKY_CAPABILITIES as Readonly<Capabilities>,
    timelineOrder: () => null,
    restore: async () => client as unknown as CaribouClient,
    signOut: async () => {},
  }
  return { client, driver, records, loseNext }
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

async function settle(el: CaribouComposeDialog) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* wait */ }
  }
}

async function mount(): Promise<CaribouComposeDialog> {
  const el = document.createElement('caribou-compose-dialog')
  document.body.appendChild(el)
  await settle(el)
  return el
}

function $<T extends Element = HTMLElement>(el: CaribouComposeDialog, sel: string): T | null {
  return el.shadowRoot!.querySelector<T>(sel)
}

async function open(el: CaribouComposeDialog, detail: object = {}) {
  window.dispatchEvent(new CustomEvent('caribou:compose', { detail }))
  await settle(el)
}

async function type(el: CaribouComposeDialog, text: string) {
  const ta = $<HTMLTextAreaElement>(el, 'textarea')!
  ta.value = text
  ta.dispatchEvent(new Event('input'))
  await settle(el)
}

function postButton(el: CaribouComposeDialog) {
  return $(el, 'caribou-button.post')!.shadowRoot!.querySelector('button')!
}

async function submit(el: CaribouComposeDialog) {
  $<HTMLFormElement>(el, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await settle(el)
}

async function addFiles(el: CaribouComposeDialog, files: File[]) {
  const input = $<HTMLInputElement>(el, 'input[type="file"]')!
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  input.dispatchEvent(new Event('change'))
  await settle(el)
}

const toasts: { kind: string; message: string }[] = []
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  localStorage.clear()
  toasts.length = 0
  fit.result = null
  fit.gate = null
  refusing.on = false
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

describe('Bluesky compose: the controls', () => {
  it('has no visibility, poll or content-warning text; images only', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    expect($(el, 'h2')!.textContent).toBe('New post')
    expect($(el, '#compose-visibility')).toBeNull()
    expect($(el, '[data-action="toggle-poll"]')).toBeNull()
    expect($(el, '[data-action="toggle-cw"]')).toBeNull()
    expect($(el, '[data-action="add-media"]')!.getAttribute('label')).toBe('Add images')
    expect($<HTMLInputElement>(el, 'input[type="file"]')!.accept).toBe('image/*')
  })
})

describe('Bluesky compose: limits, counted as the PDS counts', () => {
  it('counts graphemes: 300 fit, 301 do not', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'x'.repeat(300))
    expect($(el, '.count')!.textContent).toBe('0')
    expect(postButton(el).getAttribute('aria-disabled') ?? String(postButton(el).disabled)).not.toBe('true')
    await type(el, 'x'.repeat(301))
    expect($(el, '.count')!.textContent).toBe('-1')
    expect($(el, '.count')!.hasAttribute('data-over')).toBe(true)
    expect(postButton(el).disabled).toBe(true)
  })

  it('a family emoji is one grapheme; 300 of them are over the byte limit', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, '👨‍👩‍👧‍👦'.repeat(3))
    expect($(el, '.count')!.textContent).toBe('297')
    await type(el, '👨‍👩‍👧‍👦'.repeat(300))
    expect($(el, '.count')!.textContent).toBe('0')
    expect(postButton(el).disabled).toBe(true)
    expect($(el, '[data-limit-status]')!.textContent).toBe('Over the 3000-byte limit')
  })

  it('long combining sequences: few graphemes, too many bytes', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, `a${'́'.repeat(50)}`.repeat(30))
    expect($(el, '.count')!.textContent).toBe('270')
    expect(postButton(el).disabled).toBe(true)
  })

  it('300 CJK characters fit (900 bytes); a long link counts in full', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, '你'.repeat(300))
    expect(postButton(el).disabled).toBe(false)
    const url = `https://example.com/${'a'.repeat(100)}`
    await type(el, url)
    expect($(el, '.count')!.textContent).toBe(String(300 - url.length))
  })
})

describe('Bluesky compose: posting once', () => {
  it('posts with an rkey, clears the draft and closes', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'hello bluesky')
    await submit(el)
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledOnce()
    const [record, rkey] = pds.client.blueskyCreatePost.mock.calls[0]!
    expect(rkey).toBe('3krkey0000001')
    expect(record).toMatchObject({ $type: 'app.bsky.feed.post', text: 'hello bluesky' })
    expect(loadDraft(KEY, 'new')).toBeNull()
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(false)
    expect(toasts.at(-1)).toMatchObject({ kind: 'info', message: 'Post published' })
  })

  it('a lost answer after the write: the check right after finds it, and the dialog closes (R1)', async () => {
    const pds = signInBluesky()
    pds.loseNext.value = true
    const el = await mount()
    await open(el)
    await type(el, 'only once')
    await submit(el)
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledOnce()
    expect(pds.client.blueskyGetOwnPost).toHaveBeenCalledWith('3krkey0000001')
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(false)
    expect(toasts.at(-1)).toMatchObject({ kind: 'info', message: 'Post published' })
  })

  it('the first send times out but the record was written: one post, no second create', async () => {
    const pds = signInBluesky()
    pds.loseNext.value = true
    // The check after the lost answer fails too: the outcome is unknown.
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    const el = await mount()
    await open(el)
    await type(el, 'only once')
    await submit(el)
    expect(toasts.at(-1)?.kind).toBe('error')
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(true)
    // The open dialog keeps the stored rkey and frozen record.
    expect($(el, '[data-send-unknown]')).not.toBeNull()
    await submit(el)
    expect(pds.client.blueskyGetOwnPost).toHaveBeenCalledWith('3krkey0000001')
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledOnce()
    expect(pds.records.size).toBe(1)
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(false)
  })

  it('a lost answer, then a reload, then the retry: one post', async () => {
    const pds = signInBluesky()
    pds.loseNext.value = true
    // The check after the lost answer fails too: the outcome is unknown.
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    const el = await mount()
    await open(el)
    await type(el, 'reload me')
    await submit(el)
    el.remove()
    // A new page: the dialog opens the stored draft.
    const again = await mount()
    await open(again)
    expect($<HTMLTextAreaElement>(again, 'textarea')!.value).toBe('reload me')
    await submit(again)
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledOnce()
    expect(pds.records.size).toBe(1)
  })

  it('a lost answer, then an edit: the edit stays, with a link to the posted version', async () => {
    const pds = signInBluesky()
    pds.loseNext.value = true
    // The check after the lost answer fails too: the outcome is unknown.
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    const el = await mount()
    await open(el)
    await type(el, 'version one')
    await submit(el)
    await type(el, 'version two')
    await submit(el)
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledOnce()
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('version two')
    const note = $(el, '[data-earlier-posted]')!
    expect(note.textContent).toContain('Your earlier version was posted.')
    expect(note.querySelector('a')!.getAttribute('href')).toBe(`/@${DID}/3krkey0000001`)
    // Post again sends the edit as a new post, with a new rkey.
    await submit(el)
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(2)
    expect(pds.client.blueskyCreatePost.mock.calls[1]![1]).toBe('3krkey0000002')
    expect(pds.records.get('3krkey0000002')!.text).toBe('version two')
  })
})

describe('Bluesky compose: reply and quote', () => {
  it('a reply holds root and parent strong refs, and types no mentions', async () => {
    const pds = signInBluesky()
    const el = await mount()
    const parent = bobPost({ replyRef: { root: { uri: 'at://did:plc:bob/app.bsky.feed.post/p0', cid: 'bafyroot' }, parent: { uri: 'x', cid: 'y' } } })
    await open(el, { inReplyTo: parent })
    expect($(el, 'h2')!.textContent).toBe('Reply')
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('')
    await type(el, 'a reply')
    await submit(el)
    const [record] = pds.client.blueskyCreatePost.mock.calls[0]!
    expect(record.reply).toEqual({
      root: { uri: 'at://did:plc:bob/app.bsky.feed.post/p0', cid: 'bafyroot' },
      parent: { uri: parent.id, cid: 'bafyp1' },
    })
  })

  it('a reply to a top post uses it as root and parent', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el, { inReplyTo: bobPost() })
    await type(el, 'x')
    await submit(el)
    const ref = { uri: 'at://did:plc:bob/app.bsky.feed.post/p1', cid: 'bafyp1' }
    expect(pds.client.blueskyCreatePost.mock.calls[0]![0].reply).toEqual({ root: ref, parent: ref })
  })

  it('a reply to a post with replyDisabled cannot be sent', async () => {
    const pds = signInBluesky()
    pds.client.fetchStatus.mockImplementation(async (id: string) => bobPost({ replyDisabled: true }, id))
    const el = await mount()
    await open(el, { inReplyTo: bobPost({ replyDisabled: true }) })
    await type(el, 'let me in')
    expect($(el, '[data-compose-blocked]')!.textContent).toBe('The author limited replies. You cannot reply to this post.')
    expect(postButton(el).disabled).toBe(true)
    await submit(el)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
  })

  it('a reply turned off after the dialog opened is refused at send', async () => {
    const pds = signInBluesky()
    const el = await mount()
    const post = bobPost()
    await open(el, { inReplyTo: post })
    await type(el, 'too late')
    statusCache.value = new Map([[post.id, bobPost({ replyDisabled: true })]])
    await submit(el)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
    expect(toasts.at(-1)).toMatchObject({ kind: 'error', message: 'The author limited replies. You cannot reply to this post.' })
  })

  it('reads the parent again on open: a deleted one keeps the text and says so', async () => {
    const pds = signInBluesky()
    const post = bobPost()
    saveDraft(KEY, `reply:${post.id}`, emptyDraft({
      text: 'kept text', inReplyToId: post.id,
      bluesky: emptyBlueskyDraft({ reply: { root: { uri: post.id, cid: 'bafyp1' }, parent: { uri: post.id, cid: 'bafyp1' } } }),
    }))
    pds.client.fetchStatus.mockRejectedValue(new CaribouError('not_found', 'gone', { status: 404 }))
    const el = await mount()
    await open(el, { inReplyTo: post })
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('kept text')
    expect($(el, '[data-compose-blocked]')!.textContent).toBe('The post you replied to was deleted.')
    expect(postButton(el).disabled).toBe(true)
  })

  it('a quote is embed.record; a post with embeddingDisabled cannot be quoted', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el, { quote: bobPost() })
    expect($(el, 'h2')!.textContent).toBe('Quote post')
    expect($(el, '[data-quote-to]')!.textContent).toContain('bob says hi')
    // A quote may have no text.
    expect(postButton(el).disabled).toBe(false)
    await submit(el)
    expect(pds.client.blueskyCreatePost.mock.calls[0]![0].embed).toEqual({
      $type: 'app.bsky.embed.record', record: { uri: 'at://did:plc:bob/app.bsky.feed.post/p1', cid: 'bafyp1' },
    })

    pds.client.fetchStatus.mockImplementation(async (id: string) => bobPost({ embeddingDisabled: true }, id))
    await open(el, { quote: bobPost({ embeddingDisabled: true }) })
    expect($(el, '[data-compose-blocked]')!.textContent).toBe('The author turned off quotes for this post.')
    await submit(el)
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledOnce()
  })

  it('a Mastodon account cannot quote, and does not open for a Bluesky post', async () => {
    signInMastodonOffline('alice@example.social')
    const el = await mount()
    await open(el, { quote: bobPost() })
    expect($<HTMLDialogElement>(el, 'dialog')?.open ?? false).toBe(false)
    await open(el, { inReplyTo: bobPost() })
    expect($<HTMLDialogElement>(el, 'dialog')?.open ?? false).toBe(false)
  })
})

describe('Bluesky compose: images, alt text and labels', () => {
  it('uploads a fitted image; alt text and self-labels go in the record', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['img'], 'cat.jpg', { type: 'image/jpeg' })])
    expect(pds.client.blueskyUploadBlob).toHaveBeenCalledOnce()
    const alt = $<HTMLInputElement>(el, '[data-bsky-image] input')!
    expect(alt.getAttribute('aria-label')).toBe('Alt text for image 1, cat.jpg')
    alt.value = 'a cat on a mat'
    alt.dispatchEvent(new Event('input'))
    await settle(el)
    // The label menu shows only with media.
    const menu = $(el, 'caribou-menu[data-action="labels"]')!
    expect(menu.getAttribute('label')).toBe('Label this media')
    menu.querySelector<HTMLButtonElement>('[data-label="nudity"]')!.click()
    await settle(el)
    expect(menu.getAttribute('label')).toBe('Label this media: Nudity')
    expect(menu.querySelector('[data-label="nudity"]')!.getAttribute('aria-pressed')).toBe('true')
    // The draft keeps blob ref, alt and label across a reload.
    const stored = loadDraft(KEY, 'new')!.bluesky!
    expect(stored.images[0]).toMatchObject({ blob: { ref: { $link: 'bafkblob1' } }, alt: 'a cat on a mat', aspectRatio: { width: 4, height: 3 } })
    expect(stored.labels).toEqual(['nudity'])
    await submit(el)
    const [record] = pds.client.blueskyCreatePost.mock.calls[0]!
    expect(record.embed).toEqual({
      $type: 'app.bsky.embed.images',
      images: [{ image: { $type: 'blob', ref: { $link: 'bafkblob1' }, mimeType: 'image/jpeg', size: 3 }, alt: 'a cat on a mat', aspectRatio: { width: 4, height: 3 } }],
    })
    expect(record.labels).toEqual({ $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] })
  })

  it('takes at most 4 images', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await addFiles(el, Array.from({ length: 5 }, (_, i) => new File(['x'], `${i}.jpg`, { type: 'image/jpeg' })))
    expect(pds.client.blueskyUploadBlob).toHaveBeenCalledTimes(4)
    expect(toasts.some((t) => t.message === 'You can attach up to 4 files.')).toBe(true)
  })

  it('an image that cannot get under 2 MB is refused with a message', async () => {
    const pds = signInBluesky()
    fit.result = () => ({ ok: false, reason: 'too-large' })
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['x'], 'huge.png', { type: 'image/png' })])
    expect(pds.client.blueskyUploadBlob).not.toHaveBeenCalled()
    expect(toasts.at(-1)).toMatchObject({ kind: 'error', message: 'huge.png is too large, even made smaller. Pick an image under 2 MB.' })
    expect($(el, '[data-pending]')).toBeNull()
  })

  it('uploads the resized image, not the original', async () => {
    const pds = signInBluesky()
    const small = new Blob(['small'], { type: 'image/jpeg' })
    fit.result = () => ({ ok: true, blob: small, width: 2000, height: 1500, resized: true })
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['big'.repeat(10)], 'big.jpg', { type: 'image/jpeg' })])
    expect(pds.client.blueskyUploadBlob).toHaveBeenCalledWith(small)
  })

  it('a blob the PDS dropped goes up again from the file this page has', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['img'], 'cat.jpg', { type: 'image/jpeg' })])
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new BlueskyBlobNotFound('Could not find blob: bafkblob1', 'bafkblob1'))
    await submit(el)
    // The same bytes again: the same CID, as a real PDS answers (review N8).
    expect(pds.client.blueskyUploadBlob).toHaveBeenCalledTimes(2)
    expect(loadDraft(KEY, 'new')!.bluesky!.images[0]!.blob.ref.$link).toBe('bafkblob1')
    await submit(el)
    expect(pds.records.size).toBe(1)
    expect(pds.client.blueskyCreatePost.mock.calls.map((c) => c[1])).toEqual(['3krkey0000001', '3krkey0000001'])
    const sent = [...pds.records.values()][0]!
    expect((sent.embed as unknown as { images: { image: { ref: { $link: string } } }[] }).images[0]!.image.ref.$link).toBe('bafkblob1')
  })

  it('after a reload a dropped blob has no file: it asks for the image again', async () => {
    const pds = signInBluesky()
    saveDraft(KEY, 'new', emptyDraft({
      text: 'old photo',
      bluesky: emptyBlueskyDraft({ images: [{ id: 'old1', blob: { $type: 'blob', ref: { $link: 'bafkold' }, mimeType: 'image/jpeg', size: 9 }, mime: 'image/jpeg', size: 9, alt: 'old', aspectRatio: null, name: 'old.jpg' }] }),
    }))
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new BlueskyBlobNotFound('Could not find blob: bafkold', 'bafkold'))
    const el = await mount()
    await open(el)
    await submit(el)
    expect($(el, '[data-bsky-image] .state')!.textContent).toContain('Not on the server any more')
    expect(postButton(el).disabled).toBe(true)
  })
})

describe('Bluesky compose: account and session', () => {
  it('an account switch closes the dialog and keeps the draft for its account', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'mine')
    signInMastodonOffline('alice@example.social')
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(false)
    expect(loadDraft(KEY, 'new')!.text).toBe('mine')
  })
})

function $$(el: CaribouComposeDialog, sel: string) {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)]
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('review fixes (PR #232)', () => {
  it('3 images, then a second pick of 3: at most 4 (Codex 6, Fable B3)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await addFiles(el, [0, 1, 2].map((i) => new File([`a${i}`], `a${i}.jpg`, { type: 'image/jpeg' })))
    await addFiles(el, [0, 1, 2].map((i) => new File([`b${i}`], `b${i}.jpg`, { type: 'image/jpeg' })))
    expect(pds.client.blueskyUploadBlob).toHaveBeenCalledTimes(4)
    expect(loadDraft(KEY, 'new')!.bluesky!.images).toHaveLength(4)
  })

  it('a stored draft over 4 images cannot be posted', async () => {
    const pds = signInBluesky()
    const img = (i: number) => ({ id: `i${i}`, blob: { $type: 'blob' as const, ref: { $link: `bafk${i}` }, mimeType: 'image/jpeg', size: 1 }, mime: 'image/jpeg', size: 1, alt: '', aspectRatio: null })
    saveDraft(KEY, 'new', emptyDraft({ text: 'five', bluesky: emptyBlueskyDraft({ images: [0, 1, 2, 3, 4].map(img) }) }))
    const el = await mount()
    await open(el)
    expect(postButton(el).disabled).toBe(true)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
  })

  it('cache allows replies, the fresh read says replyDisabled: blocked, and the cache takes the fresh copy (Codex 5, Fable B2)', async () => {
    const pds = signInBluesky()
    const post = bobPost()
    statusCache.value = new Map([[post.id, post]])
    pds.client.fetchStatus.mockImplementation(async (id: string) => bobPost({ replyDisabled: true }, id))
    const el = await mount()
    await open(el, { inReplyTo: post })
    await type(el, 'let me in')
    expect($(el, '[data-compose-blocked]')!.textContent).toBe('The author limited replies. You cannot reply to this post.')
    expect(statusCache.peek().get(post.id)!.bluesky!.replyDisabled).toBe(true)
    await submit(el)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
  })

  it('the fresh read allows quotes, a cache copy still says embeddingDisabled: blocked', async () => {
    const pds = signInBluesky()
    const post = bobPost()
    pds.client.fetchStatus.mockImplementation(async (id: string) => {
      // The card's copy changes while the read is out.
      statusCache.value = new Map([[id, bobPost({ embeddingDisabled: true }, id)]])
      return bobPost({}, id)
    })
    const el = await mount()
    await open(el, { quote: post })
    // The fresh copy went into the cache, so the next check reads it there.
    statusCache.value = new Map([[post.id, bobPost({ embeddingDisabled: true })]])
    await submit(el)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
  })

  it('the same file picked twice is two images: removing one keeps the other (Fable N2)', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['same'], 'cat.jpg', { type: 'image/jpeg' })])
    await addFiles(el, [new File(['same'], 'cat.jpg', { type: 'image/jpeg' })])
    expect(loadDraft(KEY, 'new')!.bluesky!.images).toHaveLength(2)
    const alts = $$(el, '[data-bsky-image] input') as HTMLInputElement[]
    alts[0]!.value = 'first'
    alts[0]!.dispatchEvent(new Event('input'))
    await settle(el)
    expect(loadDraft(KEY, 'new')!.bluesky!.images.map((i) => i.alt)).toEqual(['first', ''])
    $$(el, '[data-bsky-image] [data-action="remove-media"]')[0]!.click()
    await settle(el)
    expect(loadDraft(KEY, 'new')!.bluesky!.images.map((i) => i.alt)).toEqual([''])
  })

  it('storage refuses every click: a true refusal each time, nothing sent; storage back, one post (R3, R5, Codex R2.1, Fable R2-B2, probe C)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'only once')
    refusing.on = true
    pds.loseNext.value = true
    for (let i = 0; i < 3; i++) {
      await submit(el)
      expect(toasts.at(-1)).toMatchObject({ kind: 'error', message: 'Could not save the draft, so the post was not sent.' })
      expect($(el, '[data-send-unknown]')).toBeNull()
    }
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
    // Reload with storage working again.
    refusing.on = false
    el.remove()
    const again = await mount()
    await open(again)
    expect($<HTMLTextAreaElement>(again, 'textarea')!.value).toBe('only once')
    await submit(again)
    expect(pds.records.size).toBe(1)
    expect(loadDraft(KEY, 'new')).toBeNull()
    await open(again)
    expect($<HTMLTextAreaElement>(again, 'textarea')!.value).toBe('')
  })

  it('a send in doubt, then storage is wiped: memory keeps the rkey, the retry checks it (R3)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'kept in memory')
    pds.loseNext.value = true
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await submit(el)
    localStorage.clear()
    await submit(el)
    expect(pds.client.blueskyGetOwnPost).toHaveBeenLastCalledWith('3krkey0000001')
    expect(pds.records.size).toBe(1)
  })

  it('close and reopen during the send, edit, then the old send succeeds: the edit is still stored (rule 3, Codex 4)', async () => {
    const pds = signInBluesky()
    const gate = deferred<void>()
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      await gate.promise
      pds.records.set(rkey, record)
      return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafynew' }
    })
    const el = await mount()
    await open(el)
    await type(el, 'v1')
    void submit(el)
    await settle(el)
    $<HTMLDialogElement>(el, 'dialog')!.close()
    await settle(el)
    await open(el)
    await type(el, 'v1 and more')
    gate.resolve()
    await settle(el)
    expect(loadDraft(KEY, 'new')!.text).toBe('v1 and more')
  })

  it('a re-upload that lands after an account switch writes nothing (rule 4, Codex 3, Fable N3)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['img'], 'cat.jpg', { type: 'image/jpeg' })])
    await type(el, 'alice text')
    const gate = deferred<void>()
    pds.client.blueskyUploadBlob.mockImplementationOnce(async (b: Blob) => {
      await gate.promise
      return { $type: 'blob' as const, ref: { $link: 'bafkblob1' }, mimeType: b.type, size: b.size }
    })
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new BlueskyBlobNotFound('Could not find blob: bafkblob1', 'bafkblob1'))
    void submit(el)
    await settle(el)
    // Switch to a Mastodon account and open its composer.
    signInMastodonOffline('bob@example.social')
    await settle(el)
    await open(el)
    await type(el, 'bob private draft')
    gate.resolve()
    await settle(el)
    expect(loadDraft(KEY, 'new')!.text).toBe('alice text')
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('bob private draft')
    expect($$(el, '[data-bsky-image]')).toHaveLength(0)
  })

  it('a re-upload that lands after close and reopen on another slot writes nothing (rule 4)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['img'], 'cat.jpg', { type: 'image/jpeg' })])
    await type(el, 'the new post text')
    const gate = deferred<void>()
    pds.client.blueskyUploadBlob.mockImplementationOnce(async (b: Blob) => {
      await gate.promise
      return { $type: 'blob' as const, ref: { $link: 'bafkblob1' }, mimeType: b.type, size: b.size }
    })
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new BlueskyBlobNotFound('Could not find blob: bafkblob1', 'bafkblob1'))
    void submit(el)
    await settle(el)
    $<HTMLDialogElement>(el, 'dialog')!.close()
    await settle(el)
    await open(el, { inReplyTo: bobPost() })
    await type(el, 'a reply')
    gate.resolve()
    await settle(el)
    expect(loadDraft(KEY, `reply:${bobPost().id}`)!.bluesky!.images).toHaveLength(0)
    expect($$(el, '[data-bsky-image]')).toHaveLength(0)
    // The `new` slot keeps its own text: the reply was not saved over it (review R2-N2).
    expect(loadDraft(KEY, 'new')!.text).toBe('the new post text')
  })

  it('an upload whose fit or upload lands after close and reopen on another slot adds nothing (rule 4, review R2-N3)', async () => {
    const pds = signInBluesky()
    const fitGate = deferred<void>()
    fit.gate = fitGate.promise
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['img'], 'cat.jpg', { type: 'image/jpeg' })])
    $<HTMLDialogElement>(el, 'dialog')!.close()
    await settle(el)
    await open(el, { inReplyTo: bobPost() })
    await type(el, 'a reply')
    fitGate.resolve()
    await settle(el)
    expect(pds.client.blueskyUploadBlob).not.toHaveBeenCalled()
    expect(loadDraft(KEY, `reply:${bobPost().id}`)!.bluesky!.images).toHaveLength(0)
    expect(loadDraft(KEY, 'new')).toBeNull()

    // The same with the upload itself late.
    fit.gate = null
    const upGate = deferred<void>()
    pds.client.blueskyUploadBlob.mockImplementationOnce(async (b: Blob) => {
      await upGate.promise
      return { $type: 'blob' as const, ref: { $link: 'bafklate' }, mimeType: b.type, size: b.size }
    })
    $<HTMLDialogElement>(el, 'dialog')!.close()
    await settle(el)
    await open(el)
    await addFiles(el, [new File(['img2'], 'dog.jpg', { type: 'image/jpeg' })])
    $<HTMLDialogElement>(el, 'dialog')!.close()
    await settle(el)
    await open(el, { inReplyTo: bobPost() })
    upGate.resolve()
    await settle(el)
    expect(loadDraft(KEY, `reply:${bobPost().id}`)!.bluesky!.images).toHaveLength(0)
    expect(loadDraft(KEY, 'new')).toBeNull()
  })

  it('checkTarget reads the dialog\'s own copy: a fresh replyDisabled blocks even when the cache says allowed (review R2-N3)', async () => {
    const pds = signInBluesky()
    const post = bobPost()
    pds.client.fetchStatus.mockImplementation(async (id: string) => bobPost({ replyDisabled: true }, id))
    const el = await mount()
    await open(el, { inReplyTo: post })
    // The cache gets the allowed copy back after the fresh read.
    statusCache.value = new Map([[post.id, post]])
    await type(el, 'x')
    await submit(el)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
  })

  it('an image the canvas cannot encode: the pending item goes, with a message (review R2-N6)', async () => {
    signInBluesky()
    fit.result = () => { throw new Error('canvas refused') }
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['img'], 'cat.jpg', { type: 'image/jpeg' })])
    expect($(el, '[data-pending]')).toBeNull()
    expect(toasts.at(-1)).toMatchObject({ kind: 'error', message: 'cat.jpg could not be prepared: canvas refused' })
  })

  it('a send in doubt with an image, closed, the PDS drops the blob, reopen: remove the image and the post goes (R1, R2, R5, Fable R2-B1, probe A)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await addFiles(el, [new File(['img'], 'cat.jpg', { type: 'image/jpeg' })])
    await type(el, 'with photo')
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new CaribouError('unreachable', 'Failed to fetch'))
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'Failed to fetch'))
    await submit(el)
    $<HTMLDialogElement>(el, 'dialog')!.close()
    await settle(el)
    pds.client.blueskyCreatePost.mockImplementation(async (record: BlueskyPostRecord, rkey: string) => {
      if (JSON.stringify(record).includes('bafkblob1')) throw new BlueskyBlobNotFound('Could not find blob: bafkblob1', 'bafkblob1')
      pds.records.set(rkey, record)
      return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafynew' }
    })
    await open(el)
    await submit(el)
    expect(toasts.at(-1)!.message).toBe('The server no longer has an image. Remove it and add it again, then post.')
    expect(postButton(el).disabled).toBe(true)
    $$(el, '[data-bsky-image] [data-action="remove-media"]')[0]!.click()
    await settle(el)
    expect(postButton(el).disabled).toBe(false)
    await submit(el)
    expect(pds.records.size).toBe(1)
    expect([...pds.records.values()][0]!.text).toBe('with photo')
    expect(toasts.some((t) => t.message === 'An image was uploaded again. Post again to send.')).toBe(false)
  })

  it('a refusal with no image left to upload says so truthfully (R5)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'text only')
    // A refusal that names a blob this draft does not have.
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new BlueskyBlobNotFound('Could not find blob: bafkother', 'bafkother'))
    await submit(el)
    expect(toasts.at(-1)!.message).toBe('The server refused an image this post named. Post again to send it without it.')
    await submit(el)
    expect(pds.records.size).toBe(1)
  })

  it('over the byte limit the reason is visible text, and the counter names it (Fable N5)', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, `a${'́'.repeat(50)}`.repeat(30))
    expect($(el, '[data-byte-limit]')!.textContent).toBe('Over the 3000-byte limit')
    expect($(el, '[data-byte-limit]')!.classList.contains('visually-hidden')).toBe(false)
    expect($(el, '.count')!.getAttribute('aria-label')).toBe('270 characters left, over the 3000-byte limit')
  })

  it('"Open it" opens the earlier version in a new tab (Fable N6)', async () => {
    const pds = signInBluesky()
    pds.loseNext.value = true
    // The check after the lost answer fails too: the outcome is unknown.
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    const el = await mount()
    await open(el)
    await type(el, 'version one')
    await submit(el)
    await type(el, 'version two')
    await submit(el)
    const a = $(el, '[data-earlier-posted] a')!
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener')
  })
})

function pdsState(el: CaribouComposeDialog, pds: ReturnType<typeof fakeBluesky>) {
  return {
    open: $<HTMLDialogElement>(el, 'dialog')?.open ?? false,
    records: [...pds.records.entries()].map(([k, r]) => `${k}=${r.text}`),
  }
}

describe('round 3 (PR #232)', () => {
  it('Post, Cancel while the mention lookup runs, open again, Post: one post (R6, Fable R3-B2, probe A)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'only once @alice.example.com')
    const facets = deferred<never[]>()
    pds.client.blueskyDetectFacets.mockImplementationOnce(() => facets.promise)
    await submit(el)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el)
    facets.resolve([])
    await settle(el)
    await submit(el)
    expect(pdsState(el, pds).records).toEqual(['3krkey0000001=only once @alice.example.com'])
  })

  it('no answer, the check says absent, the record lands late, no edit, Post again: posted, one record (R7, Fable R3-B1, probe B)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'only once')
    let late: BlueskyPostRecord | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record: BlueskyPostRecord) => {
      late = record
      throw new CaribouError('server_error', 'Gateway Timeout', { status: 504 })
    })
    await submit(el)
    pds.records.set('3krkey0000001', late!)
    await new Promise((r) => setTimeout(r, 5))
    await submit(el)
    expect(pdsState(el, pds)).toEqual({ open: false, records: ['3krkey0000001=only once'] })
    expect(toasts.at(-1)).toMatchObject({ kind: 'info', message: 'Post published' })
  })

  it('control: Cancel and reopen after the freeze, Post: one post (probe C)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'only once')
    const gate = deferred<void>()
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record: BlueskyPostRecord, rkey: string) => {
      await gate.promise
      pds.records.set(rkey, record)
      return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafynew' }
    })
    await submit(el)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el)
    gate.resolve()
    await settle(el)
    await submit(el)
    expect(pds.records.size).toBe(1)
  })

  it('the draft has its rkey before Post: a draft opened with none gets one, and Post waits for it (R6)', async () => {
    const pds = signInBluesky()
    const rk = deferred<string>()
    pds.client.blueskyNextRkey.mockImplementationOnce(() => rk.promise)
    const el = await mount()
    await open(el)
    await type(el, 'hello')
    expect(postButton(el).disabled).toBe(true)
    rk.resolve('3krkeyfromopen')
    await settle(el)
    expect(postButton(el).disabled).toBe(false)
    expect(loadDraft(KEY, 'new')!.bluesky!.rkey).toBe('3krkeyfromopen')
    await submit(el)
    expect(pds.client.blueskyCreatePost.mock.calls[0]![1]).toBe('3krkeyfromopen')
  })

  it('"The last send did not finish." shows only when no send is running (R5, Fable R3-B3)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'slow')
    const gate = deferred<void>()
    pds.client.blueskyCreatePost.mockImplementationOnce(async () => {
      await gate.promise
      throw new CaribouError('unreachable', 'timeout')
    })
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    void submit(el)
    await settle(el)
    expect($(el, '[data-send-unknown]')).toBeNull()
    gate.resolve()
    await settle(el)
    expect($(el, '[data-send-unknown]')).not.toBeNull()
  })

  it('an old send that ends absent after close and reopen does not put its draft into the reopened dialog (Fable R3-N2)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'v1')
    const gate = deferred<void>()
    pds.client.blueskyCreatePost.mockImplementationOnce(async () => {
      await gate.promise
      throw new CaribouError('server_error', 'Bad Gateway', { status: 502 })
    })
    void submit(el)
    await settle(el)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el)
    await type(el, 'v2 in the reopened dialog')
    gate.resolve()
    await settle(el)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('v2 in the reopened dialog')
  })

  it('a send stopped by a change from elsewhere says so (DraftChanged, Fable R3-N3)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'mine')
    const facets = deferred<never[]>()
    pds.client.blueskyDetectFacets.mockImplementationOnce(() => facets.promise)
    void submit(el)
    await settle(el)
    // Another tab saves this slot.
    saveDraft(KEY, 'new', { ...loadDraft(KEY, 'new')!, text: 'from another tab' })
    facets.resolve([])
    await settle(el)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
    expect(toasts.at(-1)).toMatchObject({ kind: 'error', message: 'The draft changed while it was being sent, so nothing was sent.' })
  })
})

const MENTION = [{
  index: { byteStart: 3, byteEnd: 21 },
  features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:alice' }],
}] as never[]

describe('round 4 (PR #232)', () => {
  it('a quote with no text: failed create, check absent, close and reopen, late write, Post: one record (Codex R4-B1)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    const quoted = bobPost()
    await open(el, { quote: quoted })
    let late: BlueskyPostRecord | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record: BlueskyPostRecord) => {
      late = record
      throw new CaribouError('server_error', 'Gateway Timeout', { status: 504 })
    })
    await submit(el)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el, { quote: quoted })
    pds.records.set('3krkey0000001', late!)
    await submit(el)
    expect(pdsState(el, pds)).toEqual({ open: false, records: ['3krkey0000001='] })
  })

  it('the same after a reload (Codex R4-B1)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    const quoted = bobPost()
    await open(el, { quote: quoted })
    let late: BlueskyPostRecord | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record: BlueskyPostRecord) => {
      late = record
      throw new CaribouError('server_error', 'Gateway Timeout', { status: 504 })
    })
    await submit(el)
    el.remove()
    const again = await mount()
    await open(again, { quote: quoted })
    pds.records.set('3krkey0000001', late!)
    await submit(again)
    expect(pds.records.size).toBe(1)
  })

  it('Post, Cancel during a slow lookup that fails, open again, Post with a lookup that works: one post, closed (Fable R4-N1, probe A)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'hi @alice.example.com')
    const lookup1 = deferred<never[]>()
    pds.client.blueskyDetectFacets.mockImplementationOnce(() => lookup1.promise)
    await submit(el)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el)
    lookup1.resolve([])
    await settle(el)
    pds.client.blueskyDetectFacets.mockImplementationOnce(async () => MENTION)
    if ($<HTMLDialogElement>(el, 'dialog')?.open) await submit(el)
    expect(pds.records.size).toBe(1)
    expect($<HTMLDialogElement>(el, 'dialog')?.open).toBe(false)
  })

  it('no answer, check absent, late write, lookup 2 fails: posted, one record, closed (Fable R4-N1, probe B)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'hi @alice.example.com')
    pds.client.blueskyDetectFacets.mockImplementationOnce(async () => MENTION)
    let late: BlueskyPostRecord | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record: BlueskyPostRecord) => {
      late = record
      throw new CaribouError('server_error', 'Gateway Timeout', { status: 504 })
    })
    await submit(el)
    pds.records.set('3krkey0000001', late!)
    await new Promise((r) => setTimeout(r, 5))
    await submit(el)
    expect(pds.records.size).toBe(1)
    expect($<HTMLDialogElement>(el, 'dialog')?.open).toBe(false)
  })

  it('control: both lookups give the facet: one post, closed (probe C)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'hi @alice.example.com')
    const lookup1 = deferred<never[]>()
    pds.client.blueskyDetectFacets.mockImplementationOnce(() => lookup1.promise)
    await submit(el)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el)
    lookup1.resolve(MENTION)
    await settle(el)
    pds.client.blueskyDetectFacets.mockImplementationOnce(async () => MENTION)
    if ($<HTMLDialogElement>(el, 'dialog')?.open) await submit(el)
    expect(pds.records.size).toBe(1)
    expect($<HTMLDialogElement>(el, 'dialog')?.open).toBe(false)
  })

  it('the rkey cannot be made: a toast says so, Post is off, and opening again works (Fable R4-N3, probe D)', async () => {
    const pds = signInBluesky()
    pds.client.blueskyNextRkey.mockRejectedValueOnce(new CaribouError('not_found', 'Bluesky compose is not loaded'))
    const el = await mount()
    await open(el)
    await type(el, 'hello')
    expect(toasts.at(-1)).toMatchObject({ kind: 'error', message: 'Could not get the post ready: Bluesky compose is not loaded. Open the composer again.' })
    expect(postButton(el).disabled).toBe(true)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el)
    expect(postButton(el).disabled).toBe(false)
    await submit(el)
    expect(pds.records.size).toBe(1)
  })

  it('a slow rkey that lands after the reader opened another slot goes nowhere (Fable R4-N3, probe E)', async () => {
    const pds = signInBluesky()
    const rk1 = deferred<string>()
    const rk2 = deferred<string>()
    pds.client.blueskyNextRkey.mockImplementationOnce(() => rk1.promise).mockImplementationOnce(() => rk2.promise)
    const el = await mount()
    await open(el)
    await type(el, 'a new post')
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el, { inReplyTo: bobPost() })
    await type(el, 'a reply')
    // The first rkey lands while the reply draft is still waiting for its own.
    rk1.resolve('3krkeyLATE')
    await settle(el)
    rk2.resolve('3krkeyREPLY')
    await settle(el)
    expect(loadDraft(KEY, `reply:${bobPost().id}`)!.bluesky!.rkey).toBe('3krkeyREPLY')
    const all = JSON.parse(localStorage.getItem(`caribou.drafts.${KEY}`) ?? '{}') as Record<string, { text: string; bluesky?: { rkey: string | null } }>
    expect(Object.values(all).map((d) => d.bluesky?.rkey)).not.toContain('3krkeyLATE')
    expect(all['new']?.text).toBe('a new post')
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('a reply')
  })

  it('an earlier opening\'s send posts the same draft: the reopened dialog closes (Fable R4-N4, probe F)', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'only once @alice.example.com')
    const lookup1 = deferred<never[]>()
    pds.client.blueskyDetectFacets.mockImplementationOnce(() => lookup1.promise)
    await submit(el)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el)
    lookup1.resolve([])
    await settle(el)
    expect(pds.records.size).toBe(1)
    expect($<HTMLDialogElement>(el, 'dialog')?.open).toBe(false)
    expect(loadDraft(KEY, 'new')).toBeNull()
  })

  // The create is held, not the facets: an edit during the lookup stops the
  // send before the freeze (R4), so it would never reach the close (#232 review R5-N1).
  it('an earlier opening\'s send posts, but the reopened draft was edited: the dialog stays with the edit', async () => {
    const pds = signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'v1')
    const create = deferred<void>()
    const realCreate = pds.client.blueskyCreatePost.getMockImplementation()!
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      await create.promise
      return realCreate(record, rkey)
    })
    await submit(el)
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(1)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    await open(el)
    await type(el, 'v1 and more')
    create.resolve()
    await settle(el)
    expect([...pds.records.values()].map((r) => r.text)).toEqual(['v1'])
    expect($<HTMLDialogElement>(el, 'dialog')?.open).toBe(true)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('v1 and more')
  })
})

// #190: a Bluesky redraft, stored before its delete (app README, "Bluesky delete and redraft").
describe('Bluesky redraft', () => {
  const PARENT = { uri: bobPost().id, cid: 'bafyp1' }
  const QUOTED = { uri: 'at://did:plc:carol/app.bsky.feed.post/q1', cid: 'bafyq1' }
  const SLOT: DraftSlot = 'redraft:k1'
  const image = (id: string, link: string) => ({
    id, blob: { $type: 'blob' as const, ref: { $link: link }, mimeType: 'image/jpeg', size: 3 },
    mime: 'image/jpeg', size: 3, alt: `alt ${id}`, aspectRatio: { width: 4, height: 3 },
  })
  const redraft = (over: Partial<NonNullable<ReturnType<typeof emptyDraft>['bluesky']>> = {}) => emptyDraft({
    text: 'from the deleted post', language: 'de', inReplyToId: over.reply ? over.reply.parent.uri : null,
    bluesky: emptyBlueskyDraft({ labels: ['nudity'], images: [image('i1', 'bafkA')], rkey: '3kredraft0001', ...over }),
  })

  // As storeBlueskyRedraft leaves it: the draft and the image bytes.
  async function storeRedraft(over: Parameters<typeof redraft>[0] = {}) {
    saveDraft(KEY, SLOT, redraft(over))
    await putDraftFiles(KEY, SLOT, { i1: new Blob(['A'], { type: 'image/jpeg' }) })
  }

  async function openRedraft(el: CaribouComposeDialog) {
    const detail: { blueskyRedraft: { userKey: string; slot: DraftSlot }; opened?: boolean } = { blueskyRedraft: { userKey: KEY, slot: SLOT } }
    window.dispatchEvent(new CustomEvent('caribou:compose', { detail }))
    await settle(el)
    return detail.opened
  }

  // IndexedDB answers on its own schedule.
  async function untilPreview(el: CaribouComposeDialog) {
    for (let i = 0; i < 50 && !$(el, '[data-bsky-image="i1"] img'); i++) await settle(el)
  }

  beforeEach(async () => { await _testOnlyClearDraftFiles() })

  it('opens the stored slot: the draft, its images shown from the stored bytes, and its own rkey', async () => {
    const pds = signInBluesky()
    await storeRedraft()
    const el = await mount()
    expect(await openRedraft(el)).toBe(true)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('from the deleted post')
    await untilPreview(el)
    expect($(el, '[data-bsky-image="i1"] img')).not.toBeNull()
    expect(pds.client.blueskyNextRkey).not.toHaveBeenCalled()
    // No other draft: no "other unsent draft" note.
    expect($(el, '[data-redraft-note]')).toBeNull()
    await submit(el)
    expect(pds.client.blueskyCreatePost.mock.calls.map((c) => c[1])).toEqual(['3kredraft0001'])
    const sent = [...pds.records.values()][0]!
    expect(sent.langs).toEqual(['de'])
    expect(sent.labels).toEqual({ $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] })
    expect(sent.embed).toMatchObject({ $type: 'app.bsky.embed.images', images: [{ alt: 'alt i1', aspectRatio: { width: 4, height: 3 } }] })
  })

  it('after the post is sent and the dialog closes, the stored bytes go', async () => {
    signInBluesky()
    await storeRedraft()
    const el = await mount()
    await openRedraft(el)
    await untilPreview(el)
    await submit(el)
    for (let i = 0; i < 20; i++) await settle(el)
    expect(await getDraftFiles(KEY, SLOT)).toEqual({})
  })

  it('does not open while another composer is open, or for another account: the draft stays stored', async () => {
    signInBluesky()
    await storeRedraft()
    const el = await mount()
    // A reply composer is open (a new post would open the kept redraft itself).
    await open(el, { inReplyTo: bobPost() })
    expect(await openRedraft(el)).toBe(false)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('')
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    activeUserKey.value = null
    expect(await openRedraft(el)).toBe(false)
    expect(loadDraft(KEY, SLOT)!.text).toBe('from the deleted post')
  })

  it('says "other unsent draft" only when its own kind\'s slot holds one', async () => {
    signInBluesky()
    saveDraft(KEY, 'new', emptyDraft({ text: 'half written', bluesky: emptyBlueskyDraft({ rkey: '3krkeyHALF' }) }))
    await storeRedraft()
    const el = await mount()
    await openRedraft(el)
    expect($(el, '[data-redraft-note]')).not.toBeNull()
  })

  it('a redraft whose reply target is not cached: Post is off while it is read, and no create is sent', async () => {
    const pds = signInBluesky()
    const read = deferred<Status>()
    pds.client.fetchStatus.mockImplementationOnce(() => read.promise)
    await storeRedraft({ reply: { root: PARENT, parent: PARENT } })
    const el = await mount()
    await openRedraft(el)
    expect(pds.client.fetchStatus).toHaveBeenCalledWith(PARENT.uri)
    expect(postButton(el).disabled).toBe(true)
    expect($(el, '[data-compose-blocked]')!.textContent).toBe('Checking the post this replies to or quotes…')
    await submit(el)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
    read.resolve(bobPost({ replyDisabled: true }))
    await settle(el)
    expect($(el, '[data-compose-blocked]')!.textContent).toBe('The author limited replies. You cannot reply to this post.')
    expect(postButton(el).disabled).toBe(true)
  })

  it('a reply target read that answers deleted keeps Post off', async () => {
    const pds = signInBluesky()
    const read = deferred<Status>()
    pds.client.fetchStatus.mockImplementationOnce(() => read.promise)
    await storeRedraft({ reply: { root: PARENT, parent: PARENT } })
    const el = await mount()
    await openRedraft(el)
    await submit(el)
    read.resolve(Promise.reject(new CaribouError('not_found', 'gone', { status: 404 })) as unknown as Status)
    await settle(el)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
    expect($(el, '[data-compose-blocked]')!.textContent).toBe('The post you replied to was deleted.')
    expect(postButton(el).disabled).toBe(true)
  })

  it('a reply that also quotes: a gone quote says "quoted", not "replied to" (review N6)', async () => {
    const pds = signInBluesky()
    statusCache.value = new Map([[PARENT.uri, bobPost()], [QUOTED.uri, bobPost({}, QUOTED.uri)]])
    pds.client.fetchStatus.mockImplementation(async (id: string) => {
      if (id === QUOTED.uri) throw new CaribouError('not_found', 'gone', { status: 404 })
      return bobPost({}, id)
    })
    await storeRedraft({ reply: { root: PARENT, parent: PARENT }, quote: QUOTED })
    const el = await mount()
    await openRedraft(el)
    expect($(el, '[data-compose-blocked]')!.textContent).toBe('The post you quoted was deleted.')
  })

  it('a quote redraft keeps its ref', async () => {
    const pds = signInBluesky()
    await storeRedraft({ quote: QUOTED, images: [] })
    const el = await mount()
    await openRedraft(el)
    await submit(el)
    expect([...pds.records.values()][0]!.embed).toEqual({ $type: 'app.bsky.embed.record', record: QUOTED })
  })

  it('a kept redraft opens with the next new post, and reads the post it replies to', async () => {
    const pds = signInBluesky()
    await storeRedraft({ reply: { root: PARENT, parent: PARENT } })
    const el = await mount()
    await open(el)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('from the deleted post')
    expect(pds.client.fetchStatus).toHaveBeenCalledWith(PARENT.uri)
  })

  it('a dropped blob is uploaded again from the stored bytes, after a close and a reopen', async () => {
    const pds = signInBluesky()
    await storeRedraft()
    let el = await mount()
    await openRedraft(el)
    $(el, '[data-action="cancel"]')!.click()
    await settle(el)
    // A reload: a new dialog with nothing in memory.
    el.remove()
    el = await mount()
    await open(el)
    await untilPreview(el)
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new BlueskyBlobNotFound('Could not find blob: bafkA', 'bafkA'))
    await submit(el)
    expect(pds.client.blueskyUploadBlob).toHaveBeenCalledTimes(1)
    expect(await pds.client.blueskyUploadBlob.mock.calls[0]![0].text()).toBe('A')
    expect(toasts.at(-1)!.message).toBe('An image was uploaded again. Post again to send.')
    expect($(el, '[data-bsky-image] .state')).toBeNull()
  })

  it('the label menu offers Suggestive (sexual), as the official app does', async () => {
    signInBluesky()
    await storeRedraft({ labels: [] })
    const el = await mount()
    await openRedraft(el)
    const names = [...el.shadowRoot!.querySelectorAll('caribou-menu.labels button, [data-label]')].map((b) => b.textContent?.trim())
    expect(names.join(' ')).toContain('Suggestive')
  })
})
