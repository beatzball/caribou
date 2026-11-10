import { describe, expect, it } from 'vitest'
import type { BlueskyGates } from '@beatzball/caribou-mastodon-client'
import { emptyDraft } from '../compose.js'
import { blueskyDraftInput, emptyBlueskyDraft } from '../bluesky-compose.js'
import {
  BLUESKY_DEFAULT_GATES, blueskyGatesText, blueskySentGates, setBlueskyQuotes, setBlueskyReplies, toggleBlueskyReplyRule,
} from '../bluesky-gates.js'

const LIST = { kind: 'list' as const, id: '3kllaaaaaaaa2', title: 'Friends' }
const OTHER_LIST = { kind: 'list' as const, id: '3kmmaaaaaaaa2', title: 'Work' }
const PARENT = { uri: 'at://did:plc:bob/app.bsky.feed.post/p1', cid: 'bafyparent' }

describe('G5: who can reply', () => {
  it('turning a rule on from everyone limits replies to that rule', () => {
    expect(toggleBlueskyReplyRule(BLUESKY_DEFAULT_GATES, { kind: 'follower' })).toEqual({ replies: [{ kind: 'follower' }], quotes: true })
  })

  it('turning a rule on from nobody starts from that rule', () => {
    const nobody = setBlueskyReplies(BLUESKY_DEFAULT_GATES, 'nobody')
    expect(nobody.replies).toEqual([])
    expect(toggleBlueskyReplyRule(nobody, { kind: 'mention' }).replies).toEqual([{ kind: 'mention' }])
  })

  it('rules keep the fixed order, whatever order they were picked in', () => {
    let g: BlueskyGates = BLUESKY_DEFAULT_GATES
    for (const r of [LIST, { kind: 'follower' as const }, { kind: 'mention' as const }, { kind: 'following' as const }]) g = toggleBlueskyReplyRule(g, r)
    expect(g.replies!.map((r) => r.kind)).toEqual(['mention', 'following', 'follower', 'list'])
  })

  it('at most one list: another list takes its place', () => {
    const g = toggleBlueskyReplyRule(toggleBlueskyReplyRule(BLUESKY_DEFAULT_GATES, LIST), OTHER_LIST)
    expect(g.replies).toEqual([OTHER_LIST])
  })

  it('turning off the last rule goes back to everyone, not to nobody', () => {
    const g = toggleBlueskyReplyRule(toggleBlueskyReplyRule(BLUESKY_DEFAULT_GATES, { kind: 'following' }), { kind: 'following' })
    expect(g.replies).toBeNull()
  })

  it('turning the same list off removes it', () => {
    const g = toggleBlueskyReplyRule(toggleBlueskyReplyRule(toggleBlueskyReplyRule(BLUESKY_DEFAULT_GATES, { kind: 'mention' }), LIST), LIST)
    expect(g.replies).toEqual([{ kind: 'mention' }])
  })

  it('everyone and nobody keep the quote choice', () => {
    const off = setBlueskyQuotes(BLUESKY_DEFAULT_GATES, false)
    expect(setBlueskyReplies(off, 'nobody')).toEqual({ replies: [], quotes: false })
    expect(setBlueskyReplies(off, 'everyone')).toEqual({ replies: null, quotes: false })
  })
})

describe('G6: the limit in plain words', () => {
  it('the default', () => {
    expect(blueskyGatesText(undefined)).toBe('Everyone can reply. Quotes are on.')
  })
  it('nobody, quotes off', () => {
    expect(blueskyGatesText({ replies: [], quotes: false })).toBe('Nobody can reply. Quotes are off.')
  })
  it('one rule', () => {
    expect(blueskyGatesText({ replies: [{ kind: 'mention' }], quotes: true })).toBe('Only people you mention can reply. Quotes are on.')
  })
  it('every rule, joined with "and"', () => {
    expect(blueskyGatesText({ replies: [{ kind: 'mention' }, { kind: 'following' }, { kind: 'follower' }, LIST], quotes: true }))
      .toBe('Only people you mention, people you follow, your followers and people on Friends can reply. Quotes are on.')
  })
  it('a list with no title', () => {
    expect(blueskyGatesText({ replies: [{ kind: 'list', id: LIST.id }], quotes: true })).toBe('Only people on your list can reply. Quotes are on.')
  })
})

describe('G1, G2: what is sent', () => {
  it('a reply never sends limits, whatever the draft holds (G1)', () => {
    const b = emptyBlueskyDraft({ reply: { root: PARENT, parent: PARENT }, gates: { replies: [], quotes: false } })
    expect(blueskySentGates(b)).toBeNull()
  })

  it('the default sends no limits (G2)', () => {
    expect(blueskySentGates(emptyBlueskyDraft())).toBeNull()
    expect(blueskySentGates(emptyBlueskyDraft({ gates: { replies: null, quotes: true } }))).toBeNull()
  })

  it('a new post or a quote sends its limits, in order, without list titles', () => {
    const b = emptyBlueskyDraft({ quote: PARENT, gates: { replies: [LIST, { kind: 'mention' }], quotes: false } })
    expect(blueskySentGates(b)).toEqual({ replies: [{ kind: 'mention' }, { kind: 'list', id: LIST.id }], quotes: false })
  })

  it('the default draft input is the string it was before #199 (G2)', () => {
    const d = emptyDraft({ text: 'hi', bluesky: emptyBlueskyDraft({ gates: { replies: null, quotes: true } }) })
    expect(blueskyDraftInput(d)).toBe(JSON.stringify({ text: 'hi', language: null, reply: null, quote: null, labels: [], images: [] }))
  })

  it('a limit is part of the input (G4)', () => {
    const a = emptyDraft({ text: 'hi', bluesky: emptyBlueskyDraft() })
    const b = emptyDraft({ text: 'hi', bluesky: emptyBlueskyDraft({ gates: { replies: null, quotes: false } }) })
    expect(blueskyDraftInput(a)).not.toBe(blueskyDraftInput(b))
  })

  it('a list title is not part of the input', () => {
    const a = emptyDraft({ text: 'hi', bluesky: emptyBlueskyDraft({ gates: { replies: [LIST], quotes: true } }) })
    const b = emptyDraft({ text: 'hi', bluesky: emptyBlueskyDraft({ gates: { replies: [{ ...LIST, title: 'Renamed' }], quotes: true } }) })
    expect(blueskyDraftInput(a)).toBe(blueskyDraftInput(b))
  })
})

describe('G7: a limit alone is draft content (review 1)', () => {
  it('a draft with only a limit is kept; the default alone is empty', async () => {
    const { isDraftEmpty, saveDraft, loadDraft } = await import('../compose.js')
    const KEY = 'did:plc:reader@bsky' as never
    const limited = emptyDraft({ bluesky: emptyBlueskyDraft({ rkey: '3krkey0000001', gates: { replies: [], quotes: false } }) })
    expect(isDraftEmpty(limited)).toBe(false)
    saveDraft(KEY, 'new', limited)
    expect(loadDraft(KEY, 'new')?.bluesky?.gates).toEqual({ replies: [], quotes: false })
    const quotesOnly = emptyDraft({ bluesky: emptyBlueskyDraft({ gates: { replies: null, quotes: false } }) })
    expect(isDraftEmpty(quotesOnly)).toBe(false)
    const plain = emptyDraft({ bluesky: emptyBlueskyDraft({ gates: { replies: null, quotes: true } }) })
    expect(isDraftEmpty(plain)).toBe(true)
  })
})
