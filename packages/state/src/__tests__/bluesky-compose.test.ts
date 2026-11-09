import { beforeEach, describe, expect, it, vi } from 'vitest'
// Note: a test may replace localStorage.setItem; it is restored by its own flag.
import type {
  BlueskyBlobRef, BlueskyOwnPost, BlueskyPostRecord, CaribouClient, Status,
} from '@beatzball/caribou-mastodon-client'
import { CaribouError } from '@beatzball/caribou-mastodon-client'
import { emptyDraft, isDraftEmpty, loadDraft, saveDraft, type ComposeDraft } from '../compose.js'
import {
  blueskyDraftInput, blueskyRecord, emptyBlueskyDraft, postBlueskyDraft, BLUESKY_SELF_LABELS, DraftNotSaved,
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
  let rkeys = 0
  const loseNextAnswer = { value: false }
  const failNextBeforeWrite = { value: null as Error | null }
  const client = {
    userKey: KEY,
    blueskyNextRkey: vi.fn(async () => `3krkey${String(++rkeys).padStart(7, '0')}`),
    blueskyDetectFacets: vi.fn(async (text: string) => text.includes('#tag')
      ? [{ index: { byteStart: text.indexOf('#tag'), byteEnd: text.indexOf('#tag') + 4 }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tag' }] }]
      : []),
    blueskyCreatePost: vi.fn(async (record: BlueskyPostRecord, rkey: string) => {
      if (failNextBeforeWrite.value) {
        const err = failNextBeforeWrite.value
        failNextBeforeWrite.value = null
        throw err
      }
      // The PDS does not check first: a used key is a plain 500 (spec 7.2).
      if (records.has(rkey)) throw new CaribouError('server_error', 'Internal Server Error', { status: 500 })
      records.set(rkey, record)
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
    fetchStatus: vi.fn(async (id: string) => ({ id, uri: id, account: { id: 'did:plc:reader' } }) as unknown as Status),
  }
  return { client: client as unknown as CaribouClient & typeof client, records, loseNextAnswer, failNextBeforeWrite }
}

function draft(over: Partial<ComposeDraft> = {}, bsky: Partial<NonNullable<ComposeDraft['bluesky']>> = {}): ComposeDraft {
  return emptyDraft({ text: 'hello', ...over, bluesky: { ...emptyBlueskyDraft(), ...bsky } })
}

const noWait = { wait: () => Promise.resolve() }

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

  it('self-labels go on a post with images, only from the menu, in menu order', () => {
    const img = [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1000, alt: '', aspectRatio: null }]
    const r = blueskyRecord(draft({}, { images: img, labels: ['graphic-media', 'nonsense', 'porn'] }), [], 't')
    expect(r.labels).toEqual({ $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'porn' }, { val: 'graphic-media' }] })
    expect(BLUESKY_SELF_LABELS.map((l) => l.value)).toEqual(['porn', 'nudity', 'graphic-media'])
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
    expect(loadDraft(KEY, 'reply:at://p1')).toEqual(d)
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
    if (out.kind === 'earlier-posted') expect(out.draft).toEqual(kept)
  })

  it('record not found: the retry sends the same frozen record with the same rkey, once', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('server_error', 'Bad Gateway', { status: 502 })
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'again' }), noWait)).rejects.toBeTruthy()
    const kept = loadDraft(KEY, 'new')!
    const frozen = kept.bluesky!.sent!.record
    const out = await postBlueskyDraft(pds.client, 'new', kept, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(2)
    expect(pds.client.blueskyCreatePost.mock.calls[1]).toEqual([frozen, '3krkey0000001'])
    // Same createdAt, no second facet lookup.
    expect(pds.client.blueskyDetectFacets).toHaveBeenCalledTimes(1)
    expect(pds.records.size).toBe(1)
  })

  it('record not found after edits: the frozen record goes with its rkey, and the edit stays for a new rkey (rule 1)', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('server_error', 'Bad Gateway', { status: 502 })
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)).rejects.toBeTruthy()
    const edited = { ...loadDraft(KEY, 'new')!, text: 'v2' }
    const out = await postBlueskyDraft(pds.client, 'new', edited, noWait)
    expect(pds.records.get('3krkey0000001')!.text).toBe('v1')
    expect(pds.records.size).toBe(1)
    expect(out.kind).toBe('earlier-posted')
    const kept = loadDraft(KEY, 'new')!
    expect(kept.text).toBe('v2')
    expect(kept.bluesky!.rkey).toBe('3krkey0000002')
    expect(kept.bluesky!.sent).toBeNull()
  })

  it('v1 times out unwritten, the reader edits to v2, v1 lands late: the edit is not lost (review: Fable B1, Codex 2)', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('unreachable', 'timeout')
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)).rejects.toBeTruthy()
    const v1 = loadDraft(KEY, 'new')!
    const v1Record = v1.bluesky!.sent!.record
    const edited = { ...v1, text: 'v2 with my edits' }
    saveDraft(KEY, 'new', edited)
    pds.client.blueskyGetOwnPost.mockImplementationOnce(async () => {
      pds.records.set('3krkey0000001', v1Record)
      return null
    })
    await expect(postBlueskyDraft(pds.client, 'new', edited, noWait)).rejects.toMatchObject({ code: 'server_error' })
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect([...pds.records.values()].map((r) => r.text)).toEqual(['v1'])
    expect(out.kind).toBe('earlier-posted')
    expect(loadDraft(KEY, 'new')!.text).toBe('v2 with my edits')
  })

  it('a found record that is not the frozen one is never read as posted', async () => {
    const pds = fakePds()
    pds.loseNextAnswer.value = true
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'mine' }), noWait)).rejects.toBeTruthy()
    pds.records.set('3krkey0000001', { $type: 'app.bsky.feed.post', text: 'other', createdAt: 'x' })
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('earlier-posted')
    expect(loadDraft(KEY, 'new')!.text).toBe('mine')
  })

  it('a 400 that is not RecordNotFound sends nothing (rule 1)', async () => {
    const pds = fakePds()
    pds.loseNextAnswer.value = true
    await expect(postBlueskyDraft(pds.client, 'new', draft(), noWait)).rejects.toBeTruthy()
    pds.records.clear()
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('not_found', 'AccountDeactivated', { status: 400 }))
    await expect(postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)).rejects.toBeTruthy()
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(1)
  })

  it('storage refuses the freeze: nothing is sent, the caller hears; then one post (rule 2, Codex 1, Fable N1)', async () => {
    const pds = fakePds()
    const real = localStorage.setItem.bind(localStorage)
    let refuse = true
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true,
      value: (k: string, v: string) => {
        if (refuse && k.startsWith('caribou.drafts.')) throw new DOMException('full', 'QuotaExceededError')
        return real(k, v)
      },
    })
    const spy = { mockRestore: () => { refuse = false } }
    pds.loseNextAnswer.value = true
    const seen: ComposeDraft[] = []
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'once' }), { ...noWait, onDraft: (d) => seen.push(d) }))
      .rejects.toBeInstanceOf(DraftNotSaved)
    expect(pds.client.blueskyCreatePost).not.toHaveBeenCalled()
    // Memory still has the rkey and the frozen record.
    expect(seen.at(-1)!.bluesky!.sent).not.toBeNull()
    spy.mockRestore()
    await expect(postBlueskyDraft(pds.client, 'new', seen.at(-1)!, noWait)).rejects.toBeTruthy()
    await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(pds.records.size).toBe(1)
  })

  it('the caller gets the frozen draft before the network (rule 2)', async () => {
    const pds = fakePds()
    let atSend: ComposeDraft | null = null
    let latest: ComposeDraft | null = null
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      atSend = latest
      pds.records.set(rkey, record)
      return { uri: uriOf(rkey), cid: 'c' }
    })
    await postBlueskyDraft(pds.client, 'new', draft(), { ...noWait, onDraft: (d) => { latest = d } })
    expect(atSend!.bluesky!.rkey).toBe('3krkey0000001')
    expect(atSend!.bluesky!.sent).not.toBeNull()
  })

  it('an old send that succeeds keeps a newer edit stored in its slot (rule 3, Codex 4)', async () => {
    const pds = fakePds()
    let release: () => void = () => {}
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      await new Promise<void>((r) => { release = r })
      pds.records.set(rkey, record)
      return { uri: uriOf(rkey), cid: 'c' }
    })
    const sending = postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)
    await new Promise((r) => setTimeout(r, 0))
    // Closed and reopened: the new dialog loads the stored draft and edits it.
    saveDraft(KEY, 'new', { ...loadDraft(KEY, 'new')!, text: 'v1, edited' })
    release()
    await sending
    const kept = loadDraft(KEY, 'new')!
    expect(kept.text).toBe('v1, edited')
    expect(kept.bluesky!.sent).toBeNull()
    expect(kept.bluesky!.rkey).not.toBe('3krkey0000001')
  })

  it('an old send leaves another draft in its slot alone (rule 3)', async () => {
    const pds = fakePds()
    let release: () => void = () => {}
    pds.client.blueskyCreatePost.mockImplementationOnce(async (record, rkey) => {
      await new Promise<void>((r) => { release = r })
      pds.records.set(rkey, record)
      return { uri: uriOf(rkey), cid: 'c' }
    })
    const sending = postBlueskyDraft(pds.client, 'new', draft({ text: 'v1' }), noWait)
    await new Promise((r) => setTimeout(r, 0))
    saveDraft(KEY, 'new', draft({ text: 'a new one' }))
    release()
    await sending
    expect(loadDraft(KEY, 'new')!.text).toBe('a new one')
  })

  it('a blob refusal unfreezes: the next send freezes a new record with the same rkey', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new BlueskyBlobNotFoundLike('Could not find blob: bafkreiimg')
    const img = [{ id: 'i1', blob: BLOB, mime: 'image/jpeg', size: 1, alt: '', aspectRatio: null }]
    const seen: ComposeDraft[] = []
    await expect(postBlueskyDraft(pds.client, 'new', draft({}, { images: img }), { ...noWait, onDraft: (d) => seen.push(d) })).rejects.toBeTruthy()
    const after = loadDraft(KEY, 'new')!
    expect(after.bluesky!.sent).toBeNull()
    expect(after.bluesky!.rkey).toBe('3krkey0000001')
    expect(seen.at(-1)).toEqual(after)
    await postBlueskyDraft(pds.client, 'new', { ...after, text: 'edited after' }, noWait)
    expect(pds.records.get('3krkey0000001')!.text).toBe('edited after')
    expect(pds.client.blueskyGetOwnPost).not.toHaveBeenCalled()
  })

  it('a failed check sends nothing: an unknown answer is never "not found"', async () => {
    const pds = fakePds()
    pds.loseNextAnswer.value = true
    await expect(postBlueskyDraft(pds.client, 'new', draft(), noWait)).rejects.toBeTruthy()
    pds.client.blueskyGetOwnPost.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    await expect(postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)).rejects.toMatchObject({ code: 'unreachable' })
    expect(pds.client.blueskyCreatePost).toHaveBeenCalledTimes(1)
    expect(loadDraft(KEY, 'new')!.bluesky!.sent).not.toBeNull()
  })

  it('a late first write that lands after the check: the second create fails, and the next retry finds it', async () => {
    const pds = fakePds()
    pds.failNextBeforeWrite.value = new CaribouError('unreachable', 'timeout')
    await expect(postBlueskyDraft(pds.client, 'new', draft({ text: 'late' }), noWait)).rejects.toBeTruthy()
    const kept = loadDraft(KEY, 'new')!
    // The first request reaches the PDS late, after the check said "not found".
    pds.client.blueskyGetOwnPost.mockImplementationOnce(async () => {
      pds.records.set('3krkey0000001', kept.bluesky!.sent!.record)
      return null
    })
    await expect(postBlueskyDraft(pds.client, 'new', kept, noWait)).rejects.toMatchObject({ code: 'server_error' })
    const out = await postBlueskyDraft(pds.client, 'new', loadDraft(KEY, 'new')!, noWait)
    expect(out.kind).toBe('posted')
    expect(pds.records.size).toBe(1)
  })
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
