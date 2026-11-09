import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeUserKey, addUserSession, blueskyUserKey, emptyBlueskyDraft, emptyDraft, loadDraft, saveDraft,
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

const fit = vi.hoisted(() => ({ result: null as null | ((f: Blob) => FitResult) }))
vi.mock('../_image-fit.js', () => ({
  fitImage: vi.fn(async (f: Blob) => fit.result
    ? fit.result(f)
    : { ok: true, blob: f, width: 4, height: 3, resized: false }),
}))

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
  const loseNext = { value: false }
  const client = {
    userKey: KEY,
    capabilities: BLUESKY_CAPABILITIES,
    timelineOrder: () => null,
    blueskyNextRkey: vi.fn(async () => `3krkey${String(++n).padStart(7, '0')}`),
    blueskyDetectFacets: vi.fn(async () => []),
    blueskyUploadBlob: vi.fn(async (b: Blob) => ({ $type: 'blob' as const, ref: { $link: `bafkblob${++blobs}` }, mimeType: b.type || 'image/jpeg', size: b.size })),
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
    expect($(el, '[data-limit-status]')!.textContent).toBe('Over the 3000 byte limit')
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

  it('the first send times out but the record was written: one post, no second create', async () => {
    const pds = signInBluesky()
    pds.loseNext.value = true
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
    addUserSession({
      userKey: 'alice@example.social', server: 'example.social', token: 'T', vapidKey: '', account: null, createdAt: 1,
    } as unknown as UserSession)
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
    expect(pds.client.blueskyUploadBlob).toHaveBeenCalledTimes(2)
    expect(loadDraft(KEY, 'new')!.bluesky!.images[0]!.blob.ref.$link).toBe('bafkblob2')
    await submit(el)
    expect(pds.records.size).toBe(1)
    const sent = [...pds.records.values()][0]!
    expect((sent.embed as unknown as { images: { image: { ref: { $link: string } } }[] }).images[0]!.image.ref.$link).toBe('bafkblob2')
  })

  it('after a reload a dropped blob has no file: it asks for the image again', async () => {
    const pds = signInBluesky()
    saveDraft(KEY, 'new', emptyDraft({
      text: 'old photo',
      bluesky: emptyBlueskyDraft({ images: [{ blob: { $type: 'blob', ref: { $link: 'bafkold' }, mimeType: 'image/jpeg', size: 9 }, mime: 'image/jpeg', size: 9, alt: 'old', aspectRatio: null, name: 'old.jpg' }] }),
    }))
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new BlueskyBlobNotFound('Could not find blob: bafkold', 'bafkold'))
    const el = await mount()
    await open(el)
    await submit(el)
    expect($(el, '[data-bsky-image="bafkold"] .state')!.textContent).toContain('Not on the server any more')
    expect(postButton(el).disabled).toBe(true)
  })
})

describe('Bluesky compose: account and session', () => {
  it('an account switch closes the dialog and keeps the draft for its account', async () => {
    signInBluesky()
    const el = await mount()
    await open(el)
    await type(el, 'mine')
    addUserSession({
      userKey: 'alice@example.social', server: 'example.social', token: 'T', vapidKey: '', account: null, createdAt: 1,
    } as unknown as UserSession)
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(false)
    expect(loadDraft(KEY, 'new')!.text).toBe('mine')
  })
})
