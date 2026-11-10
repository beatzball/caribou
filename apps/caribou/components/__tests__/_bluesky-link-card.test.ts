import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyBlueskyDraft, emptyDraft, type BlueskyDraftCard, type ComposeDraft } from '@beatzball/caribou-state'
import { cardLink } from '../../../../packages/bluesky-client/src/compose.js'
import { LINK_CARD_DELAY_MS, LinkCardWatcher } from '../_bluesky-link-card.js'

const A = 'https://example.com/a'
const B = 'https://example.org/b'
const QUOTED = { uri: 'at://did:plc:carol/app.bsky.feed.post/q1', cid: 'bafyquote' }
const IMG = { id: 'i1', blob: { $type: 'blob' as const, ref: { $link: 'bafk' }, mimeType: 'image/jpeg', size: 1 }, mime: 'image/jpeg', size: 1, alt: '', aspectRatio: null }

function data(uri: string) {
  return { uri, title: `Title of ${uri}`, description: 'd', image: null }
}

// A tiny dialog: one draft, `apply` writes the card into it.
type Data = ReturnType<typeof data>
function harness(fetchCard: (url: string, s: AbortSignal) => Promise<Data | null> = vi.fn(async (url: string) => data(url))) {
  let draft: ComposeDraft = emptyDraft({ bluesky: emptyBlueskyDraft({ rkey: 'r' }) })
  let owned = true
  const w = new LinkCardWatcher({
    findLink: cardLink,
    fetchCard,
    current: () => owned ? draft : null,
    apply: (card: BlueskyDraftCard | null) => {
      draft = { ...draft, bluesky: { ...draft.bluesky!, card } }
      w.check(draft)
    },
  })
  const edit = (text: string, b: Partial<NonNullable<ComposeDraft['bluesky']>> = {}) => {
    draft = { ...draft, text, bluesky: { ...draft.bluesky!, ...b } }
    w.check(draft)
  }
  // A send freezes the draft without telling the watcher (posting skips check).
  const freeze = (sent: NonNullable<ComposeDraft['bluesky']>['sent']) => {
    draft = { ...draft, bluesky: { ...draft.bluesky!, sent } }
  }
  return { w, fetchCard: vi.mocked(fetchCard), edit, freeze, draft: () => draft, disown: () => { owned = false } }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('LinkCardWatcher', () => {
  it('rule 3: typing a link fires one fetch, after the pause', async () => {
    const h = harness()
    const text = `see ${A}`
    for (let i = 5; i <= text.length; i++) {
      h.edit(text.slice(0, i))
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(h.fetchCard).not.toHaveBeenCalledWith(A, expect.anything())
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.fetchCard.mock.calls.filter(([u]) => u === A)).toHaveLength(1)
    expect(h.draft().bluesky?.card).toMatchObject({ uri: A, title: `Title of ${A}`, thumb: null })
  })

  it('rule 3: no fetch for text with the same link', async () => {
    const h = harness()
    h.edit(`see ${A}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    h.edit(`see ${A} and more words`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.fetchCard).toHaveBeenCalledTimes(1)
  })

  it('rule 4: a late answer for a link no longer in the text is dropped', async () => {
    let release!: () => void
    const fetchCard = vi.fn((url: string) => new Promise<ReturnType<typeof data>>((r) => { release = () => r(data(url)) }))
    const h = harness(fetchCard)
    h.edit(`see ${A}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    // The reader deletes the link while the fetch runs.
    h.edit('see')
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.draft().bluesky?.card ?? null).toBeNull()
  })

  it('rule 3: a newer link aborts the older fetch', async () => {
    const signals: AbortSignal[] = []
    const fetchCard = vi.fn((url: string, s: AbortSignal) => {
      signals.push(s)
      return new Promise<ReturnType<typeof data>>((r) => setTimeout(() => r(data(url)), 1000))
    })
    const h = harness(fetchCard)
    h.edit(`see ${A}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    h.edit(`see ${B}`)
    expect(signals[0]!.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS + 1000)
    expect(h.draft().bluesky?.card?.uri).toBe(B)
  })

  it('rule 4: an answer after the dialog let go is dropped', async () => {
    const h = harness()
    h.edit(`see ${A}`)
    h.disown()
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.draft().bluesky?.card ?? null).toBeNull()
  })

  it('rule 1: a new first link replaces the card; no link removes it', async () => {
    const h = harness()
    h.edit(`see ${A}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    h.edit(`see ${B} then ${A}`)
    expect(h.draft().bluesky?.card ?? null).toBeNull()
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.draft().bluesky?.card?.uri).toBe(B)
    h.edit('no link')
    expect(h.draft().bluesky?.card ?? null).toBeNull()
  })

  it('rule 2: no fetch with an image or a quote; an image removes the card', async () => {
    const h = harness()
    h.edit(`see ${A}`, { quote: QUOTED })
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.fetchCard).not.toHaveBeenCalled()
    h.edit(`see ${A}`, { quote: null })
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.draft().bluesky?.card?.uri).toBe(A)
    h.edit(`see ${A}`, { images: [IMG] })
    expect(h.draft().bluesky?.card ?? null).toBeNull()
    // Rule 2: removing the last image lets the card come back.
    h.edit(`see ${A}`, { images: [] })
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.draft().bluesky?.card?.uri).toBe(A)
  })

  it('rule 4: an image added while the fetch runs drops the answer', async () => {
    let release!: () => void
    const fetchCard = vi.fn((url: string) => new Promise<ReturnType<typeof data>>((r) => { release = () => r(data(url)) }))
    const h = harness(fetchCard)
    h.edit(`see ${A}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    h.edit(`see ${A}`, { images: [IMG] })
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.draft().bluesky?.card ?? null).toBeNull()
  })

  it('rule 5: a removed card does not come back for its link; another link fetches', async () => {
    const h = harness()
    h.edit(`see ${A}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    h.edit(`see ${A}`, { card: null, cardDismissed: A })
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.draft().bluesky?.card ?? null).toBeNull()
    expect(h.fetchCard).toHaveBeenCalledTimes(1)
    h.edit(`see ${B}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.draft().bluesky?.card?.uri).toBe(B)
  })

  it('C1: no card data is no card', async () => {
    const h = harness(vi.fn(async () => null))
    h.edit(`see ${A}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.draft().bluesky?.card ?? null).toBeNull()
  })

  it('stop() drops a pending fetch', async () => {
    const h = harness()
    h.edit(`see ${A}`)
    h.w.stop()
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.fetchCard).not.toHaveBeenCalled()
  })

  it('rule 9: a link with no card is not asked again at the next pause', async () => {
    const h = harness(vi.fn(async () => null))
    for (const tail of ['', ' and', ' and more', ' and more words']) {
      h.edit(`see ${A}${tail}`)
      await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    }
    expect(h.fetchCard).toHaveBeenCalledTimes(1)
    // Another link is still asked.
    h.edit(`see ${B}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.fetchCard).toHaveBeenCalledTimes(2)
  })

  const SENT = { input: 'frozen', record: { $type: 'app.bsky.feed.post' as const, text: 't', createdAt: '2026-11-10T00:00:00.000Z' } }

  it('rule 10: no fetch and no card change while a send is pending', async () => {
    const h = harness()
    h.edit(`see ${A}`, { sent: SENT })
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    expect(h.fetchCard).not.toHaveBeenCalled()
    expect(h.draft().bluesky?.card ?? null).toBeNull()
  })

  it('rule 10: a card is not removed under a pending send', async () => {
    const h = harness()
    h.edit(`see ${A}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    h.edit('no link now', { sent: SENT })
    expect(h.draft().bluesky?.card?.uri).toBe(A)
  })

  it('rule 10: an answer that lands after a send started is dropped', async () => {
    let release!: () => void
    const fetchCard = vi.fn((url: string) => new Promise<Data>((r) => { release = () => r(data(url)) }))
    const h = harness(fetchCard)
    h.edit(`see ${A}`)
    await vi.advanceTimersByTimeAsync(LINK_CARD_DELAY_MS)
    // The send freezes the draft (the dialog checks only while not posting).
    h.freeze(SENT)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.draft().bluesky?.card ?? null).toBeNull()
  })
})
