// A gone labeler (#238; README, "A gone labeler"): which labelers are gone,
// and the confirmed removal from the reader's prefs.
import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '@atproto/oauth-client-browser'
import { BSKY_LABELER_DID, type ModerationPrefs } from '@atproto/api'
import { restoreClient } from '../oauth.js'
import { goneLabelers, type LabelDefs } from '../moderation.js'

const ALICE = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
const userKey = `${ALICE}@bsky` as const
const GONE = 'did:plc:gonelabeleraaaaaaaaaaaaa'
const LIVE = 'did:web:labeler.example.com'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const labelerService = (did: string) => ({
  $type: 'app.bsky.labeler.defs#labelerViewDetailed',
  uri: `at://${did}/app.bsky.labeler.service/self`, cid: 'bafyreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm',
  creator: { did, handle: 'labeler.example.com' }, policies: { labelValues: [] }, indexedAt: '2026-01-01T00:00:00.000Z',
})

const prefsOf = (dids: string[]) => ({ labelers: dids.map((did) => ({ did, labels: {} })) }) as unknown as ModerationPrefs
const defsOf = (dids: string[]) => Object.fromEntries(dids.map((d) => [d, []])) as unknown as LabelDefs

describe('goneLabelers', () => {
  it('lists each prefs labeler with no definitions, in prefs order, once', () => {
    expect(goneLabelers(prefsOf([LIVE, GONE, 'did:plc:other', GONE]), defsOf([BSKY_LABELER_DID, LIVE])))
      .toEqual([GONE, 'did:plc:other'])
  })

  it('never lists Bluesky’s own labeler', () => {
    expect(goneLabelers(prefsOf([BSKY_LABELER_DID, GONE]), defsOf([]))).toEqual([GONE])
  })

  it('lists none when prefs or definitions are not loaded', () => {
    expect(goneLabelers(null, defsOf([]))).toEqual([])
    expect(goneLabelers(prefsOf([GONE]), null)).toEqual([])
  })
})

interface Calls { method: string; body: unknown }

// The SDK sends a JSON body as bytes.
function bodyOf(init?: RequestInit): unknown {
  const b = init?.body
  if (b == null) return undefined
  return JSON.parse(typeof b === 'string' ? b : new TextDecoder().decode(b as Uint8Array))
}

// The PDS: a prefs array the test can change, and `getServices` that has a
// view only for the labelers in `live` that were asked for.
function pds(opts: { prefs: unknown[]; live: Set<string> }) {
  const calls: Calls[] = []
  const routes: Record<string, (url: URL, init?: RequestInit) => Response> = {
    'app.bsky.actor.getPreferences': () => json({ preferences: opts.prefs }),
    'app.bsky.actor.putPreferences': (_u, init) => {
      opts.prefs = (bodyOf(init) as { preferences: unknown[] }).preferences
      return new Response(null, { status: 200 })
    },
    'app.bsky.labeler.getServices': (url) => {
      const asked = url.searchParams.getAll('dids')
      return json({ views: asked.filter((d) => d === BSKY_LABELER_DID || opts.live.has(d)).map(labelerService) })
    },
  }
  const session = {
    did: ALICE, sub: ALICE, signOut: vi.fn(async () => {}),
    getTokenInfo: vi.fn(async () => ({ aud: 'https://pds.example.test', sub: ALICE, iss: 'https://auth.example.test' })),
    fetchHandler: vi.fn(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'https://pds.example.test')
      const method = url.pathname.replace(/^\/xrpc\//, '')
      calls.push({ method, body: bodyOf(init) })
      const route = routes[method]
      return route ? route(url, init) : json({ error: 'MethodNotImplemented' }, 501)
    }),
  } as unknown as OAuthSession
  return { session, calls, routes, opts }
}

const LABELERS = (dids: string[]) => ({ $type: 'app.bsky.actor.defs#labelersPref', labelers: dids.map((did) => ({ did })) })
const ADULT = { $type: 'app.bsky.actor.defs#adultContentPref', enabled: true }
const SAVED = { $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [{ id: '1', type: 'timeline', value: 'following', pinned: true }] }
const MUTED = { $type: 'app.bsky.actor.defs#mutedWordsPref', items: [{ value: 'spoiler', targets: ['content'] }] }

async function restore(prefs: unknown[], live: string[] = []) {
  const p = pds({ prefs, live: new Set(live) })
  const out = await restoreClient({ restore: async () => p.session } as never, ALICE, { userKey, onExpired: () => {}, key: 'GL' })
  p.calls.length = 0
  return { ...p, out }
}

const writes = (calls: Calls[]) => calls.filter((c) => c.method === 'app.bsky.actor.putPreferences')

describe('restoreClient: gone labelers', () => {
  it('names a labeler getServices has no view for', async () => {
    const { out } = await restore([LABELERS([LIVE, GONE])], [LIVE])
    expect(out.gone).toEqual([GONE])
    expect((await out.recheckLabelers()).gone).toEqual([GONE])
    expect((await out.reloadModeration()).gone).toEqual([GONE])
  })

  it('a failed getServices names none', async () => {
    const p = pds({ prefs: [LABELERS([GONE])], live: new Set() })
    p.routes['app.bsky.labeler.getServices'] = () => json({ error: 'x' }, 502)
    const out = await restoreClient({ restore: async () => p.session } as never, ALICE, { userKey, onExpired: () => {}, key: 'GL' })
    expect(out.labelDefs).toBeNull()
    expect(out.gone).toEqual([])
  })
})

describe('removeGoneLabeler', () => {
  it('takes out only that DID; every other pref stays, in order', async () => {
    const { out, calls, opts } = await restore([ADULT, LABELERS([LIVE, GONE, 'did:plc:keepaaaaaaaaaaaaaaaaaaa']), SAVED, MUTED], [LIVE, 'did:plc:keepaaaaaaaaaaaaaaaaaaa'])
    expect(out.gone).toEqual([GONE])
    const res = await out.removeGoneLabeler(GONE)
    expect(res.outcome).toBe('removed')
    expect(writes(calls)).toHaveLength(1)
    expect(opts.prefs).toEqual([ADULT, LABELERS([LIVE, 'did:plc:keepaaaaaaaaaaaaaaaaaaa']), SAVED, MUTED])
    // The new prefs and definitions come from the server.
    expect(res.gone).toEqual([])
    expect(out.gone).toEqual([])
    expect(out.prefs!.labelers.map((l) => l.did)).not.toContain(GONE)
  })

  it('checks once more first: a labeler that came back is not removed', async () => {
    const { out, calls, opts } = await restore([LABELERS([GONE])])
    expect(out.gone).toEqual([GONE])
    opts.live.add(GONE)
    const res = await out.removeGoneLabeler(GONE)
    expect(res.outcome).toBe('back')
    expect(writes(calls)).toHaveLength(0)
    expect(res.gone).toEqual([])
    expect(Object.keys(out.labelDefs!)).toContain(GONE)
  })

  it('a failed check throws and writes nothing', async () => {
    const { out, calls, routes } = await restore([LABELERS([GONE])])
    routes['app.bsky.labeler.getServices'] = () => json({ error: 'x' }, 502)
    await expect(out.removeGoneLabeler(GONE)).rejects.toBeTruthy()
    expect(writes(calls)).toHaveLength(0)
    expect(out.gone).toEqual([GONE])
  })

  it('a 401 in the last check ends the session and writes nothing', async () => {
    const p = pds({ prefs: [LABELERS([GONE])], live: new Set() })
    const onExpired = vi.fn()
    const out = await restoreClient({ restore: async () => p.session } as never, ALICE, { userKey, onExpired, key: 'GL' })
    p.calls.length = 0
    p.routes['app.bsky.labeler.getServices'] = () => json({ error: 'AuthRequired' }, 401)
    await expect(out.removeGoneLabeler(GONE)).rejects.toBeTruthy()
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(writes(p.calls)).toHaveLength(0)
  })

  it('a failed write throws; the labeler is still gone', async () => {
    const { out, routes } = await restore([LABELERS([GONE])])
    routes['app.bsky.actor.putPreferences'] = () => json({ error: 'x' }, 502)
    await expect(out.removeGoneLabeler(GONE)).rejects.toBeTruthy()
    expect(out.gone).toEqual([GONE])
  })

  it('writes nothing when the fresh read no longer has the DID', async () => {
    // Saved feeds are there, so the SDK's own read does not write them.
    const { out, calls, opts } = await restore([LABELERS([GONE]), ADULT, SAVED])
    // Another app removed it after Caribou loaded the prefs.
    opts.prefs = [ADULT, LABELERS([]), SAVED]
    const res = await out.removeGoneLabeler(GONE)
    expect(res.outcome).toBe('absent')
    expect(writes(calls)).toHaveLength(0)
    expect(opts.prefs).toEqual([ADULT, LABELERS([]), SAVED])
    expect(res.gone).toEqual([])
  })

  it('refuses Bluesky’s labeler, or a DID not in the loaded prefs, with no request', async () => {
    const { out, calls } = await restore([LABELERS([GONE])])
    await expect(out.removeGoneLabeler(BSKY_LABELER_DID)).rejects.toThrow(/not a gone labeler/)
    await expect(out.removeGoneLabeler('did:plc:strangeraaaaaaaaaaaaaaaa')).rejects.toThrow(/not a gone labeler/)
    expect(calls).toHaveLength(0)
  })

  it('refuses a labeler that is not gone, with no request', async () => {
    const { out, calls } = await restore([LABELERS([LIVE])], [LIVE])
    await expect(out.removeGoneLabeler(LIVE)).rejects.toThrow(/not a gone labeler/)
    expect(calls).toHaveLength(0)
  })
})
