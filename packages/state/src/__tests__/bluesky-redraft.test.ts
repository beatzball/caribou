import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueskyOwnPost, BlueskyPostRecord, CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, deletedStatusIds, statusCache } from '../caches.js'
import { activeUserKey } from '../users.js'
import { ownerGeneration } from '../keep-alive.js'
import { deleteOwnStatus, deleteOwnStatusOutcome } from '../own-posts.js'
import {
  discardBlueskyRedraft, readBlueskyRedraft, redraftTextOf, storeBlueskyRedraft, type PreparedImage,
} from '../bluesky-redraft.js'
import { findRedraftSlot, loadDraft } from '../compose.js'
import { getDraftFiles, _testOnlyClearDraftFiles, _testOnlyFailNextPut } from '../draft-files.js'

const DID = 'did:plc:reader'
const KEY = `${DID}@bsky` as const
const URI = `at://${DID}/app.bsky.feed.post/3kold`
const PARENT = { uri: 'at://did:plc:bob/app.bsky.feed.post/p1', cid: 'bafyparent' }
const ROOT = { uri: 'at://did:plc:bob/app.bsky.feed.post/p0', cid: 'bafyroot' }
const QUOTED = { uri: 'at://did:plc:carol/app.bsky.feed.post/q1', cid: 'bafyquoted' }

function post(over: Partial<Status> = {}, uri = URI): Status {
  return {
    id: uri, uri, content: '<p>hi</p>', visibility: 'public', spoilerText: '',
    account: { id: DID, acct: 'reader.example.com', username: 'reader.example.com' },
    bluesky: { uri, cid: 'bafyold', likeUri: null, repostUri: null, replyRef: null },
    ...over,
  } as unknown as Status
}

function repost(id: string, of: Status): Status {
  return { ...post({}, id), reblog: of, account: { id: 'did:plc:bob', acct: 'bob', username: 'bob' } } as unknown as Status
}

// An SDK-shaped blob: the ref is a CID object, not `{ $link }`.
function sdkBlob(cid: string, mimeType = 'image/jpeg', size = 3) {
  return { $type: 'blob', ref: { toString: () => cid }, mimeType, size }
}

const RECORD = {
  $type: 'app.bsky.feed.post',
  text: 'hello world',
  createdAt: '2026-11-01T00:00:00.000Z',
} as BlueskyPostRecord

function fakeClient(record: BlueskyPostRecord | null = RECORD) {
  const uploads: Blob[] = []
  const c = {
    userKey: KEY,
    blueskyGetOwnPost: vi.fn(async (rkey: string): Promise<BlueskyOwnPost | null> =>
      record ? { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: 'bafyold', value: record } : null),
    // A PDS may type a blob as octet-stream: the record's type wins.
    blueskyGetBlob: vi.fn(async (cid: string) => new Blob([`bytes of ${cid}`], { type: 'application/octet-stream' })),
    blueskyNextRkey: vi.fn(async () => '3knewkey00001'),
    fetchStatus: vi.fn(async (id: string): Promise<Status> => post({}, id)),
    blueskyDeletePost: vi.fn(async () => {}),
    blueskyUploadBlob: vi.fn(async (b: Blob) => {
      uploads.push(b)
      const text = await b.text()
      return { $type: 'blob' as const, ref: { $link: `new-${text}` }, mimeType: b.type, size: b.size }
    }),
    deleteStatus: vi.fn(async () => { throw new Error('not for Bluesky') }),
  }
  return { client: c as unknown as CaribouClient, c, uploads }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const toasts: string[] = []
const onToast = (e: Event) => { toasts.push((e as CustomEvent<{ message: string }>).detail.message) }

// The canvas re-encode, as the card passes it: new bytes, so a new CID.
const prepareImage = vi.fn(async (b: Blob): Promise<PreparedImage> =>
  ({ blob: new Blob([`re ${await b.text()}`], { type: 'image/jpeg' }), width: 8, height: 6 }))

beforeEach(async () => {
  await _testOnlyClearDraftFiles()
  localStorage.clear()
  prepareImage.mockClear()
  activeUserKey.value = KEY
  ownerGeneration()
  statusCache.value = new Map()
  deletedStatusIds.value = new Set()
  toasts.length = 0
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => { window.removeEventListener('caribou:toast', onToast) })

describe('deleteOwnStatus, Bluesky', () => {
  it('deletes the record by its URI; the post and its reposts leave the cache; resolves to the post', async () => {
    const { client, c } = fakeClient()
    const p = post()
    cacheStatus(p)
    cacheStatus(repost('at://did:plc:bob/app.bsky.feed.repost/r1', p))
    const out = await deleteOwnStatus(client, p)
    expect(c.blueskyDeletePost).toHaveBeenCalledWith(URI)
    expect(c.deleteStatus).not.toHaveBeenCalled()
    expect(out).toBe(p)
    expect(statusCache.value.size).toBe(0)
    expect(deletedStatusIds.value.has(URI)).toBe(true)
  })

  it('a refusal brings everything back and says so', async () => {
    const { client, c } = fakeClient()
    c.blueskyDeletePost.mockRejectedValueOnce(new Error('500'))
    const p = post()
    cacheStatus(p)
    expect(await deleteOwnStatus(client, p)).toBeNull()
    expect(statusCache.value.get(URI)).toBeDefined()
    expect(deletedStatusIds.value.has(URI)).toBe(false)
    expect(toasts).toEqual(['Could not delete this post. Try again.'])
  })

  it('a late answer after an account switch writes nothing', async () => {
    const { client, c } = fakeClient()
    const d = deferred<void>()
    c.blueskyDeletePost.mockImplementationOnce(() => d.promise)
    const p = post()
    cacheStatus(p)
    const out = deleteOwnStatus(client, p)
    activeUserKey.value = 'did:plc:other@bsky'
    d.reject(new Error('500'))
    expect(await out).toBeNull()
    expect(toasts).toEqual([])
  })
})

describe('deleteOwnStatusOutcome, Bluesky', () => {
  it('a delete in doubt (BlueskyDeleteUnknown): the post comes back and the toast does not say "not deleted"', async () => {
    const { client, c } = fakeClient()
    c.blueskyDeletePost.mockRejectedValueOnce(Object.assign(new Error('?'), { name: 'BlueskyDeleteUnknown' }))
    const p = post()
    cacheStatus(p)
    expect(await deleteOwnStatusOutcome(client, p)).toEqual({ kind: 'unknown', stale: false })
    expect(statusCache.value.has(URI)).toBe(true)
    expect(toasts).toEqual(['Could not tell whether the post was deleted. Reload to check.'])
  })

  it('takes the caller\'s messages, and says nothing after an account switch but still answers the outcome', async () => {
    const { client, c } = fakeClient()
    c.blueskyDeletePost.mockRejectedValueOnce(new Error('400'))
    const p = post()
    expect(await deleteOwnStatusOutcome(client, p, { messages: { failed: 'F' } })).toEqual({ kind: 'failed', stale: false })
    expect(toasts).toEqual(['F'])
    const d = deferred<void>()
    c.blueskyDeletePost.mockImplementationOnce(() => d.promise)
    const out = deleteOwnStatusOutcome(client, p)
    activeUserKey.value = 'did:plc:other@bsky'
    d.resolve()
    expect(await out).toMatchObject({ kind: 'deleted', stale: true })
    expect(toasts).toEqual(['F'])
  })
})

const IMG_RECORD = {
  ...RECORD,
  embed: { $type: 'app.bsky.embed.images', images: [{ image: sdkBlob('bafkA', 'image/png'), alt: 'a cat' }] },
} as unknown as BlueskyPostRecord

describe('readBlueskyRedraft', () => {
  it('reads the record by the post rkey, and each image\'s bytes typed from the record', async () => {
    const record = {
      ...RECORD,
      embed: { $type: 'app.bsky.embed.images', images: [
        { image: sdkBlob('bafkA'), alt: 'a cat' },
        { image: { $type: 'blob', ref: { $link: 'bafkB' }, mimeType: 'image/png', size: 9 }, alt: '' },
      ] },
    } as unknown as BlueskyPostRecord
    const { client, c } = fakeClient(record)
    const source = await readBlueskyRedraft(client, post())
    expect(c.blueskyGetOwnPost).toHaveBeenCalledWith('3kold')
    expect(c.blueskyGetBlob.mock.calls.map((x) => x[0])).toEqual(['bafkA', 'bafkB'])
    expect(source!.record).toBe(record)
    expect([...source!.files.values()].map((b) => b.type)).toEqual(['image/jpeg', 'image/png'])
    expect(source!.targets).toEqual({ reply: null, quote: null })
    expect(c.blueskyDeletePost).not.toHaveBeenCalled()
  })

  it('checks the reply parent and the quoted post: ok, gone, limited, or unknown', async () => {
    const record = { ...RECORD, reply: { root: ROOT, parent: PARENT }, embed: { $type: 'app.bsky.embed.record', record: QUOTED } } as unknown as BlueskyPostRecord
    const { client, c } = fakeClient(record)
    expect((await readBlueskyRedraft(client, post()))!.targets).toEqual({ reply: 'ok', quote: 'ok' })
    c.fetchStatus.mockImplementation(async (id: string) => {
      if (id === PARENT.uri) throw Object.assign(new Error('gone'), { code: 'not_found' })
      return post({ bluesky: { uri: id, embeddingDisabled: true } } as unknown as Partial<Status>, id)
    })
    expect((await readBlueskyRedraft(client, post()))!.targets).toEqual({ reply: 'gone', quote: 'limited' })
    c.fetchStatus.mockImplementation(async (id: string) => {
      if (id === PARENT.uri) return post({ bluesky: { uri: id, replyDisabled: true } } as unknown as Partial<Status>, id)
      throw new Error('502')
    })
    expect((await readBlueskyRedraft(client, post()))!.targets).toEqual({ reply: 'limited', quote: 'unknown' })
  })

  it('a feed, list or starter pack in embed.record is not a quote: not read, not kept', async () => {
    const feed = { uri: 'at://did:plc:carol/app.bsky.feed.generator/deer', cid: 'bafyfeed' }
    const { client, c } = fakeClient({ ...RECORD, embed: { $type: 'app.bsky.embed.record', record: feed } } as unknown as BlueskyPostRecord)
    expect((await readBlueskyRedraft(client, post()))!.targets).toEqual({ reply: null, quote: null })
    expect(c.fetchStatus).not.toHaveBeenCalled()
  })

  it('throws, and deletes nothing, when the record is not there', async () => {
    const { client, c } = fakeClient(null)
    await expect(readBlueskyRedraft(client, post())).rejects.toThrow()
    expect(c.blueskyDeletePost).not.toHaveBeenCalled()
  })

  it('throws when the record read fails, or an image cannot be read', async () => {
    const { client, c } = fakeClient(IMG_RECORD)
    c.blueskyGetOwnPost.mockRejectedValueOnce(new Error('502'))
    await expect(readBlueskyRedraft(client, post())).rejects.toThrow('502')
    c.blueskyGetBlob.mockRejectedValueOnce(new Error('blob 502'))
    await expect(readBlueskyRedraft(client, post())).rejects.toThrow('blob 502')
  })

  it('refuses a post that is not in the reader\'s repo (same rkey elsewhere)', async () => {
    const { client, c } = fakeClient()
    await expect(readBlueskyRedraft(client, post({}, 'at://did:plc:bob/app.bsky.feed.post/3kold'))).rejects.toThrow()
    expect(c.blueskyGetBlob).not.toHaveBeenCalled()
  })

  it('resolves null after an account switch', async () => {
    const { client, c } = fakeClient()
    const d = deferred<BlueskyOwnPost | null>()
    c.blueskyGetOwnPost.mockImplementationOnce(() => d.promise)
    const out = readBlueskyRedraft(client, post())
    activeUserKey.value = 'did:plc:other@bsky'
    d.resolve({ uri: URI, cid: 'bafyold', value: RECORD })
    expect(await out).toBeNull()
  })
})

describe('storeBlueskyRedraft', () => {
  const full = {
    $type: 'app.bsky.feed.post',
    text: 'see example.com/long… and @bob.example.com',
    facets: [],
    reply: { root: ROOT, parent: PARENT },
    embed: {
      $type: 'app.bsky.embed.recordWithMedia',
      record: { $type: 'app.bsky.embed.record', record: QUOTED },
      media: { $type: 'app.bsky.embed.images', images: [
        { image: sdkBlob('bafkA'), alt: 'a cat', aspectRatio: { width: 4, height: 3 } },
        { image: sdkBlob('bafkB', 'image/png', 9), alt: '' },
      ] },
    },
    labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'sexual' }, { val: 'something-else' }] },
    langs: ['de', 'en'],
    createdAt: '2026-11-01T00:00:00.000Z',
  } as unknown as BlueskyPostRecord

  async function stored(record: BlueskyPostRecord = full) {
    const f = fakeClient(record)
    const source = (await readBlueskyRedraft(f.client, post()))!
    return { ...f, source, out: await storeBlueskyRedraft(f.client, source, { prepareImage }) }
  }

  it('stores the whole draft before any delete: text, refs, re-encoded images, labels, language, a new rkey', async () => {
    const { c, out } = await stored()
    expect(c.blueskyDeletePost).not.toHaveBeenCalled()
    expect(out!.userKey).toBe(KEY)
    expect(out!.slot).toMatch(/^redraft:/)
    const d = loadDraft(KEY, out!.slot)!
    expect(d.text).toBe(full.text)
    expect(d.language).toBe('de')
    expect(d.inReplyToId).toBe(PARENT.uri)
    expect(d.bluesky!.reply).toEqual({ root: ROOT, parent: PARENT })
    expect(d.bluesky!.quote).toEqual(QUOTED)
    expect(d.bluesky!.labels).toEqual(['sexual', 'something-else'])
    expect(d.bluesky!.rkey).toBe('3knewkey00001')
    expect(d.bluesky!.sent).toBeNull()
    // New bytes, so new CIDs: the delete cannot take them with the old record.
    expect(d.bluesky!.images.map((i) => [i.blob.ref.$link, i.alt, i.aspectRatio, i.mime])).toEqual([
      ['new-re bytes of bafkA', 'a cat', { width: 4, height: 3 }, 'image/jpeg'],
      ['new-re bytes of bafkB', '', { width: 8, height: 6 }, 'image/jpeg'],
    ])
    // The re-encoded bytes are stored with the draft, by image id.
    const files = await getDraftFiles(KEY, out!.slot)
    expect(Object.keys(files).sort()).toEqual(d.bluesky!.images.map((i) => i.id).sort())
    expect(await files[d.bluesky!.images[0]!.id]!.text()).toBe('re bytes of bafkA')
    // A new post opens it first.
    expect(findRedraftSlot(KEY)).toBe(out!.slot)
  })

  it('a feed in recordWithMedia is not kept as a quote; its images are', async () => {
    const feed = { uri: 'at://did:plc:carol/app.bsky.graph.starterpack/sp', cid: 'bafysp' }
    const { out } = await stored({ ...full, reply: undefined, embed: { ...(full.embed as object), record: { $type: 'app.bsky.embed.record', record: feed } } } as unknown as BlueskyPostRecord)
    const d = loadDraft(KEY, out!.slot)!
    expect(d.bluesky!.quote).toBeNull()
    expect(d.bluesky!.images).toHaveLength(2)
  })

  it.each([
    ['the re-encode', (c: ReturnType<typeof fakeClient>['c']) => { void c; prepareImage.mockRejectedValueOnce(new Error('canvas')) }],
    ['an upload', (c: ReturnType<typeof fakeClient>['c']) => { c.blueskyUploadBlob.mockRejectedValueOnce(new Error('upload 502')) }],
    ['the rkey', (c: ReturnType<typeof fakeClient>['c']) => { c.blueskyNextRkey.mockRejectedValueOnce(new Error('no rkey')) }],
  ])('%s fails: it throws, and nothing is stored', async (_, fail) => {
    const f = fakeClient(full)
    const source = (await readBlueskyRedraft(f.client, post()))!
    fail(f.c)
    await expect(storeBlueskyRedraft(f.client, source, { prepareImage })).rejects.toThrow()
    expect(findRedraftSlot(KEY)).toBeNull()
  })

  it('storage refuses the draft: it throws, and no bytes are kept', async () => {
    const f = fakeClient(full)
    const source = (await readBlueskyRedraft(f.client, post()))!
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    try {
      await expect(storeBlueskyRedraft(f.client, source, { prepareImage })).rejects.toThrow()
    } finally {
      spy.mockRestore()
    }
    expect(findRedraftSlot(KEY)).toBeNull()
  })

  it('IndexedDB refuses the bytes: the draft is removed again, and it throws', async () => {
    const f = fakeClient(full)
    const source = (await readBlueskyRedraft(f.client, post()))!
    _testOnlyFailNextPut()
    await expect(storeBlueskyRedraft(f.client, source, { prepareImage })).rejects.toThrow()
    expect(findRedraftSlot(KEY)).toBeNull()
  })

  it('an account switch during an upload stores nothing', async () => {
    const f = fakeClient(full)
    const source = (await readBlueskyRedraft(f.client, post()))!
    const d = deferred<never>()
    f.c.blueskyUploadBlob.mockImplementationOnce(() => d.promise)
    const out = storeBlueskyRedraft(f.client, source, { prepareImage })
    await vi.waitFor(() => expect(f.c.blueskyUploadBlob).toHaveBeenCalled())
    activeUserKey.value = 'did:plc:other@bsky'
    d.reject(new Error('x'))
    expect(await out).toBeNull()
    activeUserKey.value = KEY
    expect(findRedraftSlot(KEY)).toBeNull()
  })

  it('reads an odd record without throwing: wrong-typed labels, facets and images are skipped', async () => {
    const odd = {
      $type: 'app.bsky.feed.post', text: 'odd', createdAt: 't',
      facets: [{ index: { byteStart: 0, byteEnd: 1 } }, null],
      labels: { values: ['porn', null, { val: 7 }, { val: 'nudity' }] },
      langs: 'en',
      embed: { $type: 'app.bsky.embed.images', images: 'nope' },
      reply: { root: 'x' },
    } as unknown as BlueskyPostRecord
    const { out } = await stored(odd)
    const d = loadDraft(KEY, out!.slot)!
    expect(d.text).toBe('odd')
    expect(d.bluesky!.labels).toEqual(['nudity'])
    expect(d.bluesky!.images).toEqual([])
    expect(d.bluesky!.reply).toBeNull()
    expect(d.language ?? null).toBeNull()
  })

  it('discard removes the stored draft and its bytes', async () => {
    const { out } = await stored()
    await discardBlueskyRedraft(out!)
    expect(loadDraft(KEY, out!.slot)).toBeNull()
    expect(await getDraftFiles(KEY, out!.slot)).toEqual({})
  })
})

describe('redraftTextOf', () => {
  const enc = new TextEncoder()
  const link = (text: string, shown: string, uri: string) => {
    const start = enc.encode(text.slice(0, text.indexOf(shown))).length
    return { index: { byteStart: start, byteEnd: start + enc.encode(shown).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] }
  }

  it('puts back the full URL of a link whose shown text is shortened', () => {
    const text = 'read 🦌 example.com/a-very-lo... now'
    const facets = [link(text, 'example.com/a-very-lo...', 'https://example.com/a-very-long-path')]
    expect(redraftTextOf(text, facets)).toBe('read 🦌 https://example.com/a-very-long-path now')
  })

  it('keeps a link that the text already makes again', () => {
    const text = 'a https://example.com/x and example.com'
    const facets = [link(text, 'https://example.com/x', 'https://example.com/x'), link(text, 'example.com', 'https://example.com')]
    expect(redraftTextOf(text, facets)).toBe(text)
  })

  it('keeps mentions and tags as typed, and ignores a facet out of range', () => {
    const text = 'hi @bob.example.com #deer'
    const facets = [
      { index: { byteStart: 3, byteEnd: 19 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:bob' }] },
      { index: { byteStart: 20, byteEnd: 999 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://x.example' }] },
    ]
    expect(redraftTextOf(text, facets)).toBe(text)
  })
})
