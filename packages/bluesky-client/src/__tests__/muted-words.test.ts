// Muted words (#196; README, "Muted words"): how the SDK applies them, and
// the reader's add and remove through the prefs write.
import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '@atproto/oauth-client-browser'
import type { AppBskyActorDefs, AppBskyFeedDefs, ModerationPrefs } from '@atproto/api'
import { restoreClient, InvalidMutedWord } from '../oauth.js'
import { labelDefsFromServices, moderate } from '../moderation.js'
import { ALICE as AUTHOR, BOB as READER, BSKY_LABELER, BSKY_SERVICE, author, post } from '../__fixtures__/moderation.js'

const DEFS = labelDefsFromServices([BSKY_SERVICE])
const HOUR = 3600_000

function prefsWith(mutedWords: AppBskyActorDefs.MutedWord[]): ModerationPrefs {
  return { adultContentEnabled: false, labels: {}, labelers: [{ did: BSKY_LABELER, labels: {} }], mutedWords, hiddenPosts: [] }
}

function postSaying(text: string, opts: { following?: boolean; by?: string; tags?: string[] } = {}): AppBskyFeedDefs.PostView {
  const p = post({ author: { ...author(opts.by ?? AUTHOR), viewer: opts.following ? { following: 'at://x/app.bsky.graph.follow/1' } : {} } })
  return { ...p, record: { ...(p.record as object), text, ...(opts.tags ? { tags: opts.tags } : {}) } }
}

const word = (value: string, over: Partial<AppBskyActorDefs.MutedWord> = {}): AppBskyActorDefs.MutedWord =>
  ({ value, targets: ['content', 'tag'], actorTarget: 'all', ...over })

const run = (p: AppBskyFeedDefs.PostView, words: AppBskyActorDefs.MutedWord[], reader: string | undefined = READER) =>
  moderate({ kind: 'post', view: p }, reader, prefsWith(words), DEFS, { labelersCovered: [BSKY_LABELER] })

describe('muted words: apply (rules 2 to 4)', () => {
  it('rule 2: a match hides the post in a list and covers it in view, with Show', () => {
    const r = run(postSaying('a spoiler ahead'), [word('spoiler')])
    expect(r.contexts.contentList).toMatchObject({ filter: true, blur: true })
    expect(r.contexts.contentView).toMatchObject({ blur: true, noOverride: false })
    expect(r.contexts.contentList.reasons).toContainEqual(expect.objectContaining({ label: 'mute-word', name: 'Hidden by a muted word' }))
  })

  it('rule 2: a tags-only word matches a tag, not the text', () => {
    expect(run(postSaying('a spoiler ahead'), [word('spoiler', { targets: ['tag'] })]).contexts.contentList.filter).toBe(false)
    expect(run(postSaying('hello', { tags: ['spoiler'] }), [word('spoiler', { targets: ['tag'] })]).contexts.contentList.filter).toBe(true)
  })

  it('rule 2: never on the reader’s own post; signed out there are no muted words', () => {
    expect(run(postSaying('a spoiler ahead', { by: READER }), [word('spoiler')]).contexts.contentList.filter).toBe(false)
  })

  it('rule 3: an expired word does not mute', () => {
    const past = new Date(Date.now() - HOUR).toISOString()
    const future = new Date(Date.now() + HOUR).toISOString()
    expect(run(postSaying('a spoiler ahead'), [word('spoiler', { expiresAt: past })]).contexts.contentList.filter).toBe(false)
    expect(run(postSaying('a spoiler ahead'), [word('spoiler', { expiresAt: future })]).contexts.contentList.filter).toBe(true)
  })

  it('rule 4: "people I do not follow" skips a followed author', () => {
    const w = word('spoiler', { actorTarget: 'exclude-following' })
    expect(run(postSaying('a spoiler ahead', { following: true }), [w]).contexts.contentList.filter).toBe(false)
    expect(run(postSaying('a spoiler ahead'), [w]).contexts.contentList.filter).toBe(true)
  })
})

// --- the write ---------------------------------------------------------

const ME = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const userKey = `${ME}@bsky` as const

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function bodyOf(init?: RequestInit): unknown {
  const b = init?.body
  if (b == null) return undefined
  return JSON.parse(typeof b === 'string' ? b : new TextDecoder().decode(b as Uint8Array))
}

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>

function pds(prefs: unknown[]) {
  const state = { prefs }
  const calls: string[] = []
  const routes: Record<string, Route> = {
    'app.bsky.actor.getPreferences': () => json({ preferences: state.prefs }),
    'app.bsky.actor.putPreferences': (_u, init) => {
      state.prefs = (bodyOf(init) as { preferences: unknown[] }).preferences
      return new Response(null, { status: 200 })
    },
    'app.bsky.labeler.getServices': () => json({ views: [] }),
  }
  const session = {
    did: ME, sub: ME, signOut: vi.fn(async () => {}),
    getTokenInfo: vi.fn(async () => ({ aud: 'https://pds.example.test', sub: ME, iss: 'https://auth.example.test' })),
    fetchHandler: vi.fn(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'https://pds.example.test')
      const method = url.pathname.replace(/^\/xrpc\//, '')
      calls.push(method)
      const route = routes[method]
      return route ? route(url, init) : json({ error: 'MethodNotImplemented' }, 501)
    }),
  } as unknown as OAuthSession
  return { session, calls, routes, state }
}

// With no saved-feeds pref, the SDK's first read writes one: each list
// here has one, so the reads write nothing.
async function restore(prefs: unknown[], onExpired = () => {}) {
  const p = pds(prefs.some((x) => (x as { $type?: string }).$type === SAVED.$type) ? prefs : [...prefs, SAVED])
  const out = await restoreClient({ restore: async () => p.session } as never, ME, { userKey, onExpired, key: 'MW' })
  p.calls.length = 0
  return { ...p, out }
}

const MUTED = (items: unknown[]) => ({ $type: 'app.bsky.actor.defs#mutedWordsPref', items })
const ADULT = { $type: 'app.bsky.actor.defs#adultContentPref', enabled: true }
const UNKNOWN = { $type: 'app.example.someNewPref', keep: { deep: [1, 2] } }
const SAVED = { $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [{ id: '1', type: 'timeline', value: 'following', pinned: true }] }
const OLD = { value: 'legacy', targets: ['content'] }
const KEPT = { id: '3kaaaaaaaaaaa', value: 'kept', targets: ['tag'], actorTarget: 'all', expiresAt: '2020-01-01T00:00:00.000Z', extra: 'x' }

const add = (value: string, over: Record<string, unknown> = {}) =>
  ({ kind: 'add' as const, value, targets: ['content', 'tag'] as ('content' | 'tag')[], actorTarget: 'all' as const, ...over })
const puts = (calls: string[]) => calls.filter((c) => c === 'app.bsky.actor.putPreferences').length

describe('muted words: write (rules 5 to 9)', () => {
  it('rule 1: restore reads the words with the prefs', async () => {
    const { out } = await restore([MUTED([KEPT])])
    expect(out.prefs!.mutedWords.map((w) => w.value)).toEqual(['kept'])
  })

  it('rule 5: an add changes only the muted-words entry; every other pref stays, in order', async () => {
    const { out, state } = await restore([ADULT, MUTED([OLD, KEPT]), UNKNOWN, SAVED])
    const r = await out.editMutedWords(add('#Spoiler'))
    expect(r.outcome).toBe('added')
    expect(state.prefs[0]).toEqual(ADULT)
    expect(state.prefs[2]).toEqual(UNKNOWN)
    expect(state.prefs[3]).toEqual(SAVED)
    const items = (state.prefs[1] as { items: Record<string, unknown>[] }).items
    // The old words stay as they were, the expired one too.
    expect(items.slice(0, 2)).toEqual([OLD, KEPT])
    expect(items[2]).toMatchObject({ value: 'Spoiler', targets: ['content', 'tag'], actorTarget: 'all' })
    expect(typeof items[2]!.id).toBe('string')
    expect(items[2]).not.toHaveProperty('expiresAt')
    // The full load after it gives the new list.
    expect(r.prefs!.mutedWords.map((w) => w.value)).toEqual(['legacy', 'kept', 'Spoiler'])
    expect(out.prefs!.mutedWords).toHaveLength(3)
    expect(r.reloadFailed).toBe(false)
  })

  it('rule 5: with no muted-words pref, an add puts one at the end', async () => {
    const { out, state } = await restore([ADULT, UNKNOWN])
    const until = new Date(Date.now() + 24 * HOUR).toISOString()
    await out.editMutedWords(add('spoiler', { targets: ['tag'], actorTarget: 'exclude-following', expiresAt: until }))
    expect(state.prefs.slice(0, 3)).toEqual([ADULT, UNKNOWN, SAVED])
    expect(state.prefs[3]).toMatchObject(MUTED([{ value: 'spoiler', targets: ['tag'], actorTarget: 'exclude-following', expiresAt: until }]))
  })

  it('rule 5: the write reads the prefs fresh; a change made elsewhere is kept', async () => {
    const { out, state } = await restore([MUTED([KEPT])])
    state.prefs = [MUTED([KEPT, { id: 'b', value: 'other-app', targets: ['content'] }]), UNKNOWN]
    await out.editMutedWords(add('spoiler'))
    expect((state.prefs[0] as { items: { value: string }[] }).items.map((i) => i.value)).toEqual(['kept', 'other-app', 'spoiler'])
    expect(state.prefs[1]).toEqual(UNKNOWN)
  })

  it('rule 5: two quick edits both land', async () => {
    const { out, state } = await restore([MUTED([])])
    await Promise.all([out.editMutedWords(add('one')), out.editMutedWords(add('two'))])
    expect((state.prefs[0] as { items: { value: string }[] }).items.map((i) => i.value)).toEqual(['one', 'two'])
  })

  it('rule 5: an add and a remove sent together both land', async () => {
    const { out, state } = await restore([MUTED([KEPT])])
    await Promise.all([out.editMutedWords(add('one')), out.editMutedWords({ kind: 'remove', id: KEPT.id, value: KEPT.value })])
    expect((state.prefs[0] as { items: { value: string }[] }).items.map((i) => i.value)).toEqual(['one'])
  })

  it('rule 5: only the last muted-words pref changes', async () => {
    const first = MUTED([{ id: 'a', value: 'first', targets: ['content'] }])
    const { out, state } = await restore([first, MUTED([KEPT])])
    await out.editMutedWords(add('spoiler'))
    expect(state.prefs[0]).toEqual(first)
    expect((state.prefs[1] as { items: { value: string }[] }).items.map((i) => i.value)).toEqual(['kept', 'spoiler'])
  })

  it('rule 6: an empty word, no target, a bad target or a past time is refused with no request', async () => {
    const { out, calls } = await restore([MUTED([])])
    const past = new Date(Date.now() - HOUR).toISOString()
    for (const edit of [
      add('  '), add('#'), add('x', { targets: [] }), add('x', { targets: ['content', 'url'] }),
      add('x', { actorTarget: 'some' }), add('x', { expiresAt: past }), add('x', { expiresAt: 'soon' }),
    ]) {
      await expect(out.editMutedWords(edit as never)).rejects.toBeInstanceOf(InvalidMutedWord)
    }
    expect(calls).toEqual([])
  })

  it('rule 6: a word already there (any case) writes nothing: exists', async () => {
    const { out, calls } = await restore([MUTED([KEPT])])
    const r = await out.editMutedWords(add('KEPT'))
    expect(r.outcome).toBe('exists')
    expect(puts(calls)).toBe(0)
  })

  it('rule 7: remove by id; an old word with no id by its value', async () => {
    const { out, state } = await restore([MUTED([OLD, KEPT]), UNKNOWN])
    expect((await out.editMutedWords({ kind: 'remove', id: KEPT.id, value: 'kept' })).outcome).toBe('removed')
    expect(state.prefs).toEqual([MUTED([OLD]), UNKNOWN, SAVED])
    expect((await out.editMutedWords({ kind: 'remove', value: 'legacy' })).outcome).toBe('removed')
    expect(state.prefs).toEqual([MUTED([]), UNKNOWN, SAVED])
  })

  it('rule 7: a word not in the fresh read writes nothing: absent', async () => {
    const { out, calls, state } = await restore([MUTED([KEPT])])
    state.prefs = [MUTED([])]
    expect((await out.editMutedWords({ kind: 'remove', id: KEPT.id, value: 'kept' })).outcome).toBe('absent')
    expect(puts(calls)).toBe(0)
  })

  it('rule 7: an id names one word; another word with the same value stays', async () => {
    const twin = { id: 'other', value: 'kept', targets: ['content'] }
    const { out, state } = await restore([MUTED([KEPT, twin])])
    await out.editMutedWords({ kind: 'remove', id: 'other', value: 'kept' })
    expect(state.prefs).toEqual([MUTED([KEPT]), SAVED])
  })

  it('rule 8: a muted-words pref with no items array is never written', async () => {
    const { out, calls, state } = await restore([{ $type: 'app.bsky.actor.defs#mutedWordsPref', items: 'odd' }])
    await expect(out.editMutedWords(add('spoiler'))).rejects.toThrow()
    expect(puts(calls)).toBe(0)
    expect(state.prefs).toEqual([{ $type: 'app.bsky.actor.defs#mutedWordsPref', items: 'odd' }, SAVED])
  })

  it('rule 9: a failed put throws and the prefs stay', async () => {
    const { out, routes } = await restore([MUTED([KEPT])])
    routes['app.bsky.actor.putPreferences'] = () => json({ error: 'InternalServerError' }, 500)
    await expect(out.editMutedWords(add('spoiler'))).rejects.toThrow()
    expect(out.prefs!.mutedWords.map((w) => w.value)).toEqual(['kept'])
  })

  it('rule 9: a 401 ends the session', async () => {
    const onExpired = vi.fn()
    const { out, routes } = await restore([MUTED([])], onExpired)
    routes['app.bsky.actor.getPreferences'] = () => json({ error: 'AuthenticationRequired' }, 401)
    await expect(out.editMutedWords(add('spoiler'))).rejects.toThrow()
    expect(onExpired).toHaveBeenCalled()
  })

  it('rule 9: the put worked, the load after it failed: reloadFailed, prefs null', async () => {
    const { out, routes, state } = await restore([MUTED([])])
    const orig = routes['app.bsky.actor.putPreferences']!
    routes['app.bsky.actor.putPreferences'] = (u, init) => {
      const res = orig(u, init)
      routes['app.bsky.actor.getPreferences'] = () => json({ error: 'InternalServerError' }, 500)
      return res
    }
    const r = await out.editMutedWords(add('spoiler'))
    expect(r).toMatchObject({ outcome: 'added', reloadFailed: true, prefs: null })
    expect((state.prefs[0] as { items: unknown[] }).items).toHaveLength(1)
  })
})
