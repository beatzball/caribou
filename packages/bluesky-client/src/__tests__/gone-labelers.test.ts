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
type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>

function pds(opts: { prefs: unknown[]; live: Set<string> }) {
  const calls: Calls[] = []
  // Runs once after the next put lands (then is cleared).
  const hooks: { afterPut: (() => void) | null } = { afterPut: null }
  const routes: Record<string, Route> = {
    'app.bsky.actor.getPreferences': () => json({ preferences: opts.prefs }),
    'app.bsky.actor.putPreferences': (_u, init) => {
      opts.prefs = (bodyOf(init) as { preferences: unknown[] }).preferences
      const after = hooks.afterPut
      hooks.afterPut = null
      after?.()
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
  return { session, calls, routes, opts, hooks }
}

/**
 * Holds the answer to the next `method` call: it is built when the request
 * arrives (the server's state then) and sent on `release()`.
 */
function holdNext(routes: Record<string, Route>, method: string) {
  const orig = routes[method]!
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let arrived = false
  routes[method] = async (url, init) => {
    routes[method] = orig
    arrived = true
    const res = await orig(url, init)
    await gate
    return res
  }
  return { release, arrived: () => arrived }
}

const LABELERS = (dids: string[]) => ({ $type: 'app.bsky.actor.defs#labelersPref', labelers: dids.map((did) => ({ did })) })
const ADULT = { $type: 'app.bsky.actor.defs#adultContentPref', enabled: true }
const SAVED = { $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [{ id: '1', type: 'timeline', value: 'following', pinned: true }] }
const MUTED = { $type: 'app.bsky.actor.defs#mutedWordsPref', items: [{ value: 'spoiler', targets: ['content'] }] }

async function restore(prefs: unknown[], live: string[] = []) {
  const p = pds({ prefs, live: new Set(live) })
  const out = await restoreClient({ restore: async () => p.session } as never, ALICE, { userKey, onExpired: () => {}, key: 'GL' })
  // The second miss in a row: a missing labeler is gone now.
  await out.recheckLabelers()
  p.calls.length = 0
  return { ...p, out }
}

const writes = (calls: Calls[]) => calls.filter((c) => c.method === 'app.bsky.actor.putPreferences')

describe('restoreClient: gone labelers', () => {
  it('names a labeler getServices has no view for, after two misses in a row', async () => {
    const p = pds({ prefs: [LABELERS([LIVE, GONE])], live: new Set([LIVE]) })
    const out = await restoreClient({ restore: async () => p.session } as never, ALICE, { userKey, onExpired: () => {}, key: 'GL' })
    // One miss: covered (no definitions), not offered yet.
    expect(Object.keys(out.labelDefs!)).not.toContain(GONE)
    expect(out.gone).toEqual([])
    expect((await out.recheckLabelers()).gone).toEqual([GONE])
    expect((await out.reloadModeration()).gone).toEqual([GONE])
  })

  it('a view clears the count: the next miss is the first again', async () => {
    const p = pds({ prefs: [LABELERS([GONE])], live: new Set() })
    const out = await restoreClient({ restore: async () => p.session } as never, ALICE, { userKey, onExpired: () => {}, key: 'GL' })
    p.opts.live.add(GONE)
    expect((await out.recheckLabelers()).gone).toEqual([])
    p.opts.live.delete(GONE)
    expect((await out.recheckLabelers()).gone).toEqual([])
    expect((await out.reloadModeration()).gone).toEqual([GONE])
  })

  it('a failed check counts no miss', async () => {
    const p = pds({ prefs: [LABELERS([GONE])], live: new Set() })
    const out = await restoreClient({ restore: async () => p.session } as never, ALICE, { userKey, onExpired: () => {}, key: 'GL' })
    const ok = p.routes['app.bsky.labeler.getServices']!
    p.routes['app.bsky.labeler.getServices'] = () => json({ error: 'x' }, 502)
    expect((await out.recheckLabelers()).gone).toEqual([])
    p.routes['app.bsky.labeler.getServices'] = ok
    expect((await out.recheckLabelers()).gone).toEqual([GONE])
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
    await out.recheckLabelers()
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

// Codex's two round-1 schedules on #248: an older moderation load must not
// publish over a newer one. Under rule Q the newer one runs after it.
describe('loads in order', () => {
  const H = 'did:plc:secondgonelabeleraaaaaaa'

  it('two removals, the first one\'s post-write prefs read late: no labeler comes back as gone', async () => {
    const { out, opts, routes, hooks } = await restore([ADULT, LABELERS([GONE, H]), SAVED])
    expect(out.gone).toEqual([GONE, H])
    // Hold the prefs read of G's reload (the read after its put).
    let held: ReturnType<typeof holdNext> | null = null
    hooks.afterPut = () => { held = holdNext(routes, 'app.bsky.actor.getPreferences') }
    const first = out.removeGoneLabeler(GONE)
    await vi.waitFor(() => expect(held?.arrived()).toBe(true))
    // H's removal is asked for; G's read (it still names H) lands now.
    const secondP = out.removeGoneLabeler(H)
    held!.release()
    const late = await first
    expect(late.outcome).toBe('removed')
    const second = await secondP
    expect(second.outcome).toBe('removed')
    expect(second.gone).toEqual([])
    expect(out.gone).toEqual([])
    expect(out.prefs!.labelers.map((l) => l.did)).not.toContain(H)
    expect(opts.prefs).toEqual([ADULT, LABELERS([]), SAVED])
  })

  it('a removal\'s definitions late, after a newer Retry: the newer pair stays, nothing wrongly gone', async () => {
    const { out, opts, routes, hooks } = await restore([ADULT, LABELERS([GONE]), SAVED])
    let held: ReturnType<typeof holdNext> | null = null
    hooks.afterPut = () => { held = holdNext(routes, 'app.bsky.labeler.getServices') }
    const removal = out.removeGoneLabeler(GONE)
    await vi.waitFor(() => expect(held?.arrived()).toBe(true))
    // Another app subscribes to a live labeler; a Retry loads it.
    opts.prefs = [ADULT, LABELERS([LIVE]), SAVED]
    opts.live.add(LIVE)
    const retryP = out.reloadModeration()
    // The removal's old definitions answer (no LIVE) lands now.
    held!.release()
    const late = await removal
    const retry = await retryP
    expect(Object.keys(retry.labelDefs!)).toContain(LIVE)
    expect(Object.keys(out.labelDefs!)).toContain(LIVE)
    expect(out.prefs!.labelers.map((l) => l.did)).toContain(LIVE)
    expect(out.gone).toEqual([])
    expect(late.gone).toEqual([])
  })

  it('a full load late behind a newer one does not publish its prefs', async () => {
    const p = pds({ prefs: [LABELERS([LIVE])], live: new Set([LIVE]) })
    const out = await restoreClient({ restore: async () => p.session } as never, ALICE, { userKey, onExpired: () => {}, key: 'GL' })
    const held = holdNext(p.routes, 'app.bsky.labeler.getServices')
    const old = out.reloadModeration()
    await vi.waitFor(() => expect(held.arrived()).toBe(true))
    p.opts.prefs = [LABELERS([])]
    const newerP = out.reloadModeration()
    held.release()
    await old
    const newer = await newerP
    expect(newer.prefs!.labelers.map((l) => l.did)).not.toContain(LIVE)
    expect(out.prefs!.labelers.map((l) => l.did)).not.toContain(LIVE)
  })
})

// Rule Q (README, "One at a time"): every load and check runs through one
// serial queue. Codex's round-2 schedule, and Fable's round-2 notes 2 and 3.
describe('one at a time', () => {
  const H = 'did:plc:secondgonelabeleraaaaaaa'
  const countOf = (calls: Calls[], method: string) => calls.filter((c) => c.method === method).length

  it('a check asked for during a removal never makes a live labeler gone', async () => {
    const { out, opts, routes, hooks } = await restore([ADULT, LABELERS([GONE, H]), SAVED])
    expect(out.gone).toEqual([GONE, H])
    // After G's put, another app subscribes to live L, and H comes back.
    let held: ReturnType<typeof holdNext> | null = null
    hooks.afterPut = () => {
      opts.prefs = [ADULT, LABELERS([H, LIVE]), SAVED]
      opts.live.add(LIVE)
      opts.live.add(H)
      held = holdNext(routes, 'app.bsky.actor.getPreferences')
    }
    // A definitions read that asks for an old list (no L) while the server
    // prefs name L: an answer for prefs it did not read.
    let stale = 0
    const services = routes['app.bsky.labeler.getServices']!
    routes['app.bsky.labeler.getServices'] = (url, init) => {
      const asked = url.searchParams.getAll('dids')
      const named = JSON.stringify(opts.prefs).includes(LIVE)
      if (asked.length > 1 && named && !asked.includes(LIVE)) stale++
      return services(url, init)
    }
    const removeG = out.removeGoneLabeler(GONE)
    await vi.waitFor(() => expect(held?.arrived()).toBe(true))
    // A background check, and H's removal, are asked for now.
    const check = out.recheckLabelers()
    const removeH = out.removeGoneLabeler(H)
    held!.release()
    await removeG
    await check
    const h = await removeH
    expect(h.outcome).toBe('back')
    expect(Object.keys(out.labelDefs!)).toEqual(expect.arrayContaining([H, LIVE]))
    expect(out.gone).toEqual([])
    // One more check: L is still not gone.
    expect((await out.recheckLabelers()).gone).toEqual([])
    expect(stale).toBe(0)
  })

  it('an older prefs read never calls configureLabelers last', async () => {
    const p = pds({ prefs: [LABELERS([LIVE])], live: new Set([LIVE]) })
    const out = await restoreClient({ restore: async () => p.session } as never, ALICE, { userKey, onExpired: () => {}, key: 'GL' })
    const configure = vi.spyOn(out.agent, 'configureLabelers')
    const held = holdNext(p.routes, 'app.bsky.actor.getPreferences')
    const older = out.reloadModeration()
    await vi.waitFor(() => expect(held.arrived()).toBe(true))
    // Another app drops LIVE; a newer load is asked for.
    p.opts.prefs = [LABELERS([])]
    const newer = out.reloadModeration()
    held.release()
    await older
    await newer
    expect(configure.mock.calls.at(-1)![0]).toEqual([BSKY_LABELER_DID])
  })

  it('a Retry during a removal: the removal answers with the notice gone, and it stays gone', async () => {
    const { out, routes } = await restore([ADULT, LABELERS([GONE]), SAVED])
    const held = holdNext(routes, 'app.bsky.actor.putPreferences')
    const removal = out.removeGoneLabeler(GONE)
    await vi.waitFor(() => expect(held.arrived()).toBe(true))
    const retry = out.reloadModeration()
    held.release()
    const r = await removal
    expect(r.outcome).toBe('removed')
    expect(r.gone).toEqual([])
    expect((await retry).gone).toEqual([])
  })

  it('a check asked for while one waits joins it; one asked for while one runs is queued after', async () => {
    const { out, routes, calls } = await restore([LABELERS([LIVE])], [LIVE])
    const held = holdNext(routes, 'app.bsky.labeler.getServices')
    const running = out.recheckLabelers()
    await vi.waitFor(() => expect(held.arrived()).toBe(true))
    const a = out.recheckLabelers()
    const b = out.recheckLabelers()
    expect(b).toBe(a)
    held.release()
    await Promise.all([running, a, b])
    expect(countOf(calls, 'app.bsky.labeler.getServices')).toBe(2)
  })

  it('a removal whose labeler a load in front of it saw come back: no check, no write', async () => {
    const { out, opts, routes, calls } = await restore([ADULT, LABELERS([GONE]), SAVED])
    const held = holdNext(routes, 'app.bsky.actor.getPreferences')
    const reload = out.reloadModeration()
    await vi.waitFor(() => expect(held.arrived()).toBe(false))
    opts.live.add(GONE)
    const removal = out.removeGoneLabeler(GONE)
    held.release()
    await reload
    const r = await removal
    expect(r.outcome).toBe('back')
    expect(writes(calls)).toHaveLength(0)
  })
})

