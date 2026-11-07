import { describe, expect, it } from 'vitest'
import type { ModerationPrefs } from '@atproto/api'
import type { BlueskyModerationResult, StatusBluesky } from '@beatzball/caribou-mastodon-client'
import {
  LABELER_UNAVAILABLE, LOGGED_OUT_PREFS, UNKNOWN_LABEL,
  blueskyCheckSettled, isLabelerUnavailable, isNoUnauthenticated, labelDefsFromServices, moderate,
} from '../moderation.js'
import { ALICE, BOB, BSKY_LABELER, LABELER, LABELER_SERVICE, author, label, post } from '../__fixtures__/moderation.js'

const READER = BOB
const PROFILE_SELF = `at://${ALICE}/app.bsky.actor.profile/self`

function prefs(over: Partial<ModerationPrefs> = {}): ModerationPrefs {
  return {
    adultContentEnabled: false,
    labels: {},
    labelers: [{ did: BSKY_LABELER, labels: {} }, { did: LABELER, labels: {} }],
    mutedWords: [],
    hiddenPosts: [],
    ...over,
  }
}
const DEFS = labelDefsFromServices([LABELER_SERVICE])

const covered = (r: BlueskyModerationResult, c: keyof BlueskyModerationResult['contexts']) => r.contexts[c].blur || r.contexts[c].filter

describe('moderate: plain data', () => {
  it('fills all seven contexts and survives a JSON round trip', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('!hide', BSKY_LABELER)] }) }, READER, prefs(), DEFS, { labelersCovered: [BSKY_LABELER] })
    expect(Object.keys(r.contexts).sort()).toEqual(['avatar', 'banner', 'contentList', 'contentMedia', 'contentView', 'profileList', 'profileView'])
    const back = JSON.parse(JSON.stringify(r)) as BlueskyModerationResult
    expect(back).toEqual(r)
    // The round-tripped copy answers the same questions the card asks.
    expect(back.contexts.contentView).toMatchObject({ blur: true, noOverride: true })
    expect(back.labelersCovered).toEqual([BSKY_LABELER])
    // No class instance anywhere.
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(r.contexts.contentView)).toBe(Object.prototype)
  })

  it('a clean post is clean in every context', () => {
    const r = moderate({ kind: 'post', view: post() }, READER, prefs(), DEFS)
    for (const ui of Object.values(r.contexts)) {
      expect(ui).toEqual({ filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] })
    }
    expect(r.labelersCovered).toEqual([])
  })

  it('a labeled profile round-trips too', () => {
    const view = author(ALICE, [label('porn', ALICE, PROFILE_SELF)])
    const r = moderate({ kind: 'profile', view }, READER, prefs(), DEFS)
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    expect(r.contexts.avatar.blur).toBe(true)
    expect(r.contexts.banner.blur).toBe(true)
  })
})

describe('moderate: the SDK decides', () => {
  it('a custom label with its definition: warn covers, with Show', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('spoiler', LABELER)] }) }, READER, prefs(), DEFS)
    expect(r.contexts.contentList).toMatchObject({ blur: true, filter: false, noOverride: false })
    // The SDK's choice for `blurs: content`: the focused post gets a note, not a cover.
    expect(r.contexts.contentView).toMatchObject({ blur: false, inform: true })
    expect(r.contexts.contentList.reasons).toEqual([{ label: 'spoiler', source: LABELER, name: 'Spoiler' }])
  })

  it('a custom "hide" label filters a list but only covers the focused post', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('scam-strict', LABELER)] }) }, READER, prefs(), DEFS)
    expect(r.contexts.contentList.filter).toBe(true)
    // Never silently drop the post the reader opened.
    expect(r.contexts.contentView.filter).toBe(false)
    expect(r.contexts.contentView.alert).toBe(true)
  })

  it('a reader "hide" pref that the logged-out defaults do not have', () => {
    const view = post({ labels: [label('spoiler', LABELER)] })
    const reader = moderate({ kind: 'post', view }, READER, prefs({ labelers: [{ did: LABELER, labels: { spoiler: 'hide' } }] }), DEFS)
    expect(reader.contexts.contentList.filter).toBe(true)
    // Logged out, the labeler is not subscribed: the SDK skips its label.
    const ssr = moderate({ kind: 'post', view }, undefined, LOGGED_OUT_PREFS, {})
    expect(ssr.contexts.contentList.filter).toBe(false)
    expect(ssr.contexts.contentList.blur).toBe(false)
  })

  it('noOverride: an adult label with adult content off has no Show button', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('porn', BSKY_LABELER)] }) }, READER, prefs(), DEFS)
    expect(r.contexts.contentMedia).toMatchObject({ blur: true, noOverride: true })
    expect(r.contexts.contentList.filter).toBe(true)
  })

  it("the author's own labeled post: covered, never filtered, with Show", () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('porn', ALICE)] }) }, ALICE, prefs(), DEFS)
    expect(r.contexts.contentMedia).toMatchObject({ blur: true, noOverride: false })
    expect(r.contexts.contentList.filter).toBe(false)
  })

  it('a labeled avatar blurs the avatar context of a post', () => {
    const view = post({ author: author(ALICE, [label('porn', BSKY_LABELER, PROFILE_SELF)]) })
    const r = moderate({ kind: 'post', view }, READER, prefs(), DEFS)
    expect(r.contexts.avatar.blur).toBe(true)
    expect(r.contexts.contentMedia.blur).toBe(false)
  })

  it('a block adds a reason with the cause type', () => {
    const blocked = author(ALICE)
    blocked.viewer = { blocking: `at://${READER}/app.bsky.graph.block/3kblock` }
    const r = moderate({ kind: 'profile', view: blocked }, READER, prefs(), DEFS)
    expect(r.contexts.profileList.filter).toBe(true)
    expect(r.contexts.profileView.reasons[0]?.label ?? r.contexts.profileList.reasons[0]?.label).toBe('blocking')
  })

  it('a negated label is skipped', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('scam-strict', LABELER, undefined, { neg: true })] }) }, READER, prefs(), null)
    expect(covered(r, 'contentView')).toBe(false)
  })
})

describe('moderate: fail closed', () => {
  it('a custom label whose labeler definitions failed to load covers, no Show, no filter', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('spoiler', LABELER)] }) }, READER, prefs(), {})
    for (const c of ['contentList', 'contentView', 'contentMedia'] as const) {
      expect(r.contexts[c]).toMatchObject({ blur: true, filter: false, noOverride: true })
    }
    expect(r.contexts.contentView.reasons).toEqual([{ label: 'spoiler', source: LABELER, name: LABELER_UNAVAILABLE }])
    expect(isLabelerUnavailable(r.contexts.contentView.reasons[0]!)).toBe(true)
  })

  it('labelDefs null covers the same way', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('spoiler', LABELER)] }) }, READER, prefs(), null)
    expect(r.contexts.contentView).toMatchObject({ blur: true, noOverride: true })
  })

  it('a value the loaded definitions do not name covers as unknown', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('not-defined', LABELER)] }) }, READER, prefs(), DEFS)
    expect(r.contexts.contentView).toMatchObject({ blur: true, noOverride: true })
    expect(r.contexts.contentView.reasons[0]?.name).toBe(UNKNOWN_LABEL)
    expect(isLabelerUnavailable(r.contexts.contentView.reasons[0]!)).toBe(true)
  })

  it('an account label from an unavailable labeler covers every context', () => {
    const view = post({ author: author(ALICE, [label('spoiler', LABELER, ALICE)]) })
    const r = moderate({ kind: 'post', view }, READER, prefs(), {})
    for (const ui of Object.values(r.contexts)) expect(ui).toMatchObject({ blur: true, noOverride: true })
  })

  it('a profile-record label from an unavailable labeler covers avatar and banner', () => {
    const view = author(ALICE, [label('spoiler', LABELER, PROFILE_SELF)])
    const r = moderate({ kind: 'profile', view }, READER, prefs(), {})
    expect(r.contexts.avatar).toMatchObject({ blur: true, noOverride: true })
    expect(r.contexts.banner).toMatchObject({ blur: true, noOverride: true })
    expect(r.contexts.profileView.blur).toBe(false)
  })

  it('a labeler the reader does not subscribe to is not a gap', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('spoiler', 'did:plc:other')] }) }, READER, prefs(), {})
    expect(covered(r, 'contentView')).toBe(false)
  })

  it("the reader's own post from an unavailable labeler: covered, with Show", () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('spoiler', LABELER)] }) }, ALICE, prefs(), {})
    expect(r.contexts.contentView).toMatchObject({ blur: true, noOverride: false })
  })

  it('an unknown self-label is skipped: a self-label can only use a built-in value', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('made-up', ALICE)] }) }, READER, prefs(), {})
    expect(covered(r, 'contentView')).toBe(false)
  })

  it('prefs null: a built-in label hides all it could, with no Show', () => {
    // `nudity` is "ignore" by default; strict prefs still hide it.
    const r = moderate({ kind: 'post', view: post({ labels: [label('nudity', BSKY_LABELER)] }) }, READER, null, DEFS)
    expect(r.contexts.contentList.filter).toBe(true)
    expect(r.contexts.contentMedia).toMatchObject({ blur: true })
  })

  it('prefs null: a labeler the reader never named still counts', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('spoiler', LABELER)] }) }, READER, null, DEFS)
    expect(r.contexts.contentList.filter).toBe(true)
    expect(r.contexts.contentList.blur).toBe(true)
  })

  it('prefs null and labelDefs null: a custom label still covers', () => {
    const r = moderate({ kind: 'post', view: post({ labels: [label('anything-new', 'did:plc:other')] }) }, READER, null, null)
    expect(r.contexts.contentView).toMatchObject({ blur: true, noOverride: true })
  })
})

describe('!no-unauthenticated (spec 8.3)', () => {
  const hidden = author(ALICE, [label('!no-unauthenticated', ALICE, PROFILE_SELF)])

  it('isNoUnauthenticated reads the author labels', () => {
    expect(isNoUnauthenticated(hidden)).toBe(true)
    expect(isNoUnauthenticated(author(ALICE))).toBe(false)
    expect(isNoUnauthenticated(author(ALICE, [label('!no-unauthenticated', ALICE, PROFILE_SELF, { neg: true })]))).toBe(false)
  })

  it('a signed-out reader gets a cover with no Show', () => {
    const r = moderate({ kind: 'post', view: post({ author: hidden }) }, undefined, LOGGED_OUT_PREFS, {})
    expect(r.contexts.contentView).toMatchObject({ blur: true, noOverride: true })
    expect(r.contexts.contentList.filter).toBe(true)
  })

  it('a signed-in Bluesky reader sees the post', () => {
    const r = moderate({ kind: 'post', view: post({ author: hidden }) }, READER, prefs(), DEFS)
    expect(covered(r, 'contentView')).toBe(false)
  })
})

describe('labelDefsFromServices', () => {
  it('keys the interpreted definitions by labeler DID', () => {
    expect(Object.keys(DEFS)).toEqual([LABELER])
    expect(DEFS[LABELER]!.map((d) => d.identifier)).toEqual(['spoiler', 'scam-strict'])
  })
})

describe('blueskyCheckSettled (the reader veil)', () => {
  const KEY = 'bob@bsky' as const
  const reader = { userKey: KEY, userDid: READER, prefs: prefs(), labelDefs: DEFS }

  function card(over: Partial<StatusBluesky> & { covered?: string[] } = {}): StatusBluesky {
    const { covered: labelersCovered = [BSKY_LABELER, LABELER], ...rest } = over
    return {
      uri: 'at://x', cid: 'c', likeUri: null, repostUri: null, replyRef: null,
      replyDisabled: false, embeddingDisabled: false, labels: [],
      moderation: { ...moderate({ kind: 'post', view: post() }, READER, prefs(), DEFS), labelersCovered },
      viewerOf: KEY,
      ...rest,
    }
  }

  it('no Bluesky account active: settled at once', () => {
    expect(blueskyCheckSettled(card({ viewerOf: null, covered: [] }), null)).toBe(true)
  })

  it('settles after a reader fetch that covers every subscribed labeler', () => {
    expect(blueskyCheckSettled(card(), reader)).toBe(true)
  })

  it('SSR data (a public copy) never settles for a signed-in reader', () => {
    expect(blueskyCheckSettled(card({ viewerOf: null, covered: [BSKY_LABELER] }), reader)).toBe(false)
  })

  it("another account's copy does not settle", () => {
    expect(blueskyCheckSettled(card({ viewerOf: 'carol@bsky' }), reader)).toBe(false)
  })

  it('a fetch that came back without a subscribed labeler does not settle', () => {
    expect(blueskyCheckSettled(card({ covered: [BSKY_LABELER] }), reader)).toBe(false)
  })

  it('a new subscription later uncovers nothing until a refetch', () => {
    const more = { ...reader, prefs: prefs({ labelers: [...prefs().labelers, { did: 'did:plc:newlabeler', labels: {} }] }) }
    expect(blueskyCheckSettled(card(), more)).toBe(false)
  })

  it('prefs or definitions not loaded: not settled', () => {
    expect(blueskyCheckSettled(card(), { ...reader, prefs: null })).toBe(false)
    expect(blueskyCheckSettled(card(), { ...reader, labelDefs: null })).toBe(false)
    // One subscribed labeler's definitions missing.
    expect(blueskyCheckSettled(card(), { ...reader, labelDefs: {} })).toBe(false)
  })

  it('the veil gap: never visible between SSR, prefs loading, and a late or failed reader fetch', () => {
    const view = post({ labels: [] })
    // 1. SSR: Bluesky labeler only, no custom label on the data.
    const ssr: StatusBluesky = { ...card({ viewerOf: null }), moderation: moderate({ kind: 'post', view }, undefined, LOGGED_OUT_PREFS, {}, { labelersCovered: [BSKY_LABELER] }) }
    expect(blueskyCheckSettled(ssr, null)).toBe(true) // signed out: final
    // 2. Prefs and definitions load first. Still the SSR copy: covered.
    expect(blueskyCheckSettled(ssr, reader)).toBe(false)
    // 3a. The reader fetch fails: the SSR copy stays, covered.
    expect(blueskyCheckSettled(ssr, reader)).toBe(false)
    // 3b. The reader fetch arrives with the custom hide label.
    const late = post({ labels: [label('scam-strict', LABELER)] })
    const fresh: StatusBluesky = {
      ...card(),
      moderation: moderate({ kind: 'post', view: late }, READER, reader.prefs, reader.labelDefs, { labelersCovered: [BSKY_LABELER, LABELER] }),
    }
    expect(blueskyCheckSettled(fresh, reader)).toBe(true)
    // Settled, and the moderation hides it: the reader never saw it.
    expect(fresh.moderation.contexts.contentList.filter).toBe(true)
  })
})
