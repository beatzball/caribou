import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BlueskyBlobRef, BlueskyGates, BlueskyOwnPost, BlueskyPostRecord, CaribouClient, Status,
} from '@beatzball/caribou-mastodon-client'
import { CaribouError } from '@beatzball/caribou-mastodon-client'
import { emptyDraft, isDraftEmpty, loadDraft, saveDraft, type ComposeDraft } from '../compose.js'
import {
  blueskyDraftInput, blueskyRecord, emptyBlueskyDraft, postBlueskyDraft, BLUESKY_SELF_LABELS, DraftChanged, DraftNotSaved,
} from '../bluesky-compose.js'

// The client's `BlueskyBlobNotFound`, by shape: state does not import the client package.
class BlueskyBlobNotFoundLike extends CaribouError {
  readonly cid = 'bafkreiimg'
  constructor(message: string) {
    super('not_found', message, { status: 400 })
    this.name = 'BlueskyBlobNotFound'
  }
}
import { statusCache } from '../caches.js'
import { activeUserKey, users } from '../users.js'

const KEY = 'did:plc:reader@bsky' as const
const OTHER = 'did:plc:other@bsky' as const
const PARENT = { uri: 'at://did:plc:bob/app.bsky.feed.post/p1', cid: 'bafyparent' }
const ROOT = { uri: 'at://did:plc:bob/app.bsky.feed.post/p0', cid: 'bafyroot' }
const QUOTED = { uri: 'at://did:plc:carol/app.bsky.feed.post/q1', cid: 'bafyquote' }
const BLOB: BlueskyBlobRef = { $type: 'blob', ref: { $link: 'bafkreiimg' }, mimeType: 'image/jpeg', size: 1000 }

function uriOf(rkey: string) {
  return `at://did:plc:reader/app.bsky.feed.post/${rkey}`
}

/**
 * A fake PDS: it keeps records by rkey, and `createRecord` can be told to
 * write and then lose the answer (a timeout after the write).
 */
function fakePds() {
  const records = new Map<string, BlueskyPostRecord>()
  // The limits written with each post (#199): one call, so the same map entry.
  const gates = new Map<string, BlueskyGates>()
  // A draft is made with rkey 0000001 (R6, `draft()`); new ones start after it.
  let rkeys = 1
  const loseNextAnswer = { value: false }
  const failNextBeforeWrite = { value: null as Error | null }
  // Runs once at the start of the next create: a write from elsewhere lands first.
  const beforeNextCreate = { value: null as null | (() => void) }
  const client = {
    userKey: KEY,
    blueskyNextRkey: vi.fn(async () => `3krkey${String(++rkeys).padStart(7, '0')}`),
    blueskyDetectFacets: vi.fn(async (text: string) => text.includes('#tag')
      ? [{ index: { byteStart: text.indexOf('#tag'), byteEnd: text.indexOf('#tag') + 4 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tag' }] }]
      : []),
    blueskyCreatePost: vi.fn(async (record: BlueskyPostRecord, rkey: string, g?: BlueskyGates | null) => {
      const before = beforeNextCreate.value
      beforeNextCreate.value = null
      before?.()
      if (failNextBeforeWrite.value) {
        const err = failNextBeforeWrite.value
        failNextBeforeWrite.value = null
        throw err
      }
      // The PDS does not check first: a used key is a plain 500 (spec 7.2).
      if (records.has(rkey)) throw new CaribouError('server_error', 'Internal Server Error', { status: 500 })
      records.set(rkey, record)
      if (g) gates.set(rkey, g)
      if (loseNextAnswer.value) {
        loseNextAnswer.value = false
        throw new CaribouError('unreachable', 'timeout')
      }
      return { uri: uriOf(rkey), cid: `bafy${rkey}` }
    }),
    blueskyGetOwnPost: vi.fn(async (rkey: string): Promise<BlueskyOwnPost | null> => {
      const value = records.get(rkey)
      return value ? { uri: uriOf(rkey), cid: `bafy${rkey}`, value } : null
    }),
    // The gate records at the rkey, read back (#199). None: everyone, quotes on.
    blueskyGetOwnGates: vi.fn(async (rkey: string): Promise<BlueskyGates> => gates.get(rkey) ?? { replies: null, quotes: true }),
    fetchStatus: vi.fn(async (id: string) => ({ id, uri: id, account: { id: 'did:plc:reader' } }) as unknown as Status),
  }
  return { client: client as unknown as CaribouClient & typeof client, records, gates, loseNextAnswer, failNextBeforeWrite, beforeNextCreate }
}

// A draft as the dialog makes it: with its rkey from the start (R6).
function draft(over: Partial<ComposeDraft> = {}, bsky: Partial<NonNullable<ComposeDraft['bluesky']>> = {}): ComposeDraft {
  return emptyDraft({ text: 'hello', ...over, bluesky: { ...emptyBlueskyDraft({ rkey: '3krkey0000001' }), ...bsky } })
}

const tick = (n = 1) => new Promise((r) => setTimeout(r, n))

const noWait = { wait: () => Promise.resolve() }

// Storage that refuses draft writes while `refusing.on` (full or blocked).
// Restored after every test, so one failing test cannot leak it (review R2-N5).
const realSetItem = localStorage.setItem.bind(localStorage)
const refusing = { on: false }
Object.defineProperty(localStorage, 'setItem', {
  configurable: true,
  value: (k: string, v: string) => {
    if (refusing.on && k.startsWith('caribou.drafts.')) throw new DOMException('full', 'QuotaExceededError')
    return realSetItem(k, v)
  },
})
afterEach(() => { refusing.on = false })

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = KEY
})

describe('the record', () => {
  it('a plain post: text, facets, createdAt; nothing else', () => {
    const r = blueskyRecord(draft({ text: 'hi #tag' }), [{ index: { byteStart: 3, byteEnd: 7 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tag' }] }], '2026-11-08T00:00:00.000Z')
    expect(r).toEqual({
      $type: 'app.bsky.feed.post', text: 'hi #tag', createdAt: '2026-11-08T00:00:00.000Z',
      facets: [{ index: { byteStart: 3, byteEnd: 7 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tag' }] }],
    })
  })

  it('a reply carries root and parent strong refs', () => {
    const r = blueskyRecord(draft({}, { reply: { root: ROOT, parent: PARENT } }), [], 't')
    expect(r.reply).toEqual({ root: ROOT, parent: PARENT })
  })

  it('images go in embed.images, with alt text and aspect ratio', () => {
    const r = blueskyRecord(draft({}, {
      images: [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1000, alt: 'a cat', aspectRatio: { width: 4, height: 3 } }],
    }), [], 't')
    expect(r.embed).toEqual({
      $type: 'app.bsky.embed.images',
      images: [{ image: BLOB, alt: 'a cat', aspectRatio: { width: 4, height: 3 } }],
    })
  })

  it('a quote is embed.record; a quote with images is recordWithMedia', () => {
    expect(blueskyRecord(draft({}, { quote: QUOTED }), [], 't').embed)
      .toEqual({ $type: 'app.bsky.embed.record', record: QUOTED })
    const both = blueskyRecord(draft({}, {
      quote: QUOTED, images: [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1000, alt: '', aspectRatio: null }],
    }), [], 't')
    expect(both.embed).toEqual({
      $type: 'app.bsky.embed.recordWithMedia',
      record: { $type: 'app.bsky.embed.record', record: QUOTED },
      media: { $type: 'app.bsky.embed.images', images: [{ image: BLOB, alt: '' }] },
    })
  })

  // #190: a redraft carries any self-label; the menu's go only with images.
  it('self-labels: the menu\'s on a post with images, in menu order, then any other value as it is', () => {
    const img = [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1000, alt: '', aspectRatio: null }]
    const r = blueskyRecord(draft({}, { images: img, labels: ['graphic-media', 'nonsense', 'porn'] }), [], 't')
    expect(r.labels).toEqual({ $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'porn' }, { val: 'graphic-media' }, { val: 'nonsense' }] })
    expect(BLUESKY_SELF_LABELS.map((l) => l.value)).toEqual(['porn', 'sexual', 'nudity', 'graphic-media'])
    // With no images, only the values the menu does not have.
    expect(blueskyRecord(draft({}, { labels: ['porn', 'nonsense'] }), [], 't').labels)
      .toEqual({ $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nonsense' }] })
  })

  it('labels without images are not sent: the menu labels media', () => {
    expect(blueskyRecord(draft({}, { labels: ['porn'] }), [], 't').labels).toBeUndefined()
  })
})

describe('the draft contract: what survives', () => {
  it('a reload keeps text, refs, blob refs, alt, labels, rkey and the frozen record', () => {
    const d = draft({ text: 'kept' }, {
      reply: { root: ROOT, parent: PARENT }, quote: QUOTED, labels: ['nudity'],
      images: [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1000, alt: 'alt', aspectRatio: { width: 1, height: 1 }, name: 'a.jpg' }],
      rkey: '3krkey0000001',
      sent: { input: 'x', record: { $type: 'app.bsky.feed.post', text: 'kept', createdAt: 't' } },
    })
    saveDraft(KEY, 'reply:at://p1', d)
    expect(loadDraft(KEY, 'reply:at://p1')).toEqual({ ...d, rev: expect.any(String) })
  })

  it('a draft with only images, or only a pending send, is not empty', () => {
    expect(isDraftEmpty(draft({ text: '' }, { images: [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1, alt: '', aspectRatio: null }] }))).toBe(false)
    expect(isDraftEmpty(draft({ text: '' }, { rkey: 'k', sent: { input: '', record: { $type: 'app.bsky.feed.post', text: '', createdAt: 't' } } }))).toBe(false)
    expect(isDraftEmpty(draft({ text: '' }))).toBe(true)
  })

  it('the input key changes with any edit and not with facets', () => {
    const a = draft({ text: 'a' })
    expect(blueskyDraftInput(a)).toBe(blueskyDraftInput(draft({ text: 'a' })))
    expect(blueskyDraftInput(a)).not.toBe(blueskyDraftInput(draft({ text: 'b' })))
    const img = [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1, alt: '', aspectRatio: null }]
    const withImg = blueskyDraftInput(draft({ text: 'a' }, { images: img }))
    expect(withImg).not.toBe(blueskyDraftInput(a))
    expect(withImg).not.toBe(blueskyDraftInput(draft({ text: 'a' }, { images: img, labels: ['porn'] })))
    expect(withImg).not.toBe(blueskyDraftInput(draft({ text: 'a' }, { images: [{ ...img[0]!, alt: 'x' }] })))
    // A label with no image is not sent, so it is not an edit of the record.
    expect(blueskyDraftInput(a)).toBe(blueskyDraftInput(draft({ text: 'a' }, { labels: ['porn'] })))
  })
})

describe('postBlueskyDraft: one post per click', () => {
  it('picks the rkey before the first send, stores the frozen record, then sends with that rkey', async () => {
    const { client, records } = fakePds()
    let storedBeforeSend: ComposeDraft | null = null
    client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      storedBeforeSend = loadDraft(KEY, 'new')
      records.set(rkey, record)
      return { uri: uriOf(rkey), cid: 'c' }
    })
    const out = await postBlueskyDraft(client, 'new', draft({ text: 'hi #tag' }), noWait)
    expect(out.kind).toBe('posted')
    const sent = storedBeforeSend!.bluesky!
    expect(sent.rkey).toBe('3krkey0000001')
    expect(sent.sent!.record).toEqual(records.get('3krkey0000001'))
    expect(sent.sent!.record.facets).toHaveLength(1)
    // Sent: the draft is cleared.
    expect(loadDraft(KEY, 'new')).toBeNull()
  })

  it('a send that times out after the record was written: the retry finds it, and there is one post', async () => {
    const pds = fakePds()
    pds.loseNextAnswer.value = true
    // The check after the lost answer fails too, so the outcome is unknown.
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    const d = draft({ text: 'once' })
    await expect(postBlueskyDraft(pds.client, 'new', d, noWait)).rejects.toMatchObject({ code: 'unreachable' })
    // The draft kept its rkey and frozen record.
    const kept = loadDraft(KEY, 'new')!
    expect(kept.bluesky!.sent).not.toBeNull()
    // A reload, then the retry.
    const out = await postBlueskyDraft(pds.client, 'new', kept, noWait)
    expect(out).toMatchObject({ kind: 'posted', uri: uriOf('3krkey0000001') })
    expect(pds.client.blueskyGetOwnPost).toHaveBeenCalledWith('3krkey0000001')
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(1)
    expect(pds.records.size).toBe(1)
    expect(loadDraft(KEY, 'new')).toBeNull()
  })

  it('a lost answer, then edits, then a retry: the edits are kept with a new rkey', async () => {
    const pds = fakePds()
    pds.loseNextAnswer.value = true
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'first' }), noWait)).rejects.toBeTruthy()
    const edited = { ...loadDraft(KEY, 'new')!, text: 'first, edited' }
    saveDraft(KEY, 'new', edited)
    const out = await postBlueskyDraft(pds.client, 'new', edited, noWait)
    expect(out).toMatchObject({ kind: 'earlier-posted', uri: uriOf('3krkey0000001') })
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(1)
    const kept = loadDraft(KEY, 'new')!
    expect(kept.text).toBe('first, edited')
    expect(kept.bluesky!.sent).toBeNull()
    expect(kept.bluesky!.rkey).toBe('3krkey0000002')
    if (out.kind === 'earlier-posted') expect(out.draft).toMatchObject({ text: kept.text, bluesky: kept.bluesky })
  })

  it('a lost answer after the write: the check right after finds it, one post, no retry needed (R1)', async () => {
    const pds = fakePds()
    pds.loseNextAnswer.value = true
    const out = await postBlueskyDraft(pds.client, 'new', draft({ text: 'once' }), noWait)
    expect(out.kind).toBe('posted')
    expect(pds.client.blueskyGetOwnPost).toHaveBeenCalledWith('3krkey0000001')
    expect(pds.records.size).toBe(1)
    expect(loadDraft(KEY, 'new')).toBeNull()
  })

  it('record not found, no edits: the same record (same createdAt, no new facet lookup) with the same rkey, once', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('server_error', 'Bad Gateway', { status: 502 })
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'again' }), noWait)).rejects.toBeTruthy()
    const kept = loadDraft(KEY, 'new')!
    // The failed create was checked (R1): absent, so the record unfroze.
    expect(kept.bluesky!.sent).toBeNull()
    expect(kept.bluesky!.rkey).toBe('3krkey0000001')
    const out = await postBlueskyDraft(pds.client, 'new', kept, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.client.blueskyCreatePost.mock.calls.map((c) => c[1])).toEqual(['3krkey0000001', '3krkey0000001'])
    expect(pds.records.size).toBe(1)
  })

  it('a pending send, check absent, no edits: the frozen record goes again as it is', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('unreachable', 'timeout')
    // The check after the failed create fails too: unknown, so it stays pending.
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'hi #tag' }), noWait)).rejects.toBeTruthy()
    const kept = loadDraft(KEY, 'new')!
    const frozen = kept.bluesky!.sent!.record
    await postBlueskyDraft(pds.client, 'new', kept, noWait)
    expect(pds.client.blueskyCreatePost.mock.calls[1]).toEqual([frozen, '3krkey0000001'])
    expect(pds.client.blueskyDetectFacets).toHaveBeenCalledTimes(1)
  })

  it('record not found after edits: the current draft goes with the same rkey (R2)', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('server_error', 'Bad Gateway', { status: 502 })
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)).rejects.toBeTruthy()
    const edited = { ...loadDraft(KEY, 'new')!, text: 'v2' }
    saveDraft(KEY, 'new', edited)
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.records.get('3krkey0000001')!.text).toBe('v2')
    expect(pds.records.size).toBe(1)
  })

  it('offline at the first Post, the reader fixes the text, Post: the fixed text goes public (review R2-N1, probe D)', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('unreachable', 'Failed to fetch')
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'teh typo' }), noWait)).rejects.toBeTruthy()
    saveDraft(KEY, 'new', { ...loadDraft(KEY, 'new')!, text: 'the typo, fixed' })
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('posted')
    expect([...pds.records.values()].map((r) => r.text)).toEqual(['the typo, fixed'])
  })

  it('v1 times out unwritten (check unknown), the reader edits to v2, v1 lands late: earlier-posted, v2 kept (R2, Fable B1, Codex 2)', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('unreachable', 'timeout')
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)).rejects.toBeTruthy()
    const v1 = loadDraft(KEY, 'new')!
    const v1Record = v1.bluesky!.sent!.record
    saveDraft(KEY, 'new', { ...v1, text: 'v2 with my edits' })
    pds.client.blueskyGetOwnPost.mockImplementationOnce(async () => {
      pds.records.set('3krkey0000001', v1Record)
      return null
    })
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect([...pds.records.values()].map((r) => r.text)).toEqual(['v1'])
    expect(out.kind).toBe('earlier-posted')
    const kept = loadDraft(KEY, 'new')!
    expect(kept.text).toBe('v2 with my edits')
    expect(kept.bluesky!.sent).toBeNull()
    expect(kept.bluesky!.rkey).toBe('3krkey0000002')
  })

  it('a found record that is not the frozen one is never read as posted', async () => {
    const pds = fakePds()
    pds.loseNextAnswer.value = true
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'mine' }), noWait)).rejects.toBeTruthy()
    pds.records.set('3krkey0000001', { $type: 'app.bsky.feed.post', text: 'other', createdAt: 'x' })
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('earlier-posted')
    expect(loadDraft(KEY, 'new')!.text).toBe('mine')
  })

  it('a failed check sends nothing: an unknown answer is never "not found" (R1)', async () => {
    const pds = fakePds()
    pds.loseNextAnswer.value = true
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft(), noWait)).rejects.toMatchObject({ code: 'unreachable' })
    expect(loadDraft(KEY, 'new')!.bluesky!.sent).not.toBeNull()
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)).rejects.toMatchObject({ code: 'unreachable' })
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(1)
    expect(loadDraft(KEY, 'new')!.bluesky!.sent).not.toBeNull()
  })

  it('a 400 that is not RecordNotFound is "the check failed": nothing is sent (R1)', async () => {
    const pds = fakePds()
    pds.loseNextAnswer.value = true
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('not_found', 'AccountDeactivated', { status: 400 }))
    await expect(postBlueskyDraft(pds.client, 'new', draft(), noWait)).rejects.toBeTruthy()
    pds.records.clear()
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('not_found', 'AccountDeactivated', { status: 400 }))
    await expect(postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)).rejects.toBeTruthy()
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(1)
  })

  it('a late first write after a check that said absent: the second create fails, the check finds it, one post', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('unreachable', 'timeout')
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'late' }), noWait)).rejects.toBeTruthy()
    const kept = loadDraft(KEY, 'new')!
    pds.client.blueskyGetOwnPost.mockImplementationOnce(async () => {
      pds.records.set('3krkey0000001', kept.bluesky!.sent!.record)
      return null
    })
    const out = await postBlueskyDraft(pds.client, 'new', kept, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.records.size).toBe(1)
    expect(loadDraft(KEY, 'new')).toBeNull()
  })

  it('storage refuses every click: nothing sent, the draft comes back unfrozen; then a reload posts once (R3, Codex R2.1, Fable R2-B2)', async () => {
    const pds = fakePds()
    saveDraft(KEY, 'new', draft({ text: 'once' }))
    refusing.on = true
    let mem = loadDraft(KEY, 'new')!
    const opts = { ...noWait, onDraft: (d: ComposeDraft) => { mem = d } }
    pds.loseNextAnswer.value = true
    for (let i = 0; i < 3; i++) {
      await expect(postBlueskyDraft(pds.client, 'new', mem, opts)).rejects.toBeInstanceOf(DraftNotSaved)
      expect(mem.bluesky!.sent).toBeNull()
    }
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
    // Reload: memory is gone, storage works again.
    refusing.on = false
    // The answer of this send is lost; the check right after finds it.
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.records.size).toBe(1)
    expect(loadDraft(KEY, 'new')).toBeNull()
  })

  it('the caller gets the frozen draft before the network (R3)', async () => {
    const pds = fakePds()
    let atSend: ComposeDraft | null = null
    let latest: ComposeDraft | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      atSend = latest
      expect(loadDraft(KEY, 'new')!.bluesky!.sent!.record).toEqual(record)
      pds.records.set(rkey, record)
      return { uri: uriOf(rkey), cid: 'c' }
    })
    await postBlueskyDraft(pds.client, 'new', draft(), { ...noWait, onDraft: (d) => { latest = d } })
    expect(atSend!.bluesky!.rkey).toBe('3krkey0000001')
    expect(atSend!.bluesky!.sent).not.toBeNull()
  })

  it('reopened and edited during the send, then the old send succeeds: the edit stays, and its Post keeps it (R4, Codex 4)', async () => {
    const pds = fakePds()
    const gate = deferred()
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      await gate.promise
      pds.records.set(rkey, record)
      return { uri: uriOf(rkey), cid: 'c' }
    })
    const sending = postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)
    await new Promise((r) => setTimeout(r, 0))
    saveDraft(KEY, 'new', { ...loadDraft(KEY, 'new')!, text: 'v1, edited' })
    gate.resolve()
    await sending
    expect(loadDraft(KEY, 'new')!.text).toBe('v1, edited')
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('earlier-posted')
    expect(pds.records.size).toBe(1)
    expect(loadDraft(KEY, 'new')!.text).toBe('v1, edited')
  })

  it('an old send leaves another draft in its slot alone (R4)', async () => {
    const pds = fakePds()
    const gate = deferred()
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      await gate.promise
      pds.records.set(rkey, record)
      return { uri: uriOf(rkey), cid: 'c' }
    })
    const sending = postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)
    await new Promise((r) => setTimeout(r, 0))
    saveDraft(KEY, 'new', draft({ text: 'a new one' }))
    gate.resolve()
    await sending
    expect(loadDraft(KEY, 'new')!.text).toBe('a new one')
  })

  it('a late blob refusal after the draft was reopened and edited writes nothing over it (R4, Codex R2.2)', async () => {
    const pds = fakePds()
    const gate = deferred()
    pds.client.blueskyCreatePost.mockImplementationOnce(async () => {
      await gate.promise
      throw new BlueskyBlobNotFoundLike('Could not find blob: bafkreiimg')
    })
    const img = [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1, alt: '', aspectRatio: null }]
    const sending = postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }, { images: img }), noWait)
    await new Promise((r) => setTimeout(r, 0))
    saveDraft(KEY, 'new', { ...loadDraft(KEY, 'new')!, text: 'v2 from reopened editor' })
    gate.resolve()
    await expect(sending).rejects.toBeTruthy()
    expect(loadDraft(KEY, 'new')!.text).toBe('v2 from reopened editor')
  })

  it('a facet lookup that lands after a reopen and edit: nothing is frozen or sent, the edit stays (R4, Codex R2.3)', async () => {
    const pds = fakePds()
    saveDraft(KEY, 'new', draft({ text: 'v1 @alice.example.com' }))
    const gate = deferred<[]>()
    pds.client.blueskyDetectFacets.mockImplementationOnce(() => gate.promise)
    const sending = postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    await new Promise((r) => setTimeout(r, 0))
    saveDraft(KEY, 'new', draft({ text: 'v2' }))
    gate.resolve([])
    await expect(sending).rejects.toBeInstanceOf(DraftChanged)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
    expect(loadDraft(KEY, 'new')!.text).toBe('v2')
  })

  it('a refused first create unfreezes: the next send freezes the current draft on the same rkey', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new BlueskyBlobNotFoundLike('Could not find blob: bafkreiimg')
    const img = [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1, alt: '', aspectRatio: null }]
    const seen: ComposeDraft[] = []
    await expect(postBlueskyDraft(pds.client, 'new', draft({}, { images: img }), { ...noWait, onDraft: (d) => seen.push(d) })).rejects.toBeTruthy()
    const after = loadDraft(KEY, 'new')!
    expect(after.bluesky!.sent).toBeNull()
    expect(after.bluesky!.rkey).toBe('3krkey0000001')
    expect(seen.at(-1)!.bluesky!.sent).toBeNull()
    await postBlueskyDraft(pds.client, 'new', { ...after, text: 'edited after' }, noWait)
    expect(pds.records.get('3krkey0000001')!.text).toBe('edited after')
  })

  it('a send in doubt, then the PDS drops the blob, then the reader removes the image: the post goes (R1, R2, Fable R2-B1, Codex R2.4)', async () => {
    const pds = fakePds()
    const img = [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1, alt: '', aspectRatio: null }]
    pds.failNextBeforeWrite.value = new CaribouError('unreachable', 'timeout')
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'with photo' }, { images: img }), noWait)).rejects.toBeTruthy()
    expect(loadDraft(KEY, 'new')!.bluesky!.sent).not.toBeNull()
    pds.client.blueskyCreatePost.mockImplementation(async (record: BlueskyPostRecord, rkey: string) => {
      if (JSON.stringify(record).includes('bafkreiimg')) throw new BlueskyBlobNotFoundLike('Could not find blob: bafkreiimg')
      pds.records.set(rkey, record)
      return { uri: uriOf(rkey), cid: 'c' }
    })
    await expect(postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)).rejects.toMatchObject({ name: 'BlueskyBlobNotFound' })
    expect(loadDraft(KEY, 'new')!.bluesky!.sent).toBeNull()
    const stored = loadDraft(KEY, 'new')!
    saveDraft(KEY, 'new', { ...stored, bluesky: { ...stored.bluesky!, images: [] } })
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.records.size).toBe(1)
    expect(loadDraft(KEY, 'new')).toBeNull()
  })
})

describe('round 3 (R6, R7, guards)', () => {
  it('a draft with no rkey is refused: the send never makes one (R6)', async () => {
    const pds = fakePds()
    await expect(postBlueskyDraft(pds.client, 'new', emptyDraft({ text: 'x', bluesky: emptyBlueskyDraft() }), noWait)).rejects.toBeInstanceOf(TypeError)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
  })

  it('no answer, the check says absent, the write lands late, Post again with no edit: posted, one record (R7, Fable R3-B1, probe A)', async () => {
    const pds = fakePds()
    let late: BlueskyPostRecord | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record) => {
      late = record
      throw new CaribouError('server_error', 'Gateway Timeout', { status: 504 })
    })
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'only once' }), noWait)).rejects.toBeTruthy()
    const after1 = loadDraft(KEY, 'new')!
    expect(after1.bluesky!.sent).toBeNull()
    pds.records.set('3krkey0000001', late!)
    await tick(5)
    const out = await postBlueskyDraft(pds.client, 'new', after1, noWait)
    expect(out.kind).toBe('posted')
    expect(loadDraft(KEY, 'new')).toBeNull()
    expect(pds.records.size).toBe(1)
  })

  it('a copy read before the freeze, posted while send 1 is in flight: one post (R6, Fable R3-B2, probe B)', async () => {
    const pds = fakePds()
    saveDraft(KEY, 'new', draft({ text: 'only once' }))
    const facets = deferred<never[]>()
    pds.client.blueskyDetectFacets.mockImplementationOnce(() => facets.promise)
    const gate = deferred()
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      await gate.promise
      pds.records.set(rkey, record)
      return { uri: uriOf(rkey), cid: 'c' }
    })
    const send1 = postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    await tick()
    const reopened = loadDraft(KEY, 'new')!
    facets.resolve([])
    await tick()
    const out2 = await postBlueskyDraft(pds.client, 'new', reopened, noWait).then((o) => o.kind, (e: Error) => e.name)
    gate.resolve()
    const out1 = await send1.then((o) => o.kind, (e: Error) => e.name)
    expect(pds.records.size).toBe(1)
    expect([out1, out2]).toContain('posted')
  })

  it('the same copy, posted after send 1 ended: one post (R6, probe C)', async () => {
    const pds = fakePds()
    saveDraft(KEY, 'new', draft({ text: 'only once' }))
    const facets = deferred<never[]>()
    pds.client.blueskyDetectFacets.mockImplementationOnce(() => facets.promise)
    const send1 = postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    await tick()
    const reopened = loadDraft(KEY, 'new')!
    facets.resolve([])
    await send1
    const out2 = await postBlueskyDraft(pds.client, 'new', reopened, noWait)
    expect(out2.kind).toBe('posted')
    expect(pds.records.size).toBe(1)
  })

  it('a pending send (the check failed), the reader edits, the next check says absent: the edit goes public (R2, Fable R3-N1, probe D)', async () => {
    const pds = fakePds()
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new CaribouError('unreachable', 'Failed to fetch'))
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'teh typo' }), noWait)).rejects.toBeTruthy()
    expect(loadDraft(KEY, 'new')!.bluesky!.sent).not.toBeNull()
    saveDraft(KEY, 'new', { ...loadDraft(KEY, 'new')!, text: 'the typo, fixed' })
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('posted')
    expect([...pds.records.values()].map((r) => r.text)).toEqual(['the typo, fixed'])
  })

  it('the session ends during the send (create and check 401): pending, then one post (probe E)', async () => {
    const pds = fakePds()
    const expired = new CaribouError('unauthorized', 'ExpiredToken', { status: 401 })
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      pds.records.set(rkey, record)
      throw expired
    })
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(expired)
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'once' }), noWait)).rejects.toBe(expired)
    await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(pds.records.size).toBe(1)
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(1)
  })

  it('R7 compares content by field: an SDK BlobRef CID object matches the draft CID', async () => {
    const pds = fakePds()
    const img = [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1, alt: 'a cat', aspectRatio: null }]
    pds.client.blueskyGetOwnPost.mockImplementation(async (rkey: string) => {
      const value = pds.records.get(rkey)
      if (!value) return null
      // The SDK's shape: the image ref is a CID object, not `{ $link }`.
      const embed = value.embed as unknown as { images: { image: { ref: unknown } }[] }
      const sdk = { ...value, embed: { ...embed, images: embed.images.map((i) => ({ ...i, image: { ...i.image, ref: { toString: () => 'bafkreiimg' } } })) } }
      return { uri: uriOf(rkey), cid: 'c', value: sdk as unknown as BlueskyPostRecord }
    })
    let late: BlueskyPostRecord | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record) => {
      late = record
      throw new CaribouError('server_error', 'Gateway Timeout', { status: 504 })
    })
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'photo' }, { images: img }), noWait)).rejects.toBeTruthy()
    pds.records.set('3krkey0000001', late!)
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.records.size).toBe(1)
  })

  it('R7: another alt text at the rkey is another content (SDK-shaped record)', async () => {
    const pds = fakePds()
    const img = [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1, alt: 'a cat', aspectRatio: null }]
    pds.loseNextAnswer.value = true
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'photo' }, { images: img }), noWait)).rejects.toBeTruthy()
    const stored = pds.records.get('3krkey0000001')!
    pds.records.set('3krkey0000001', { ...stored, embed: { $type: 'app.bsky.embed.images', images: [{ image: BLOB, alt: 'a dog' }] } })
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('earlier-posted')
  })

  it('a save during the pending check stops the send with DraftChanged, not DraftNotSaved (R4, R5, Fable R3-N4)', async () => {
    const pds = fakePds()
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new CaribouError('unreachable', 'Failed to fetch'))
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)).rejects.toBeTruthy()
    const check = deferred<null>()
    pds.client.blueskyGetOwnPost.mockImplementationOnce(() => check.promise)
    const sending = postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    await tick()
    saveDraft(KEY, 'new', { ...loadDraft(KEY, 'new')!, text: 'v2' })
    check.resolve(null)
    await expect(sending).rejects.toBeInstanceOf(DraftChanged)
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(1)
  })

  it('a freeze that storage takes but does not keep is refused: the read-back (R3, Fable R3-N4)', async () => {
    const pds = fakePds()
    saveDraft(KEY, 'new', draft({ text: 'x' }))
    // Storage answers, but keeps the old copy (another tab writes it back at once).
    const before = localStorage.getItem(`caribou.drafts.${KEY}`)!
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true,
      value: (k: string, v: string) => {
        if (k.startsWith('caribou.drafts.')) return realSetItem(k, before)
        return realSetItem(k, v)
      },
    })
    try {
      await expect(postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)).rejects.toBeInstanceOf(DraftNotSaved)
      expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(localStorage, 'setItem', {
        configurable: true,
        value: (k: string, v: string) => {
          if (refusing.on && k.startsWith('caribou.drafts.')) throw new DOMException('full', 'QuotaExceededError')
          return realSetItem(k, v)
        },
      })
    }
  })

  it('a refused freeze of a pending draft gives the caller the draft unfrozen (R3, Fable R3-N4)', async () => {
    const pds = fakePds()
    pds.client.blueskyCreatePost.mockRejectedValueOnce(new CaribouError('unreachable', 'Failed to fetch'))
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)).rejects.toBeTruthy()
    let mem = loadDraft(KEY, 'new')!
    expect(mem.bluesky!.sent).not.toBeNull()
    refusing.on = true
    await expect(postBlueskyDraft(pds.client, 'new', { ...mem, text: 'v2' }, { ...noWait, onDraft: (d) => { mem = d } })).rejects.toBeInstanceOf(DraftNotSaved)
    expect(mem.bluesky!.sent).toBeNull()
    expect(mem.text).toBe('v2')
  })
})

const MENTION = [{
  index: { byteStart: 3, byteEnd: 21 },
  features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:alice' }],
}] as never[]

describe('round 4', () => {
  it('a quote with no text is not empty: it keeps its rkey in storage (Codex R4-B1)', () => {
    expect(isDraftEmpty(draft({ text: '' }, { quote: QUOTED }))).toBe(false)
    saveDraft(KEY, 'quote:q1', draft({ text: '' }, { quote: QUOTED }))
    expect(loadDraft(KEY, 'quote:q1')!.bluesky!.rkey).toBe('3krkey0000001')
  })

  it('a quote with no text: failed create, check absent, reload, the late write lands, retry: one record (Codex R4-B1)', async () => {
    const pds = fakePds()
    saveDraft(KEY, 'quote:q1', draft({ text: '' }, { quote: QUOTED }))
    let late: BlueskyPostRecord | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record) => {
      late = record
      throw new CaribouError('server_error', 'Gateway Timeout', { status: 504 })
    })
    await expect(postBlueskyDraft(pds.client, 'quote:q1', loadDraft(KEY, 'quote:q1')!, noWait)).rejects.toBeTruthy()
    // A reload: only storage is left.
    const reloaded = loadDraft(KEY, 'quote:q1')
    expect(reloaded?.bluesky?.rkey).toBe('3krkey0000001')
    pds.records.set('3krkey0000001', late!)
    const out = await postBlueskyDraft(pds.client, 'quote:q1', reloaded!, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.records.size).toBe(1)
  })

  it('lookup 1 gives the mention facet, lookup 2 fails; no edit, late write: posted, one record (Fable R4-N1, probe A)', async () => {
    const pds = fakePds()
    pds.client.blueskyDetectFacets.mockImplementationOnce(async () => MENTION)
    let late: BlueskyPostRecord | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record) => {
      late = record
      throw new CaribouError('server_error', 'Gateway Timeout', { status: 504 })
    })
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'hi @alice.example.com' }), noWait)).rejects.toBeTruthy()
    pds.records.set('3krkey0000001', late!)
    await tick(5)
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.records.size).toBe(1)
  })

  it('two copies of one draft, the first posts with no facet, the second with it: posted, nothing kept (Fable R4-N1, probe B)', async () => {
    const pds = fakePds()
    saveDraft(KEY, 'new', draft({ text: 'hi @alice.example.com' }))
    const copy2 = loadDraft(KEY, 'new')!
    await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    pds.client.blueskyDetectFacets.mockImplementationOnce(async () => MENTION)
    const out2 = await postBlueskyDraft(pds.client, 'new', copy2, noWait)
    expect(out2.kind).toBe('posted')
    expect(loadDraft(KEY, 'new')).toBeNull()
    expect(pds.records.size).toBe(1)
  })

  it('control: a real edit of a mention post is still kept (probe C)', async () => {
    const pds = fakePds()
    saveDraft(KEY, 'new', draft({ text: 'hi @alice.example.com' }))
    const copy2 = { ...loadDraft(KEY, 'new')!, text: 'hi @alice.example.com, and more' }
    await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    saveDraft(KEY, 'new', copy2)
    const out2 = await postBlueskyDraft(pds.client, 'new', copy2, noWait)
    expect(out2.kind).toBe('earlier-posted')
    expect(loadDraft(KEY, 'new')!.text).toBe('hi @alice.example.com, and more')
  })

  // R7, one field at a time (Fable R4-N2, Codex R4-N1). A pending send whose
  // record at the rkey differs in only that field is not this send's post.
  const IMG = { id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1, alt: 'a cat', aspectRatio: null }
  const BLOB2 = { ...BLOB, ref: { $link: 'bafkreiother' } }
  const cases: [string, ComposeDraft, (r: BlueskyPostRecord) => BlueskyPostRecord][] = [
    ['text', draft({ text: 'mine' }), (r) => ({ ...r, text: 'other' })],
    ['image CID', draft({}, { images: [IMG] }), (r) => ({ ...r, embed: { $type: 'app.bsky.embed.images', images: [{ image: BLOB2, alt: 'a cat' }] } })],
    ['alt text', draft({}, { images: [IMG] }), (r) => ({ ...r, embed: { $type: 'app.bsky.embed.images', images: [{ image: BLOB, alt: 'a dog' }] } })],
    ['self-labels', draft({}, { images: [IMG], labels: ['porn'] }), (r) => ({ ...r, labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] } })],
    ['quote ref', draft({}, { quote: QUOTED }), (r) => ({ ...r, embed: { $type: 'app.bsky.embed.record', record: { ...QUOTED, cid: 'bafyother' } } })],
    ['reply refs', draft({}, { reply: { root: ROOT, parent: PARENT } }), (r) => ({ ...r, reply: { root: ROOT, parent: { ...PARENT, uri: 'at://did:plc:bob/app.bsky.feed.post/other' } } })],
    ['langs', draft({ language: 'en' }), (r) => ({ ...r, langs: ['de'] })],
  ]
  for (const [field, d, change] of cases) {
    it(`R7: another ${field} at the rkey is another content`, async () => {
      const pds = fakePds()
      pds.loseNextAnswer.value = true
      pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
      await expect(postBlueskyDraft(pds.client, 'new', d, noWait)).rejects.toBeTruthy()
      pds.records.set('3krkey0000001', change(pds.records.get('3krkey0000001')!))
      const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
      expect(out.kind).toBe('earlier-posted')
    })
  }
})

describe('postBlueskyDraft: after the post', () => {
  it('loads the post, caches it and says so for the active account', async () => {
    const { client } = fakePds()
    const seen: unknown[] = []
    const on = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener('caribou:posted', on)
    const out = await postBlueskyDraft(client, 'new', draft(), noWait)
    window.removeEventListener('caribou:posted', on)
    expect(out.kind === 'posted' && out.status?.id).toBe(uriOf('3krkey0000001'))
    expect(statusCache.peek().has(uriOf('3krkey0000001'))).toBe(true)
    expect(seen).toHaveLength(1)
  })

  it('an AppView that lags: tries again, then answers posted with no status', async () => {
    const { client } = fakePds()
    client.fetchStatus.mockRejectedValue(new CaribouError('not_found', 'nope'))
    const out = await postBlueskyDraft(client, 'new', draft(), noWait)
    expect(out).toMatchObject({ kind: 'posted', status: null })
    expect(client.fetchStatus).toHaveBeenCalledTimes(3)
  })

  it('an answer that lands after an account switch tells no screen', async () => {
    const { client } = fakePds()
    const seen: unknown[] = []
    const on = (e: Event) => seen.push(e)
    window.addEventListener('caribou:posted', on)
    client.blueskyCreatePost.mockImplementationOnce(async (_r, rkey) => {
      activeUserKey.value = OTHER
      return { uri: uriOf(rkey), cid: 'c' }
    })
    const out = await postBlueskyDraft(client, 'new', draft(), noWait)
    window.removeEventListener('caribou:posted', on)
    expect(out.kind).toBe('posted')
    expect(seen).toHaveLength(0)
    expect(statusCache.peek().size).toBe(0)
  })
})

describe('reply and quote limits (#199)', () => {
  const LIMITS: BlueskyGates = { replies: [{ kind: 'follower' }, { kind: 'mention' }], quotes: false }

  it('G2: the default is the post alone, with no limits argument', async () => {
    const { client, gates } = fakePds()
    saveDraft(KEY, 'new', draft())
    const out = await postBlueskyDraft(client, 'new', draft(), noWait)
    expect(out.kind).toBe('posted')
    expect(client.blueskyCreatePost).toHaveBeenCalledTimes(1)
    expect(client.blueskyCreatePost.mock.calls[0]).toHaveLength(2)
    expect(gates.size).toBe(0)
  })

  it('G3: a limit goes in the same call as the post, with the same rkey, in order', async () => {
    const { client, gates } = fakePds()
    const d = draft({}, { gates: LIMITS })
    saveDraft(KEY, 'new', d)
    await postBlueskyDraft(client, 'new', d, noWait)
    expect(client.blueskyCreatePost).toHaveBeenCalledTimes(1)
    const [, rkey, sent] = client.blueskyCreatePost.mock.calls[0]!
    expect(rkey).toBe('3krkey0000001')
    expect(sent).toEqual({ replies: [{ kind: 'mention' }, { kind: 'follower' }], quotes: false })
    expect(gates.get('3krkey0000001')).toEqual(sent)
  })

  it('G1: a reply sends no limits, whatever the draft holds', async () => {
    const { client } = fakePds()
    const d = draft({}, { reply: { root: ROOT, parent: PARENT }, gates: LIMITS })
    saveDraft(KEY, `reply:${PARENT.uri}`, d)
    await postBlueskyDraft(client, `reply:${PARENT.uri}`, d, noWait)
    expect(client.blueskyCreatePost.mock.calls[0]).toHaveLength(2)
  })

  it('G4: a lost answer, a reload, a retry is one post with its limits', async () => {
    const { client, records, gates, loseNextAnswer } = fakePds()
    const d = draft({}, { gates: LIMITS })
    saveDraft(KEY, 'new', d)
    loseNextAnswer.value = true
    // The check after it fails too, so the send stays pending.
    client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'timeout'))
    await expect(postBlueskyDraft(client, 'new', d, noWait)).rejects.toThrow()
    const reloaded = loadDraft(KEY, 'new')!
    expect(reloaded.bluesky?.sent?.gates).toEqual({ replies: [{ kind: 'mention' }, { kind: 'follower' }], quotes: false })
    const out = await postBlueskyDraft(client, 'new', reloaded, noWait)
    expect(out.kind).toBe('posted')
    expect(client.blueskyCreatePost).toHaveBeenCalledTimes(1)
    expect(records.size).toBe(1)
    expect(gates.size).toBe(1)
  })

  it('G4: a pending send whose post is absent sends its frozen limits again', async () => {
    const { client, gates, failNextBeforeWrite } = fakePds()
    const d = draft({}, { gates: LIMITS })
    saveDraft(KEY, 'new', d)
    // Unknown: the create failed and so did the check, so the send stays pending.
    failNextBeforeWrite.value = new CaribouError('unreachable', 'timeout')
    client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'timeout'))
    await expect(postBlueskyDraft(client, 'new', d, noWait)).rejects.toThrow()
    const pending = loadDraft(KEY, 'new')!
    expect(pending.bluesky?.sent).not.toBeNull()
    const out = await postBlueskyDraft(client, 'new', pending, noWait)
    expect(out.kind).toBe('posted')
    expect(gates.get('3krkey0000001')).toEqual({ replies: [{ kind: 'mention' }, { kind: 'follower' }], quotes: false })
  })

  it('G4: a limit changed after a lost answer is an edit: earlier-posted, the new limit kept', async () => {
    const { client, loseNextAnswer } = fakePds()
    const d = draft({}, { gates: LIMITS })
    saveDraft(KEY, 'new', d)
    loseNextAnswer.value = true
    // The check after it fails too, so the send stays pending.
    client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'timeout'))
    await expect(postBlueskyDraft(client, 'new', d, noWait)).rejects.toThrow()
    const stored = loadDraft(KEY, 'new')!
    const edited: ComposeDraft = { ...stored, bluesky: { ...stored.bluesky!, gates: { replies: null, quotes: true } } }
    saveDraft(KEY, 'new', edited)
    const out = await postBlueskyDraft(client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('earlier-posted')
    if (out.kind !== 'earlier-posted') return
    expect(out.draft.bluesky?.gates).toEqual({ replies: null, quotes: true })
    expect(out.draft.bluesky?.rkey).not.toBe('3krkey0000001')
    expect(client.blueskyCreatePost).toHaveBeenCalledTimes(1)
  })

  it('G4 (review 1): the retry changed only the limits, the original write lands late: earlier-posted, the new limits kept', async () => {
    const { client, records, gates, failNextBeforeWrite, beforeNextCreate } = fakePds()
    // 1. An unrestricted send: the create gets no answer and the check fails, so it is pending.
    //    Its write is still on the way.
    saveDraft(KEY, 'new', draft())
    failNextBeforeWrite.value = new CaribouError('unreachable', 'timeout')
    client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'timeout'))
    await expect(postBlueskyDraft(client, 'new', draft(), noWait)).rejects.toThrow()
    const pending = loadDraft(KEY, 'new')!
    const original = pending.bluesky!.sent!.record
    // 2. The reader changes only the limits.
    const edited: ComposeDraft = { ...pending, bluesky: { ...pending.bluesky!, gates: { replies: [], quotes: false } } }
    saveDraft(KEY, 'new', edited)
    // 3. The retry's first check: absent. 4. The original write lands before the retry's create,
    //    so the retry's create fails and the recovery check finds the original post.
    beforeNextCreate.value = () => { records.set('3krkey0000001', original) }
    const out = await postBlueskyDraft(client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(gates.size).toBe(0)
    expect(out.kind).toBe('earlier-posted')
    if (out.kind !== 'earlier-posted') return
    expect(out.draft.bluesky?.gates).toEqual({ replies: [], quotes: false })
    expect(out.draft.bluesky?.rkey).not.toBe('3krkey0000001')
    expect(loadDraft(KEY, 'new')?.bluesky?.gates).toEqual({ replies: [], quotes: false })
  })

  it('G4: the check found the post with the limits this send froze: posted', async () => {
    const { client, loseNextAnswer } = fakePds()
    const d = draft({}, { gates: LIMITS })
    saveDraft(KEY, 'new', d)
    loseNextAnswer.value = true
    const out = await postBlueskyDraft(client, 'new', d, noWait)
    expect(out.kind).toBe('posted')
    expect(client.blueskyGetOwnGates).toHaveBeenCalledWith('3krkey0000001')
  })

  it('G4: the gate read fails: nothing more is sent, the send stays pending', async () => {
    const { client, loseNextAnswer } = fakePds()
    const d = draft({}, { gates: LIMITS })
    saveDraft(KEY, 'new', d)
    loseNextAnswer.value = true
    client.blueskyGetOwnGates.mockRejectedValueOnce(new CaribouError('unreachable', 'timeout'))
    await expect(postBlueskyDraft(client, 'new', d, noWait)).rejects.toThrow()
    expect(loadDraft(KEY, 'new')?.bluesky?.sent).not.toBeNull()
    expect(client.blueskyCreatePost).toHaveBeenCalledTimes(1)
    // The next Post checks again and settles it.
    const out = await postBlueskyDraft(client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('posted')
    expect(client.blueskyCreatePost).toHaveBeenCalledTimes(1)
  })

  it('a send answered by the PDS itself does not read the gates', async () => {
    const { client } = fakePds()
    saveDraft(KEY, 'new', draft({}, { gates: LIMITS }))
    await postBlueskyDraft(client, 'new', draft({}, { gates: LIMITS }), noWait)
    expect(client.blueskyGetOwnGates).not.toHaveBeenCalled()
  })
})
