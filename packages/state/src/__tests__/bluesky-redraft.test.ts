import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueskyOwnPost, BlueskyPostRecord, CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, deletedStatusIds, statusCache } from '../caches.js'
import { activeUserKey } from '../users.js'
import { ownerGeneration } from '../keep-alive.js'
import { deleteOwnStatus } from '../own-posts.js'
import { finishBlueskyRedraft, readBlueskyRedraft, redraftTextOf } from '../bluesky-redraft.js'

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
    blueskyGetBlob: vi.fn(async (cid: string) => new Blob([`bytes of ${cid}`], { type: 'image/jpeg' })),
    blueskyDeletePost: vi.fn(async () => {}),
    blueskyUploadBlob: vi.fn(async (b: Blob) => {
      uploads.push(b)
      const text = await b.text()
      return { $type: 'blob' as const, ref: { $link: text.replace('bytes of ', '') }, mimeType: b.type, size: b.size }
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

beforeEach(() => {
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

describe('readBlueskyRedraft', () => {
  it('reads the record by the post rkey from the PDS, and each image\'s bytes', async () => {
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
    expect([...source!.files.keys()]).toEqual(['bafkA', 'bafkB'])
    expect(c.blueskyDeletePost).not.toHaveBeenCalled()
  })

  it('throws, and deletes nothing, when the record is not there', async () => {
    const { client, c } = fakeClient(null)
    await expect(readBlueskyRedraft(client, post())).rejects.toThrow()
    expect(c.blueskyDeletePost).not.toHaveBeenCalled()
  })

  it('throws when the record read fails, or an image cannot be read', async () => {
    const { client, c } = fakeClient({
      ...RECORD, embed: { $type: 'app.bsky.embed.images', images: [{ image: sdkBlob('bafkA'), alt: '' }] },
    } as unknown as BlueskyPostRecord)
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

describe('finishBlueskyRedraft', () => {
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
    labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }, { val: 'something-else' }] },
    langs: ['de', 'en'],
    createdAt: '2026-11-01T00:00:00.000Z',
  } as unknown as BlueskyPostRecord

  it('builds a new draft: text, reply and quote refs, images uploaded again with alt, labels, language; no rkey', async () => {
    const { client, c } = fakeClient(full)
    const source = (await readBlueskyRedraft(client, post()))!
    const out = (await finishBlueskyRedraft(client, source))!
    expect(c.blueskyUploadBlob).toHaveBeenCalledTimes(2)
    const d = out.draft
    expect(d.text).toBe(full.text)
    expect(d.language).toBe('de')
    expect(d.inReplyToId).toBe(PARENT.uri)
    expect(d.bluesky!.reply).toEqual({ root: ROOT, parent: PARENT })
    expect(d.bluesky!.quote).toEqual(QUOTED)
    expect(d.bluesky!.labels).toEqual(['nudity'])
    expect(d.bluesky!.rkey).toBeNull()
    expect(d.bluesky!.sent).toBeNull()
    expect(d.bluesky!.images.map((i) => [i.blob.ref.$link, i.alt, i.aspectRatio, i.mime])).toEqual([
      ['bafkA', 'a cat', { width: 4, height: 3 }, 'image/jpeg'],
      ['bafkB', '', null, 'image/jpeg'],
    ])
    // The dialog gets the bytes by image id, for its previews and its blob recovery.
    expect(Object.keys(out.files).sort()).toEqual(d.bluesky!.images.map((i) => i.id).sort())
  })

  it('an upload that fails keeps the old blob ref, and its bytes go to the dialog', async () => {
    const { client, c } = fakeClient(full)
    const source = (await readBlueskyRedraft(client, post()))!
    c.blueskyUploadBlob.mockRejectedValueOnce(new Error('upload 502'))
    const out = (await finishBlueskyRedraft(client, source))!
    const imgs = out.draft.bluesky!.images
    expect(imgs[0]!.blob).toEqual({ $type: 'blob', ref: { $link: 'bafkA' }, mimeType: 'image/jpeg', size: 3 })
    expect(await out.files[imgs[0]!.id]!.text()).toBe('bytes of bafkA')
  })

  it('a plain quote, and a plain images embed', async () => {
    const quote = { ...RECORD, embed: { $type: 'app.bsky.embed.record', record: QUOTED } } as unknown as BlueskyPostRecord
    let { client } = fakeClient(quote)
    let out = (await finishBlueskyRedraft(client, (await readBlueskyRedraft(client, post()))!))!
    expect(out.draft.bluesky!.quote).toEqual(QUOTED)
    expect(out.draft.bluesky!.images).toEqual([])
    expect(out.draft.inReplyToId).toBeNull()
    const imgs = { ...RECORD, embed: { $type: 'app.bsky.embed.images', images: [{ image: sdkBlob('bafkA'), alt: 'x' }] } } as unknown as BlueskyPostRecord
    ;({ client } = fakeClient(imgs))
    out = (await finishBlueskyRedraft(client, (await readBlueskyRedraft(client, post()))!))!
    expect(out.draft.bluesky!.quote).toBeNull()
    expect(out.draft.bluesky!.images.map((i) => i.alt)).toEqual(['x'])
  })

  it('an external card or a video is not kept', async () => {
    const ext = { ...RECORD, embed: { $type: 'app.bsky.embed.external', external: { uri: 'https://example.com', title: '', description: '' } } } as unknown as BlueskyPostRecord
    const { client, c } = fakeClient(ext)
    const out = (await finishBlueskyRedraft(client, (await readBlueskyRedraft(client, post()))!))!
    expect(out.draft.bluesky!.images).toEqual([])
    expect(out.draft.bluesky!.quote).toBeNull()
    expect(c.blueskyGetBlob).not.toHaveBeenCalled()
  })

  it('resolves null after an account switch during an upload', async () => {
    const { client, c } = fakeClient(full)
    const source = (await readBlueskyRedraft(client, post()))!
    const d = deferred<never>()
    c.blueskyUploadBlob.mockImplementationOnce(() => d.promise)
    const out = finishBlueskyRedraft(client, source)
    activeUserKey.value = 'did:plc:other@bsky'
    d.reject(new Error('x'))
    expect(await out).toBeNull()
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
