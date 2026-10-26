import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeUserKey, cacheStatus, clearKeptAlive, statusCache,
} from '@beatzball/caribou-state'
import type { LitroLocation } from '@beatzball/litro/runtime'
import type { mastodon } from 'masto'
import {
  STALE_MS, UPDATING_MAX_MS, enterWithCache, isCachedSnapshot, trackUpdate, updating, type CachedPage,
} from '../_page-cache.js'

const loc = (pathname: string): LitroLocation => ({ pathname, params: {}, search: '', hash: '' })
const status = (id: string, extra: object = {}) => ({ id, ...extra }) as unknown as mastodon.v1.Status

function page(fresh: () => Promise<unknown>): CachedPage {
  return { serverData: null, fetchData: vi.fn(fresh) }
}

// What LitroPage's own onBeforeEnter does on a navigation without cache.
const enterWith = (p: CachedPage, data: unknown) => async () => { p.serverData = data }

beforeEach(() => {
  clearKeptAlive()
  statusCache.value = new Map()
  document.body.replaceChildren()
})
afterEach(() => {
  vi.useRealTimers()
  activeUserKey.value = null
  updating.value = 0
})

type Key = NonNullable<typeof activeUserKey.value>
const alice = 'alice@example.social' as Key
const bob = 'bob@example.social' as Key

// A revisit whose background fetch is held until the test resolves it.
async function heldRevisit(path: string, onFresh = vi.fn()) {
  let resolve!: (v: unknown) => void
  const p = page(() => new Promise((r) => { resolve = r }))
  await enterWithCache(p, loc(path), async () => {}, { onFresh })
  return { page: p, resolve: (v: unknown) => resolve(v), onFresh }
}

async function visit(path: string, data: unknown) {
  const p = page(async () => null)
  const enter = vi.fn(enterWith(p, data))
  await enterWithCache(p, loc(path), enter)
  return { page: p, enter }
}

describe('enterWithCache', () => {
  it('waits for the data on a first visit and keeps it', async () => {
    const first = page(async () => null)
    await enterWithCache(first, loc('/local'), enterWith(first, { kind: 'ok', statuses: [] }))
    expect(first.serverData).toEqual({ kind: 'ok', statuses: [] })
    expect(first.fetchData).not.toHaveBeenCalled()
  })

  it('returns the kept data at once on a revisit, then hands over the fresh data', async () => {
    const first = page(async () => null)
    await enterWithCache(first, loc('/local'), enterWith(first, { kind: 'ok', n: 1 }))

    let resolve!: (v: unknown) => void
    const again = page(() => new Promise((r) => { resolve = r }))
    const enter = vi.fn(async () => {})
    const onFresh = vi.fn()
    await enterWithCache(again, loc('/local'), enter, { onFresh })
    expect(enter).not.toHaveBeenCalled()
    expect(again.serverData).toEqual({ kind: 'ok', n: 1 })

    resolve({ kind: 'ok', n: 2 })
    await vi.waitFor(() => expect(onFresh).toHaveBeenCalledWith({ kind: 'ok', n: 2 }))
  })

  it('never reads the cache on a full page load', async () => {
    const first = page(async () => null)
    await enterWithCache(first, loc('/local'), enterWith(first, { n: 1 }))
    const script = document.createElement('script')
    script.id = '__litro_data__'
    document.body.append(script)
    const load = page(async () => null)
    const enter = vi.fn(enterWith(load, { n: 9 }))
    await enterWithCache(load, loc('/local'), enter)
    expect(enter).toHaveBeenCalled()
    expect(load.serverData).toEqual({ n: 9 })
  })

  it('rebuilds kept statuses from the status cache', async () => {
    const first = page(async () => null)
    await enterWithCache(first, loc('/@a/1'), enterWith(first, {
      focused: status('f'), ancestors: [status('x')], descendants: [], statuses: undefined,
    }))
    cacheStatus(status('f', { favourited: true }))
    cacheStatus(status('x', { content: 'edited' }))
    const again = page(() => new Promise(() => {}))
    await enterWithCache(again, loc('/@a/1'), async () => {})
    const data = again.serverData as { focused: mastodon.v1.Status; ancestors: mastodon.v1.Status[] }
    expect(data.focused.favourited).toBe(true)
    expect(data.ancestors[0]!.content).toBe('edited')
  })

  it('reports an update while an old page refreshes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const first = page(async () => null)
    await enterWithCache(first, loc('/home'), enterWith(first, { n: 1 }))
    vi.setSystemTime(Date.now() + STALE_MS + 1)
    let resolve!: (v: unknown) => void
    const again = page(() => new Promise((r) => { resolve = r }))
    await enterWithCache(again, loc('/home'), async () => {})
    expect(updating.value).toBe(1)
    resolve({ n: 2 })
    await vi.waitFor(() => expect(updating.value).toBe(0))
  })

  it('reports no update for a recent page', async () => {
    const first = page(async () => null)
    await enterWithCache(first, loc('/home'), enterWith(first, { n: 1 }))
    const again = page(() => new Promise(() => {}))
    await enterWithCache(again, loc('/home'), async () => {})
    expect(updating.value).toBe(0)
  })

  it('puts fresh statuses into the status cache and keeps the reader flags', async () => {
    cacheStatus(status('f', { content: 'old', favourited: true, favouritesCount: 1 }))
    await visit('/@a/1', { kind: 'ok', focused: status('f', { content: 'old' }), ancestors: [], descendants: [] })
    const { resolve, onFresh } = await heldRevisit('/@a/1')
    resolve({ kind: 'ok', focused: status('f', { content: 'edited', favourited: false, favouritesCount: 2 }),
      ancestors: [], descendants: [status('r', { content: 'reply' })] })
    await vi.waitFor(() => expect(onFresh).toHaveBeenCalled())
    const f = statusCache.value.get('f')!
    expect([f.content, f.favourited, f.favouritesCount]).toEqual(['edited', true, 2])
    expect(statusCache.value.get('r')!.content).toBe('reply')
    const next = await heldRevisit('/@a/1')
    expect((next.page.serverData as { focused: mastodon.v1.Status }).focused.content).toBe('edited')
  })

  it('does not keep an error page', async () => {
    await visit('/local', { kind: 'error', message: 'x' })
    const again = await visit('/local', { kind: 'ok' })
    expect(again.enter).toHaveBeenCalled()
  })

  it('keeps the good page when the background fetch brings an error or a sign-in prompt', async () => {
    await visit('/local', { kind: 'ok', n: 1 })
    for (const bad of [{ kind: 'error' }, { kind: 'auth-required' }]) {
      const { resolve, onFresh } = await heldRevisit('/local')
      resolve(bad)
      await new Promise((r) => setTimeout(r, 0))
      expect(onFresh).not.toHaveBeenCalled()
    }
    const next = await heldRevisit('/local')
    expect(next.page.serverData).toEqual({ kind: 'ok', n: 1 })
  })

  it('drops a background result that arrives after the account changed, even back again', async () => {
    activeUserKey.value = alice
    await visit('/local', { kind: 'ok', owner: 'alice' })
    const { resolve, onFresh } = await heldRevisit('/local')
    activeUserKey.value = bob
    activeUserKey.value = alice
    resolve({ kind: 'ok', owner: 'late' })
    await new Promise((r) => setTimeout(r, 0))
    expect(onFresh).not.toHaveBeenCalled()
    // The switch emptied the cache; the late result did not refill it.
    const again = await visit('/local', { kind: 'ok', owner: 'alice again' })
    expect(again.enter).toHaveBeenCalled()
  })

  it('does not keep a first visit that ends under another account', async () => {
    activeUserKey.value = alice
    const p = page(async () => null)
    await enterWithCache(p, loc('/local'), async () => {
      activeUserKey.value = bob
      p.serverData = { kind: 'ok', owner: 'alice' }
    })
    const again = await visit('/local', { kind: 'ok', owner: 'bob' })
    expect(again.enter).toHaveBeenCalled()
  })

  it('makes no request on a revisit of a page with refresh off', async () => {
    await visit('/home', { kind: 'auth-required' })
    const p = page(async () => null)
    await enterWithCache(p, loc('/home'), async () => {}, { refresh: false })
    expect(p.serverData).toEqual({ kind: 'auth-required' })
    expect(p.fetchData).not.toHaveBeenCalled()
  })

  it('marks what it hands out as a cached snapshot', async () => {
    const first = await visit('/local', { kind: 'ok' })
    expect(isCachedSnapshot(first.page.serverData)).toBe(false)
    const again = await heldRevisit('/local')
    expect(isCachedSnapshot(again.page.serverData)).toBe(true)
  })
})

// What a link click does: a new address, then popstate.
let pages = 0
function navigate(path = `/page-${++pages}`) {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

describe('trackUpdate', () => {
  it('keeps counting across a move to a hash on the same page', () => {
    navigate('/same')
    trackUpdate(new Promise(() => {}))
    navigate('/same#reply')
    expect(updating.value).toBe(1)
  })

  it('stops counting a refresh once the reader navigates', () => {
    trackUpdate(new Promise(() => {}))
    expect(updating.value).toBe(1)
    navigate()
    expect(updating.value).toBe(0)
  })

  it('gives up on a refresh that never ends', () => {
    vi.useFakeTimers()
    trackUpdate(new Promise(() => {}))
    vi.advanceTimersByTime(UPDATING_MAX_MS)
    expect(updating.value).toBe(0)
  })

  it('a refresh from before a navigation does not end a newer one', async () => {
    let endOld!: () => void
    trackUpdate(new Promise<void>((r) => { endOld = r }))
    navigate()
    trackUpdate(new Promise(() => {}))
    endOld()
    await new Promise((r) => setTimeout(r, 0))
    expect(updating.value).toBe(1)
  })

  it('work from an earlier account neither counts nor ends the new account\'s work', async () => {
    activeUserKey.value = alice
    let endOld!: () => void
    trackUpdate(new Promise<void>((r) => { endOld = r }))
    activeUserKey.value = bob
    expect(updating.value).toBe(0)
    trackUpdate(new Promise(() => {}))
    endOld()
    await new Promise((r) => setTimeout(r, 0))
    expect(updating.value).toBe(1)
  })
})
