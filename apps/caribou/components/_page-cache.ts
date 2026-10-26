import { batch, signal } from '@preact/signals-core'
import type { LitroLocation } from '@beatzball/litro/runtime'
import {
  activeUserKey, createKeepAlive, mergeStatus, ownerGeneration, statusCache,
} from '@beatzball/caribou-state'
import type { mastodon } from 'masto'

/**
 * A cached page older than this still paints at once, but the reader is told
 * that it is being brought up to date (`<caribou-update-notice>` shows
 * "Updating…" while `updating` is above zero).
 */
export const STALE_MS = 5 * 60_000

/** How long "Updating…" may stay up for one refresh that does not end. */
export const UPDATING_MAX_MS = 15_000

/** How many background refreshes of the page on screen are running. */
export const updating = signal(0)

// Bumped on every navigation and account change. A refresh started under an
// earlier epoch belongs to a page that is gone and no longer counts.
let epoch = 0
let listening = false

function resetUpdating(): void {
  epoch++
  updating.value = 0
}

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  // LitroRouter dispatches popstate for a link click as well as for back
  // and forward, before the next page's `onBeforeEnter` runs.
  // A move to a hash on the same page is not a new page.
  let page = location.pathname + location.search
  window.addEventListener('popstate', () => {
    const next = location.pathname + location.search
    if (next === page) return
    page = next
    resetUpdating()
  })
  // The work of an earlier account is not the new account's page.
  let first = true
  activeUserKey.subscribe(() => {
    if (first) { first = false; return }
    resetUpdating()
  })
}

export function trackUpdate(work: Promise<unknown>): void {
  listen()
  const mine = epoch
  const generation = ownerGeneration()
  updating.value++
  let done = false
  const end = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    if (mine !== epoch || generation !== ownerGeneration()) return
    updating.value = Math.max(0, updating.value - 1)
  }
  const timer = setTimeout(end, UPDATING_MAX_MS)
  void work.finally(end)
}

interface Snapshot { data: unknown; at: number }

// The page data of the pages the reader saw last, by path and query. The
// keep-alive empties it when the active account changes.
const pages = createKeepAlive<Snapshot>(12)

// The objects `enterWithCache` handed out from the cache, so a timeline can
// tell an old snapshot from page data that just came off the network.
const snapshots = new WeakSet<object>()

/** Whether `data` is a cached snapshot rather than fresh page data. */
export function isCachedSnapshot(data: unknown): boolean {
  return typeof data === 'object' && data !== null && snapshots.has(data)
}

export interface CachedPage {
  serverData: unknown
  fetchData(location: LitroLocation): Promise<unknown>
}

const kindOf = (data: unknown) => (data as { kind?: unknown } | null)?.kind

// An error page is never kept: the next visit should try again in full. And
// a working page is never replaced by a page that is not: a slow network or
// a lost cookie must not turn the reader's list into an error or a sign-in
// prompt behind their back.
function worthKeeping(next: unknown, kept: Snapshot | undefined): boolean {
  if (next == null || kindOf(next) === 'error') return false
  return !(kindOf(kept?.data) === 'ok' && kindOf(next) !== 'ok')
}

function statusesIn(data: unknown): mastodon.v1.Status[] {
  if (!data || typeof data !== 'object') return []
  const d = data as Record<string, unknown>
  const out: mastodon.v1.Status[] = []
  for (const key of ['statuses', 'ancestors', 'descendants']) {
    const list = d[key]
    if (Array.isArray(list)) out.push(...(list as mastodon.v1.Status[]))
  }
  const focused = d.focused as mastodon.v1.Status | undefined
  if (focused && typeof focused === 'object' && 'id' in focused) out.push(focused)
  return out
}

function current(status: mastodon.v1.Status): mastodon.v1.Status {
  return statusCache.peek().get(status.id) ?? status
}

// A snapshot keeps the statuses as they were when the page was fetched. The
// reader may have favourited one or seen it edited since; the status cache
// has that, so the page is rebuilt from it.
function withCachedStatuses(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) }
  for (const key of ['statuses', 'ancestors', 'descendants']) {
    const list = out[key]
    if (Array.isArray(list)) out[key] = (list as mastodon.v1.Status[]).map(current)
  }
  const focused = out.focused as mastodon.v1.Status | undefined
  if (focused && typeof focused === 'object' && 'id' in focused) out.focused = current(focused)
  return out
}

export interface EnterWithCacheOpts {
  /** Gets the fresh page data, once the cache has painted the old copy. */
  onFresh?: (fresh: unknown) => void
  /**
   * False for a page whose page data never changes (Home: only the shell).
   * A revisit then makes no request of its own.
   */
  refresh?: boolean
}

/**
 * `onBeforeEnter` for a page that paints at once on a revisit. The router
 * swaps a page in only when this returns, so a cached page returns before
 * any request: it renders the snapshot, fetches its page data in the
 * background, and hands the result to `onFresh`. The fresh statuses go into
 * the status cache first, so counts and edits show on every card.
 *
 * A full page load always takes the normal path — the server's data is in
 * the document and the first client render must equal the server render.
 * That data is then stored, so the first move away and back is instant too.
 */
export async function enterWithCache(
  page: CachedPage,
  location: LitroLocation,
  enter: () => Promise<void>,
  { onFresh, refresh = true }: EnterWithCacheOpts = {},
): Promise<void> {
  const key = location.pathname + location.search
  const generation = ownerGeneration()
  const fullLoad = document.getElementById('__litro_data__') !== null
  const hit = fullLoad ? undefined : pages.get(key)
  if (!hit) {
    await enter()
    // A response for an account that is no longer active is shown this once
    // — it is what the reader asked for — but never kept for the next one.
    if (generation === ownerGeneration() && worthKeeping(page.serverData, pages.get(key))) {
      pages.set(key, { data: page.serverData, at: Date.now() })
    }
    return
  }
  const shown = withCachedStatuses(hit.data)
  if (shown && typeof shown === 'object') snapshots.add(shown)
  page.serverData = shown
  if (!refresh) return
  const work = page.fetchData(location).then((fresh) => {
    if (generation !== ownerGeneration()) return
    if (!worthKeeping(fresh, pages.get(key))) return
    batch(() => { for (const s of statusesIn(fresh)) mergeStatus(s) })
    pages.set(key, { data: fresh, at: Date.now() })
    onFresh?.(fresh)
  }).catch(() => { /* the snapshot stays on screen */ })
  if (Date.now() - hit.at > STALE_MS) trackUpdate(work)
}
