import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueskyBlobRef, BlueskyOwnPost, BlueskyPostRecord, CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import { CaribouError } from '@beatzball/caribou-mastodon-client'
import { emptyDraft, isDraftEmpty, loadDraft, saveDraft, type BlueskyDraftCard, type ComposeDraft } from '../compose.js'
import { blueskyDraftInput, blueskyRecord, DraftChanged, DraftNotSaved, emptyBlueskyDraft, postBlueskyDraft } from '../bluesky-compose.js'
import { cardAllowed, prepareCardThumb } from '../bluesky-link-card.js'
import { statusCache } from '../caches.js'
import { activeUserKey, users } from '../users.js'

const KEY = 'did:plc:reader@bsky' as const
const OTHER = 'did:plc:other@bsky' as const
const QUOTED = { uri: 'at://did:plc:carol/app.bsky.feed.post/q1', cid: 'bafyquote' }
const PARENT = { uri: 'at://did:plc:bob/app.bsky.feed.post/p1', cid: 'bafyparent' }
const IMG: BlueskyBlobRef = { $type: 'blob', ref: { $link: 'bafkreiimg' }, mimeType: 'image/jpeg', size: 1000 }
const THUMB: BlueskyBlobRef = { $type: 'blob', ref: { $link: 'bafkreithumb' }, mimeType: 'image/jpeg', size: 500 }
const IMAGE_URL = 'https://cardyb.bsky.app/v1/image?url=x'

function card(over: Partial<BlueskyDraftCard> = {}): BlueskyDraftCard {
  return { uri: 'https://example.com/a', title: 'A title', description: 'A description', image: IMAGE_URL, thumb: null, ...over }
}

function draft(bsky: Partial<NonNullable<ComposeDraft['bluesky']>> = {}, over: Partial<ComposeDraft> = {}): ComposeDraft {
  return emptyDraft({ text: 'see https://example.com/a', ...over, bluesky: { ...emptyBlueskyDraft({ rkey: '3krkey0000001' }), ...bsky } })
}

const AT = '2026-11-10T00:00:00.000Z'

beforeEach(() => {
  localStorage.clear()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = KEY
})

describe('the record with a card (K2, K3)', () => {
  it('K3: a card with no thumb is an external embed with no thumb', () => {
    const r = blueskyRecord(draft({ card: card() }), [], AT)
    expect(r.embed).toEqual({
      $type: 'app.bsky.embed.external',
      external: { uri: 'https://example.com/a', title: 'A title', description: 'A description' },
    })
  })

  it('K3: a card with a thumb carries it', () => {
    const r = blueskyRecord(draft({ card: card({ thumb: THUMB }) }), [], AT)
    expect((r.embed as unknown as { external: { thumb?: unknown } }).external.thumb).toEqual(THUMB)
  })

  it('K2: images win: no card in the record', () => {
    const images = [{ id: 'i1', blob: IMG, mime: 'image/jpeg', size: 1000, alt: '', aspectRatio: null }]
    const r = blueskyRecord(draft({ card: card(), images }), [], AT)
    expect(r.embed?.$type).toBe('app.bsky.embed.images')
  })

  it('K2: a quote wins: no card in the record', () => {
    const r = blueskyRecord(draft({ card: card(), quote: QUOTED }), [], AT)
    expect(r.embed?.$type).toBe('app.bsky.embed.record')
  })

  it('K2: a reply can have a card', () => {
    const r = blueskyRecord(draft({ card: card(), reply: { root: PARENT, parent: PARENT } }), [], AT)
    expect(r.reply).toBeDefined()
    expect(r.embed?.$type).toBe('app.bsky.embed.external')
  })

  it('K2: cardAllowed is false with images or a quote', () => {
    const images = [{ id: 'i1', blob: IMG, mime: 'image/jpeg', size: 1000, alt: '', aspectRatio: null }]
    expect(cardAllowed(draft())).toBe(true)
    expect(cardAllowed(draft({ images }))).toBe(false)
    expect(cardAllowed(draft({ quote: QUOTED }))).toBe(false)
  })

  it('K5: the input changes with the card and its thumb', () => {
    const a = blueskyDraftInput(draft({ card: card() }))
    expect(blueskyDraftInput(draft())).not.toBe(a)
    expect(blueskyDraftInput(draft({ card: card({ title: 'Other' }) }))).not.toBe(a)
    expect(blueskyDraftInput(draft({ card: card({ thumb: THUMB }) }))).not.toBe(a)
  })

  it('K6: a card alone does not make a draft non-empty', () => {
    expect(isDraftEmpty(draft({ card: card() }, { text: '' }))).toBe(true)
  })
})

function client(upload = vi.fn(async (_b: Blob) => THUMB)) {
  return { userKey: KEY, blueskyUploadBlob: upload } as unknown as CaribouClient & { blueskyUploadBlob: typeof upload }
}

describe('prepareCardThumb (K4)', () => {
  it('uploads the image once and stores the thumb', async () => {
    const c = client()
    const load = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }))
    const out = await prepareCardThumb(c, 'new', draft({ card: card() }), { loadImage: load })
    expect(out?.bluesky?.card?.thumb).toEqual(THUMB)
    expect(load).toHaveBeenCalledWith(IMAGE_URL)
    // A second Post with the stored thumb uploads nothing.
    const again = await prepareCardThumb(c, 'new', out!, { loadImage: load })
    expect(again).toBe(out)
    expect(c.blueskyUploadBlob).toHaveBeenCalledTimes(1)
  })

  it('an image that fails to load: the card goes without it, and that is kept', async () => {
    const c = client()
    const out = await prepareCardThumb(c, 'new', draft({ card: card() }), { loadImage: async () => { throw new Error('nope') } })
    expect(out?.bluesky?.card).toMatchObject({ image: null, thumb: null, title: 'A title' })
    expect(c.blueskyUploadBlob).not.toHaveBeenCalled()
  })

  it('an upload that fails: the card goes without the image', async () => {
    const c = client(vi.fn(async () => { throw new CaribouError('server_error', 'boom', { status: 500 }) }))
    const out = await prepareCardThumb(c, 'new', draft({ card: card() }), { loadImage: async () => new Blob(['x']) })
    expect(out?.bluesky?.card).toMatchObject({ image: null, thumb: null })
  })

  it('a card with no image is left as it is', async () => {
    const c = client()
    const d = draft({ card: card({ image: null }) })
    expect(await prepareCardThumb(c, 'new', d, { loadImage: vi.fn() })).toBe(d)
    expect(c.blueskyUploadBlob).not.toHaveBeenCalled()
  })

  it('a pending send is not changed', async () => {
    const c = client()
    const d = draft({ card: card(), sent: { input: 'x', record: { $type: 'app.bsky.feed.post', text: 't', createdAt: AT } } })
    expect(await prepareCardThumb(c, 'new', d, { loadImage: vi.fn() })).toBe(d)
    expect(c.blueskyUploadBlob).not.toHaveBeenCalled()
  })

  it('a card that is not allowed (images) is left as it is', async () => {
    const c = client()
    const images = [{ id: 'i1', blob: IMG, mime: 'image/jpeg', size: 1000, alt: '', aspectRatio: null }]
    const d = draft({ card: card(), images })
    expect(await prepareCardThumb(c, 'new', d, { loadImage: vi.fn() })).toBe(d)
  })

  it('K7: the prepared draft is stored, under a new revision', async () => {
    const c = client()
    const out = await prepareCardThumb(c, 'new', draft({ card: card() }), { loadImage: async () => new Blob(['x']) })
    expect(loadDraft(KEY, 'new')?.bluesky?.card?.thumb).toEqual(THUMB)
    expect(out?.rev).toBe(loadDraft(KEY, 'new')?.rev)
  })

  it('K7: another save during the upload wins: DraftChanged, and that save stays', async () => {
    let release!: () => void
    const c = client(vi.fn(() => new Promise<BlueskyBlobRef>((r) => { release = () => r(THUMB) })))
    const d = draft({ card: card() })
    saveDraft(KEY, 'new', d)
    const out = prepareCardThumb(c, 'new', d, { loadImage: async () => new Blob(['x']) })
    await new Promise((r) => setTimeout(r, 0))
    // Another tab saves newer text into the same slot.
    saveDraft(KEY, 'new', { ...d, text: 'newer text from another tab' })
    release()
    await expect(out).rejects.toBeInstanceOf(DraftChanged)
    expect(loadDraft(KEY, 'new')?.text).toBe('newer text from another tab')
  })

  it('K7: storage refusing the prepared draft: DraftNotSaved', async () => {
    const c = client()
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    try {
      await expect(prepareCardThumb(c, 'new', draft({ card: card() }), { loadImage: async () => new Blob(['x']) }))
        .rejects.toBeInstanceOf(DraftNotSaved)
    } finally {
      spy.mockRestore()
    }
  })

  it('an account switch during the upload: null, nothing changes', async () => {
    let release!: () => void
    const c = client(vi.fn(() => new Promise<BlueskyBlobRef>((r) => { release = () => r(THUMB) })))
    const out = prepareCardThumb(c, 'new', draft({ card: card() }), { loadImage: async () => new Blob(['x']) })
    await new Promise((r) => setTimeout(r, 0))
    activeUserKey.value = OTHER
    release()
    expect(await out).toBeNull()
  })
})

describe('R7 with a card (K5)', () => {
  function pds(alterTitle = false) {
    const records = new Map<string, BlueskyPostRecord>()
    let lose = true
    const c = {
      userKey: KEY,
      blueskyNextRkey: vi.fn(async () => '3krkey0000009'),
      blueskyDetectFacets: vi.fn(async () => []),
      blueskyCreatePost: vi.fn(async (record: BlueskyPostRecord, rkey: string) => {
        records.set(rkey, record)
        if (lose) {
          lose = false
          throw new CaribouError('unreachable', 'timeout')
        }
        return { uri: `at://did:plc:reader/app.bsky.feed.post/${rkey}`, cid: 'bafy' }
      }),
      // The PDS gives the thumb back as an SDK-like object: CID by string.
      blueskyGetOwnPost: vi.fn(async (rkey: string): Promise<BlueskyOwnPost | null> => {
        const value = records.get(rkey)
        if (!value) return null
        const ext = (value.embed as unknown as { external: Record<string, unknown> }).external
        const thumb = { ref: { toString: () => 'bafkreithumb' }, mimeType: 'image/jpeg', size: 500 }
        const title = alterTitle ? 'Another title' : ext.title
        return { uri: `at://did:plc:reader/app.bsky.feed.post/${rkey}`, cid: 'bafy', value: { ...value, embed: { ...value.embed!, external: { ...ext, title, thumb } } } }
      }),
      // #199: the check also reads the gates; none here (the default).
      blueskyGetOwnGates: vi.fn(async () => ({ replies: null, quotes: true })),
      fetchStatus: vi.fn(async (id: string) => ({ id, uri: id }) as unknown as Status),
    } as unknown as CaribouClient
    return { c, records }
  }

  it('a lost answer, then the check: one post, read as ours (thumb CID from an SDK object)', async () => {
    const { c, records } = pds()
    const out = await postBlueskyDraft(c, 'new', draft({ card: card({ thumb: THUMB }) }), { wait: () => Promise.resolve() })
    expect(out.kind).toBe('posted')
    expect(records.size).toBe(1)
  })

  it('a found record with another card is not read as ours', async () => {
    const { c } = pds(true)
    const out = await postBlueskyDraft(c, 'new', draft({ card: card({ thumb: THUMB }) }), { wait: () => Promise.resolve() })
    expect(out.kind).toBe('earlier-posted')
  })
})

// K8: an input frozen by the version before #200, in its exact shape.
describe('a pending send frozen before link cards (K8)', () => {
  function legacy() {
    const d = emptyDraft({ text: 'hello', bluesky: emptyBlueskyDraft({ rkey: '3krkey0000001' }) })
    const input = JSON.stringify({ text: 'hello', language: null, reply: null, quote: null, labels: [], images: [] })
    const record: BlueskyPostRecord = { $type: 'app.bsky.feed.post', text: 'hello', createdAt: AT }
    return { ...d, bluesky: { ...d.bluesky!, sent: { input, record } } }
  }
  function pdsWith(records: Map<string, BlueskyPostRecord>) {
    return {
      userKey: KEY,
      blueskyNextRkey: vi.fn(async () => '3krkey0000009'),
      blueskyDetectFacets: vi.fn(async () => []),
      blueskyCreatePost: vi.fn(async (record: BlueskyPostRecord, rkey: string) => {
        records.set(rkey, record)
        return { uri: `at://did:plc:reader/app.bsky.feed.post/${rkey}`, cid: 'bafy' }
      }),
      blueskyGetOwnPost: vi.fn(async (rkey: string): Promise<BlueskyOwnPost | null> => {
        const value = records.get(rkey)
        return value ? { uri: `at://did:plc:reader/app.bsky.feed.post/${rkey}`, cid: 'bafy', value } : null
      }),
      // #199: the check also reads the gates; none here (the default).
      blueskyGetOwnGates: vi.fn(async () => ({ replies: null, quotes: true })),
      fetchStatus: vi.fn(async (id: string) => ({ id, uri: id }) as unknown as Status),
    }
  }

  it('the old input equals the unchanged draft', () => {
    const d = legacy()
    expect(blueskyDraftInput(d)).toBe(d.bluesky.sent.input)
  })

  it('the PDS has the record: posted, no new draft', async () => {
    const d = legacy()
    const c = pdsWith(new Map([['3krkey0000001', d.bluesky.sent.record]]))
    saveDraft(KEY, 'new', d)
    const out = await postBlueskyDraft(c as unknown as CaribouClient, 'new', d, { wait: () => Promise.resolve() })
    expect(out.kind).toBe('posted')
    expect(c.blueskyCreatePost).not.toHaveBeenCalled()
    expect(loadDraft(KEY, 'new')).toBeNull()
  })

  it('the rkey is absent: the frozen record goes again as it is', async () => {
    const d = legacy()
    const c = pdsWith(new Map())
    saveDraft(KEY, 'new', d)
    const out = await postBlueskyDraft(c as unknown as CaribouClient, 'new', d, { wait: () => Promise.resolve() })
    expect(out.kind).toBe('posted')
    expect(c.blueskyCreatePost).toHaveBeenCalledTimes(1)
    expect(c.blueskyCreatePost.mock.calls[0]![0]).toEqual(d.bluesky.sent.record)
    expect(c.blueskyDetectFacets).not.toHaveBeenCalled()
  })
})
