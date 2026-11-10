import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueskyGates, BlueskyOwnPost, BlueskyPostRecord, CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, deletedStatusIds, statusCache } from '../caches.js'
import { activeUserKey } from '../users.js'
import { ownerGeneration } from '../keep-alive.js'
import { deleteOwnStatus, deleteOwnStatusOutcome } from '../own-posts.js'
import {
  BlueskyRedraftGatesUnread, BlueskyRedraftGone, NOTHING_KEPT, STAGED_MAX_AGE_MS, checkRedraftSource, discardBlueskyRedraft, _testOnlyForgetStaging,
  findRedraftOf, hasOrphanStagedRedrafts, readBlueskyRedraft,
  recoverStagedRedrafts, redraftDropsGates, redraftKeepsSomething, redraftTextOf, settleBlueskyRedraft, storeBlueskyRedraft, type PreparedImage,
} from '../bluesky-redraft.js'
import {
  emptyDraft, findRedraftSlot, loadDraft, patchRevealed, renameDraftIf, saveDraft, storedDrafts, _testOnlyForgetRevealed, type DraftSlot,
} from '../compose.js'
import { emptyBlueskyDraft } from '../bluesky-compose.js'
import { getDraftFiles, pruneDraftFiles, _testOnlyClearDraftFiles, _testOnlyFailNextPut } from '../draft-files.js'

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
    blueskyGetOwnGates: vi.fn(async (_rkey: string): Promise<BlueskyGates> => ({ replies: null, quotes: true })),
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

async function putDraftFilesFor(slot: DraftSlot) {
  const { putDraftFiles } = await import('../draft-files.js')
  await putDraftFiles(KEY, slot, { i1: new Blob(['bytes']) })
}

const toasts: string[] = []
const onToast = (e: Event) => { toasts.push((e as CustomEvent<{ message: string }>).detail.message) }

// The canvas re-encode, as the card passes it: new bytes, so a new CID.
const prepareImage = vi.fn(async (b: Blob): Promise<PreparedImage> =>
  ({ blob: new Blob([`re ${await b.text()}`], { type: 'image/jpeg' }), width: 8, height: 6 }))

beforeEach(async () => {
  await _testOnlyClearDraftFiles()
  _testOnlyForgetRevealed()
  _testOnlyForgetStaging()
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

  it('throws BlueskyRedraftGone, and deletes nothing, when the record is not there', async () => {
    const { client, c } = fakeClient(null)
    await expect(readBlueskyRedraft(client, post())).rejects.toThrow(BlueskyRedraftGone)
    await expect(readBlueskyRedraft(client, post())).rejects.toThrow('This post is already deleted.')
    expect(c.blueskyDeletePost).not.toHaveBeenCalled()
  })

  it('a target answer after an account switch writes nothing to the caches (D2)', async () => {
    const record = { ...RECORD, reply: { root: ROOT, parent: PARENT }, embed: { $type: 'app.bsky.embed.record', record: QUOTED } } as unknown as BlueskyPostRecord
    const { client, c } = fakeClient(record)
    const held = [deferred<Status>(), deferred<Status>()]
    let n = 0
    c.fetchStatus.mockImplementation(() => held[n++]!.promise)
    const out = readBlueskyRedraft(client, post())
    await vi.waitFor(() => expect(c.fetchStatus).toHaveBeenCalledTimes(2))
    activeUserKey.value = 'did:plc:other@bsky'
    held[0]!.resolve(post({}, PARENT.uri))
    held[1]!.resolve(post({}, QUOTED.uri))
    expect(await out).toBeNull()
    expect(statusCache.value.size).toBe(0)
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

// #262: a redraft keeps the post's reply and quote limits.
describe('redraft and the reply and quote limits', () => {
  const LIMITS: BlueskyGates = { replies: [{ kind: 'following' }, { kind: 'list', id: '3klist' }], quotes: false }

  it('reads the limits by the post rkey, with the record', async () => {
    const { client, c } = fakeClient()
    c.blueskyGetOwnGates.mockResolvedValueOnce(LIMITS)
    const source = await readBlueskyRedraft(client, post())
    expect(c.blueskyGetOwnGates).toHaveBeenCalledWith('3kold')
    expect(source!.gates).toEqual(LIMITS)
  })

  it('a failed limits read says so, and nothing is deleted or stored', async () => {
    const { client, c } = fakeClient()
    c.blueskyGetOwnGates.mockRejectedValueOnce(new Error('502'))
    const err = await readBlueskyRedraft(client, post()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BlueskyRedraftGatesUnread)
    expect((err as Error).message).toBe("Could not read the post's reply and quote limits, so it was not deleted.")
    expect(c.blueskyDeletePost).not.toHaveBeenCalled()
    expect(storedDrafts(KEY)).toEqual([])
  })

  it('a top-level post: the draft opens with its limits', async () => {
    const { client, c } = fakeClient()
    c.blueskyGetOwnGates.mockResolvedValueOnce(LIMITS)
    const source = (await readBlueskyRedraft(client, post()))!
    expect(redraftDropsGates(source)).toBe(false)
    const out = await storeBlueskyRedraft(client, source, { prepareImage })
    expect(out!.draft.bluesky!.gates).toEqual(LIMITS)
    expect(loadDraft(KEY, out!.slot)!.bluesky!.gates).toEqual(LIMITS)
  })

  it('no limits: the draft has no gates key (G2)', async () => {
    const { client } = fakeClient()
    const source = (await readBlueskyRedraft(client, post()))!
    const out = await storeBlueskyRedraft(client, source, { prepareImage })
    expect(out!.draft.bluesky).not.toHaveProperty('gates')
  })

  it('a reply: the draft gets no limits (G1)', async () => {
    const { client, c } = fakeClient({ ...RECORD, reply: { root: ROOT, parent: PARENT } } as unknown as BlueskyPostRecord)
    c.blueskyGetOwnGates.mockResolvedValueOnce({ replies: null, quotes: false })
    const source = (await readBlueskyRedraft(client, post()))!
    expect(source.gates).toEqual({ replies: null, quotes: false })
    expect(redraftDropsGates(source)).toBe(true)
    const out = await storeBlueskyRedraft(client, source, { prepareImage })
    expect(out!.draft.bluesky).not.toHaveProperty('gates')
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
    expect(out!.slot).toMatch(/^staged:/)
    expect(out!.redraftSlot).toBe(`redraft:${out!.slot.slice('staged:'.length)}`)
    const d = loadDraft(KEY, out!.slot)!
    expect(d.text).toBe(full.text)
    expect(d.language).toBe('de')
    expect(d.inReplyToId).toBe(PARENT.uri)
    expect(d.bluesky!.reply).toEqual({ root: ROOT, parent: PARENT })
    expect(d.bluesky!.quote).toEqual(QUOTED)
    expect(d.bluesky!.labels).toEqual(['sexual', 'something-else'])
    expect(d.bluesky!.rkey).toBe('3knewkey00001')
    expect(d.bluesky!.sent).toBeNull()
    expect(d.bluesky!.source).toBe(URI)
    // New bytes, so new CIDs: the delete cannot take them with the old record.
    expect(d.bluesky!.images.map((i) => [i.blob.ref.$link, i.alt, i.aspectRatio, i.mime])).toEqual([
      ['new-re bytes of bafkA', 'a cat', { width: 4, height: 3 }, 'image/jpeg'],
      ['new-re bytes of bafkB', '', { width: 8, height: 6 }, 'image/jpeg'],
    ])
    // The re-encoded bytes are stored under the final slot, by image id.
    const files = await getDraftFiles(KEY, out!.redraftSlot)
    expect(Object.keys(files).sort()).toEqual(d.bluesky!.images.map((i) => i.id).sort())
    expect(await files[d.bluesky!.images[0]!.id]!.text()).toBe('re bytes of bafkA')
    // Hidden until the delete is decided (D1): a new post does not open it.
    expect(findRedraftSlot(KEY)).toBeNull()
    // Prune keeps the bytes of a staged draft.
    await pruneDraftFiles()
    expect(Object.keys(await getDraftFiles(KEY, out!.redraftSlot))).toHaveLength(2)
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
    expect(await getDraftFiles(KEY, out!.redraftSlot)).toEqual({})
  })

  it('an account switch while the bytes are stored removes the draft again', async () => {
    const f = fakeClient(IMG_RECORD)
    const source = (await readBlueskyRedraft(f.client, post()))!
    // The switch lands while putDraftFiles reads the bytes.
    const switching = async (b: Blob): Promise<PreparedImage> => {
      const blob = new Blob([await b.text()], { type: 'image/jpeg' })
      const read = blob.arrayBuffer.bind(blob)
      blob.arrayBuffer = () => { activeUserKey.value = 'did:plc:other@bsky'; return read() }
      return { blob, width: 1, height: 1 }
    }
    expect(await storeBlueskyRedraft(f.client, source, { prepareImage: switching })).toBeNull()
    expect(storedDrafts(KEY)).toEqual([])
  })

  it('a text-only redraft needs no IndexedDB', async () => {
    const f = fakeClient()
    const source = (await readBlueskyRedraft(f.client, post()))!
    _testOnlyFailNextPut()
    const out = await storeBlueskyRedraft(f.client, source, { prepareImage })
    expect(loadDraft(KEY, out!.slot)!.text).toBe('hello world')
  })

  it('a draft that would be empty throws and stores nothing (D3)', async () => {
    const external = { ...RECORD, text: '', embed: { $type: 'app.bsky.embed.external', external: { uri: 'https://example.com', title: 't', description: '' } } } as unknown as BlueskyPostRecord
    const f = fakeClient(external)
    const source = (await readBlueskyRedraft(f.client, post()))!
    expect(redraftKeepsSomething(source)).toBe(false)
    await expect(storeBlueskyRedraft(f.client, source, { prepareImage })).rejects.toThrow(NOTHING_KEPT)
    expect(storedDrafts(KEY)).toEqual([])
  })

  it.each([
    ['text', RECORD],
    ['an image', { ...RECORD, text: ' ', embed: IMG_RECORD.embed }],
    ['a quote', { ...RECORD, text: '', embed: { $type: 'app.bsky.embed.record', record: QUOTED } }],
  ])('redraftKeepsSomething: %s is kept', async (_, record) => {
    const f = fakeClient(record as BlueskyPostRecord)
    expect(redraftKeepsSomething((await readBlueskyRedraft(f.client, post()))!)).toBe(true)
  })
})

describe('settleBlueskyRedraft (D1)', () => {
  async function staged(record: BlueskyPostRecord = IMG_RECORD) {
    const f = fakeClient(record)
    const source = (await readBlueskyRedraft(f.client, post()))!
    return { ...f, stored: (await storeBlueskyRedraft(f.client, source, { prepareImage }))! }
  }

  it('deleted: the draft moves to redraft:<key>, where a new post finds it; the bytes stay', async () => {
    const { stored } = await staged()
    expect(await settleBlueskyRedraft(stored, 'deleted')).toBe(stored.redraftSlot)
    expect(loadDraft(KEY, stored.slot)).toBeNull()
    expect(findRedraftSlot(KEY)).toBe(stored.redraftSlot)
    const d = loadDraft(KEY, stored.redraftSlot)!
    expect(d.text).toBe('hello world')
    expect(d.bluesky!.sourceMaybeLive).toBe(false)
    await pruneDraftFiles()
    expect(Object.keys(await getDraftFiles(KEY, stored.redraftSlot))).toHaveLength(1)
  })

  it('unknown: it moves too, marked sourceMaybeLive', async () => {
    const { stored } = await staged()
    await settleBlueskyRedraft(stored, 'unknown')
    expect(loadDraft(KEY, stored.redraftSlot)!.bluesky!.sourceMaybeLive).toBe(true)
  })

  it('failed: the staged draft and its bytes go', async () => {
    const { stored } = await staged()
    expect(await settleBlueskyRedraft(stored, 'failed')).toBeNull()
    expect(storedDrafts(KEY)).toEqual([])
    expect(await getDraftFiles(KEY, stored.redraftSlot)).toEqual({})
  })

  it('failed: a slot written since the store is not erased (revision-checked)', async () => {
    const { stored } = await staged()
    saveDraft(KEY, stored.slot, { ...loadDraft(KEY, stored.slot)!, text: 'an edit' })
    await settleBlueskyRedraft(stored, 'failed')
    expect(loadDraft(KEY, stored.slot)!.text).toBe('an edit')
    expect(Object.keys(await getDraftFiles(KEY, stored.redraftSlot))).toHaveLength(1)
  })

  it('a redraft of the same post stored already wins: its edits stay, the new copy and its bytes go (D4)', async () => {
    const first = await staged()
    await settleBlueskyRedraft(first.stored, 'unknown')
    // The reader edits the kept redraft and closes it.
    saveDraft(KEY, first.stored.redraftSlot, { ...loadDraft(KEY, first.stored.redraftSlot)!, text: 'hello, plus an edit' })
    const second = await staged()
    expect(await settleBlueskyRedraft(second.stored, 'deleted')).toBe(first.stored.redraftSlot)
    expect(storedDrafts(KEY).map(([slot]) => slot)).toEqual([first.stored.redraftSlot])
    const kept = loadDraft(KEY, first.stored.redraftSlot)!
    expect(kept.text).toBe('hello, plus an edit')
    // The outcome sets its mark: this delete went through.
    expect(kept.bluesky!.sourceMaybeLive).toBe(false)
    expect(Object.keys(await getDraftFiles(KEY, first.stored.redraftSlot))).toHaveLength(1)
    expect(await getDraftFiles(KEY, second.stored.redraftSlot)).toEqual({})
    expect(findRedraftOf(KEY, URI)).toBe(first.stored.redraftSlot)
  })

  it('the rename needs no second copy: a storage full after the store still takes it (Codex R3-2)', async () => {
    const { stored } = await staged()
    // Room for what is stored now and 64 characters more, not for a copy.
    const room = (localStorage.getItem(`caribou.drafts.${KEY}`) ?? '').length + 64
    const real = localStorage.setItem.bind(localStorage)
    let refused = 0
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k.startsWith('caribou.drafts.') && v.length > room) { refused += 1; throw new DOMException('full', 'QuotaExceededError') }
      real(k, v)
    })
    try {
      expect(await settleBlueskyRedraft(stored, 'unknown')).toBe(stored.redraftSlot)
      // The quota is real: a second full copy does not fit.
      expect(() => localStorage.setItem(`caribou.drafts.${KEY}`, (localStorage.getItem(`caribou.drafts.${KEY}`) ?? '').repeat(2))).toThrow()
      expect(refused).toBe(1)
    } finally {
      spy.mockRestore()
    }
    expect(storedDrafts(KEY).map(([slot]) => slot)).toEqual([stored.redraftSlot])
    expect(loadDraft(KEY, stored.redraftSlot)!.bluesky!.sourceMaybeLive).toBe(true)
  })

  it('storage refuses even the rename: the staged slot is found by a new post in this page', async () => {
    const { stored } = await staged()
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    try {
      expect(await settleBlueskyRedraft(stored, 'deleted')).toBe(stored.slot)
    } finally {
      spy.mockRestore()
    }
    expect(findRedraftSlot(KEY)).toBe(stored.slot)
  })

  it('a refused rename keeps the outcome\'s mark: the fallback warns (Codex R4-3)', async () => {
    const { client, stored } = await staged()
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    try {
      await settleBlueskyRedraft(stored, 'unknown')
    } finally {
      spy.mockRestore()
    }
    expect(loadDraft(KEY, stored.slot)!.bluesky!.sourceMaybeLive).toBe(true)
    expect(await checkRedraftSource(client, stored.slot)).toBe(true)
  })

  it('a refused rename, then storage back: the fallback is exposed, survives a reload, and no cleanup removes its edits (rule E, Codex R4-1)', async () => {
    const { stored } = await staged()
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    try {
      await settleBlueskyRedraft(stored, 'unknown')
    } finally {
      spy.mockRestore()
    }
    // The reader opens it, edits it, closes it.
    saveDraft(KEY, stored.slot, { ...loadDraft(KEY, stored.slot)!, text: 'hello world, plus an edit' })
    // A reload: the page-only reveal is gone; the stored flag is not.
    _testOnlyForgetRevealed()
    expect(loadDraft(KEY, stored.slot)!.bluesky!.exposed).toBe(true)
    expect(findRedraftSlot(KEY)).toBe(stored.slot)
    expect(hasOrphanStagedRedrafts(KEY)).toBe(false)
    // The post is still up, and a day has gone: nothing is removed.
    saveDraft(KEY, stored.slot, { ...loadDraft(KEY, stored.slot)!, bluesky: { ...loadDraft(KEY, stored.slot)!.bluesky!, stagedAt: Date.now() - STAGED_MAX_AGE_MS - 1 } })
    const other = fakeClient()
    expect(await recoverStagedRedrafts(other.client)).toEqual([])
    expect(other.c.blueskyGetOwnPost).not.toHaveBeenCalled()
    // A later redraft of the same post that is deleted removes nothing exposed.
    const second = await staged()
    expect(await settleBlueskyRedraft(second.stored, 'deleted')).toBe(stored.slot)
    expect(loadDraft(KEY, stored.slot)!.text).toBe('hello world, plus an edit')
    expect(Object.keys(await getDraftFiles(KEY, stored.redraftSlot))).toHaveLength(1)
  })
})

describe('settleBlueskyRedraft: other posts, other tabs, and the page overlay (#243)', () => {
  async function staged() {
    const f = fakeClient(IMG_RECORD)
    const source = (await readBlueskyRedraft(f.client, post()))!
    return { ...f, stored: (await storeBlueskyRedraft(f.client, source, { prepareImage }))! }
  }
  const refuseWrites = () => vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })

  it('deleted: an orphan staged copy of another post stays (the source check)', async () => {
    const OTHER = `at://${DID}/app.bsky.feed.post/3kother`
    const left = emptyDraft({ text: 'another post', bluesky: emptyBlueskyDraft({ source: OTHER, rkey: 'o', stagedAt: Date.now() }) })
    saveDraft(KEY, `staged:${left.idempotencyKey}`, left)
    const { stored } = await staged()
    expect(await settleBlueskyRedraft(stored, 'deleted')).toBe(stored.redraftSlot)
    expect(loadDraft(KEY, `staged:${left.idempotencyKey}`)!.text).toBe('another post')
  })

  it('two tabs redraft the same post at once: the second answers the first one\'s redraft', async () => {
    // Tab B stores first; to tab A it is another tab's flow.
    const b = await staged()
    _testOnlyForgetStaging()
    const a = await staged()
    expect(await settleBlueskyRedraft(a.stored, 'deleted')).toBe(a.stored.redraftSlot)
    // A's delete removed B's unexposed copy, so B has nothing of its own.
    expect(loadDraft(KEY, b.stored.slot)).toBeNull()
    expect(await settleBlueskyRedraft(b.stored, 'deleted')).toBe(a.stored.redraftSlot)
  })

  it('a refused rename: storedDrafts shows the page-only fields (exposed, the mark)', async () => {
    const { stored } = await staged()
    const spy = refuseWrites()
    try {
      await settleBlueskyRedraft(stored, 'unknown')
      const [slot, d] = storedDrafts(KEY)[0]!
      expect(slot).toBe(stored.slot)
      expect(d.bluesky).toMatchObject({ exposed: true, sourceMaybeLive: true })
    } finally {
      spy.mockRestore()
    }
  })

  it('patchRevealed: a gone post clears the page-only mark while storage still refuses; another slot is not touched', async () => {
    const { stored } = await staged()
    // A redraft of another post: not the one this flow settles.
    const other = emptyDraft({ text: 'other', bluesky: emptyBlueskyDraft({ source: `at://${DID}/app.bsky.feed.post/3kother`, sourceMaybeLive: true }) })
    saveDraft(KEY, `redraft:${other.idempotencyKey}`, other)
    const spy = refuseWrites()
    try {
      await settleBlueskyRedraft(stored, 'unknown')
      expect(loadDraft(KEY, stored.slot)!.bluesky!.sourceMaybeLive).toBe(true)
      expect(await checkRedraftSource(fakeClient(null).client, stored.slot)).toBe(false)
      expect(loadDraft(KEY, stored.slot)!.bluesky!.sourceMaybeLive).toBe(false)
      patchRevealed(KEY, `redraft:${other.idempotencyKey}`, { sourceMaybeLive: false })
      expect(loadDraft(KEY, `redraft:${other.idempotencyKey}`)!.bluesky!.sourceMaybeLive).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('rule E: exposed drafts', () => {
  async function stagedOne() {
    const f = fakeClient(IMG_RECORD)
    const source = (await readBlueskyRedraft(f.client, post()))!
    return { ...f, stored: (await storeBlueskyRedraft(f.client, source, { prepareImage }))! }
  }

  it('a refused rename stores the exposed flag when a smaller write fits: found after a reload, with no edit', async () => {
    const { stored } = await stagedOne()
    const real = localStorage.setItem.bind(localStorage)
    let first = true
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (first && k.startsWith('caribou.drafts.')) { first = false; throw new DOMException('full', 'QuotaExceededError') }
      real(k, v)
    })
    try {
      expect(await settleBlueskyRedraft(stored, 'deleted')).toBe(stored.slot)
    } finally {
      spy.mockRestore()
    }
    _testOnlyForgetRevealed()
    expect(findRedraftSlot(KEY)).toBe(stored.slot)
    expect(hasOrphanStagedRedrafts(KEY)).toBe(false)
  })

  it('a deleted redraft never removes an exposed staged copy of the same post', async () => {
    const kept = emptyDraft({ text: 'kept', bluesky: emptyBlueskyDraft({ source: URI, rkey: 'k' }) })
    saveDraft(KEY, `redraft:${kept.idempotencyKey}`, kept)
    const shown = emptyDraft({ text: 'shown and edited', bluesky: emptyBlueskyDraft({ source: URI, rkey: 's', exposed: true }) })
    saveDraft(KEY, `staged:${shown.idempotencyKey}`, shown)
    const { stored } = await stagedOne()
    expect(await settleBlueskyRedraft(stored, 'deleted')).toBe(`redraft:${kept.idempotencyKey}`)
    expect(loadDraft(KEY, `staged:${shown.idempotencyKey}`)!.text).toBe('shown and edited')
    expect(loadDraft(KEY, stored.slot)).toBeNull()
  })
})

describe('renameDraftIf', () => {
  const draft = (text: string) => emptyDraft({ text })

  it('renames in place while the revision is the expected one and the target is empty', () => {
    saveDraft(KEY, 'staged:k', draft('a'))
    const rev = loadDraft(KEY, 'staged:k')!.rev!
    // Another revision: refused.
    expect(renameDraftIf(KEY, 'staged:k', 'wrong', 'redraft:k')).toBe(false)
    // The target holds a draft: refused, and both stay.
    saveDraft(KEY, 'redraft:k', draft('taken'))
    expect(renameDraftIf(KEY, 'staged:k', rev, 'redraft:k')).toBe(false)
    expect(loadDraft(KEY, 'redraft:k')!.text).toBe('taken')
    expect(loadDraft(KEY, 'staged:k')!.text).toBe('a')
    localStorage.clear()
    saveDraft(KEY, 'staged:k', draft('a'))
    expect(renameDraftIf(KEY, 'staged:k', loadDraft(KEY, 'staged:k')!.rev!, 'redraft:k')).not.toBe(false)
    expect(storedDrafts(KEY).map(([slot, d]) => [slot, d.text])).toEqual([['redraft:k', 'a']])
  })
})

describe('staged redrafts a closed tab left', () => {
  function orphan(stagedAt = Date.now()): string {
    const d = emptyDraft({ text: 'left behind', bluesky: emptyBlueskyDraft({ source: URI, rkey: '3knew', stagedAt }) })
    saveDraft(KEY, `staged:${d.idempotencyKey}`, d)
    return d.idempotencyKey
  }

  it('a redraft of the same post stored meanwhile wins: the orphan goes, the edits stay, nothing is "found" (D4, Fable P10)', async () => {
    const key = orphan()
    const kept = emptyDraft({ text: 'hello world, plus an edit', bluesky: emptyBlueskyDraft({ source: URI, rkey: '3kkept' }) })
    const keptSlot: DraftSlot = `redraft:${kept.idempotencyKey}`
    saveDraft(KEY, keptSlot, kept)
    await putDraftFilesFor(keptSlot)
    await putDraftFilesFor(`redraft:${key}`)
    const { client } = fakeClient(null)
    expect(await recoverStagedRedrafts(client)).toEqual([])
    expect(storedDrafts(KEY).map(([slot]) => slot)).toEqual([keptSlot])
    expect(loadDraft(KEY, keptSlot)!.text).toBe('hello world, plus an edit')
    expect(findRedraftSlot(KEY)).toBe(keptSlot)
    expect(Object.keys(await getDraftFiles(KEY, keptSlot))).toHaveLength(1)
    expect(await getDraftFiles(KEY, `redraft:${key}`)).toEqual({})
  })

  it('a day old with its post still up: shown as a normal redraft with the "still up" mark, and not asked about again (rule E)', async () => {
    const key = orphan(Date.now() - STAGED_MAX_AGE_MS - 1)
    await putDraftFilesFor(`redraft:${key}`)
    const { client, c } = fakeClient()
    expect(await recoverStagedRedrafts(client)).toEqual([`redraft:${key}`])
    const d = loadDraft(KEY, `redraft:${key}`)!
    expect(d.text).toBe('left behind')
    expect(d.bluesky!.sourceMaybeLive).toBe(true)
    expect(d.bluesky!.exposed).toBe(true)
    expect(Object.keys(await getDraftFiles(KEY, `redraft:${key}`))).toHaveLength(1)
    expect(await recoverStagedRedrafts(client)).toEqual([])
    expect(c.blueskyGetOwnPost).toHaveBeenCalledTimes(1)
  })

  it('a redraft of the same post settles as deleted: an unexposed copy a closed tab left goes; one this tab runs stays (Fable P18)', async () => {
    const key = orphan()
    await putDraftFilesFor(`redraft:${key}`)
    const f = fakeClient()
    const running = (await storeBlueskyRedraft(f.client, (await readBlueskyRedraft(f.client, post()))!, { prepareImage }))!
    const mine = (await storeBlueskyRedraft(f.client, (await readBlueskyRedraft(f.client, post()))!, { prepareImage }))!
    expect(await settleBlueskyRedraft(mine, 'deleted')).toBe(mine.redraftSlot)
    expect(loadDraft(KEY, `staged:${key}`)).toBeNull()
    expect(await getDraftFiles(KEY, `redraft:${key}`)).toEqual({})
    expect(loadDraft(KEY, running.slot)).not.toBeNull()
  })

  it('unknown leaves the closed tab\'s copy alone', async () => {
    const key = orphan()
    const f = fakeClient()
    const mine = (await storeBlueskyRedraft(f.client, (await readBlueskyRedraft(f.client, post()))!, { prepareImage }))!
    await settleBlueskyRedraft(mine, 'unknown')
    expect(loadDraft(KEY, `staged:${key}`)).not.toBeNull()
  })

  it('stagedAt is set by the real store: another tab\'s new post leaves a young staged draft whose post is up (R4-N4)', async () => {
    const f = fakeClient()
    const stored = (await storeBlueskyRedraft(f.client, (await readBlueskyRedraft(f.client, post()))!, { prepareImage }))!
    expect(typeof loadDraft(KEY, stored.slot)!.bluesky!.stagedAt).toBe('number')
    // Seen from another tab: its delete may be in flight.
    _testOnlyForgetStaging()
    expect(await recoverStagedRedrafts(f.client)).toEqual([])
    expect(loadDraft(KEY, stored.slot)!.text).toBe('hello world')
    expect(findRedraftSlot(KEY)).toBeNull()
  })

  it('the post is gone: the draft moves to redraft:<key>', async () => {
    const key = orphan()
    const { client } = fakeClient(null)
    expect(hasOrphanStagedRedrafts(KEY)).toBe(true)
    expect(await recoverStagedRedrafts(client)).toEqual([`redraft:${key}`])
    expect(findRedraftSlot(KEY)).toBe(`redraft:${key}`)
    expect(hasOrphanStagedRedrafts(KEY)).toBe(false)
  })

  it('the post is still up (staged less than a day ago), or the read fails: it stays hidden', async () => {
    const key = orphan()
    const { client, c } = fakeClient()
    expect(await recoverStagedRedrafts(client)).toEqual([])
    c.blueskyGetOwnPost.mockRejectedValueOnce(new Error('502'))
    expect(await recoverStagedRedrafts(client)).toEqual([])
    expect(loadDraft(KEY, `staged:${key}`)!.text).toBe('left behind')
    expect(findRedraftSlot(KEY)).toBeNull()
  })

  it('a staged draft whose delete runs in this tab is not touched', async () => {
    const f = fakeClient()
    const source = (await readBlueskyRedraft(f.client, post()))!
    const stored = (await storeBlueskyRedraft(f.client, source, { prepareImage }))!
    expect(hasOrphanStagedRedrafts(KEY)).toBe(false)
    f.c.blueskyGetOwnPost.mockResolvedValue(null)
    expect(await recoverStagedRedrafts(f.client)).toEqual([])
    expect(loadDraft(KEY, stored.slot)).not.toBeNull()
  })
})

describe('checkRedraftSource (N3)', () => {
  function kept(maybeLive: boolean) {
    const d = emptyDraft({ text: 'kept', bluesky: emptyBlueskyDraft({ source: URI, sourceMaybeLive: maybeLive }) })
    saveDraft(KEY, `redraft:${d.idempotencyKey}`, d)
    return `redraft:${d.idempotencyKey}` as const
  }

  it('the post is still up: true', async () => {
    const { client } = fakeClient()
    expect(await checkRedraftSource(client, kept(true))).toBe(true)
  })

  it('the post is gone: false, and the mark is cleared', async () => {
    const slot = kept(true)
    const { client } = fakeClient(null)
    expect(await checkRedraftSource(client, slot)).toBe(false)
    expect(loadDraft(KEY, slot)!.bluesky!.sourceMaybeLive).toBe(false)
  })

  it('no mark: nothing is asked', async () => {
    const { client, c } = fakeClient()
    expect(await checkRedraftSource(client, kept(false))).toBeNull()
    expect(c.blueskyGetOwnPost).not.toHaveBeenCalled()
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
