import { batch, signal } from '@preact/signals-core'
import type { CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import { mergeStatus, postRecords } from './caches.js'
import { ownerGeneration } from './keep-alive.js'


// The server renders /local, /public, profiles and threads from a fetch with
// no token, so those posts carry none of the reader's own state: no
// `filtered`, no favourited flag. Once the page runs with a session, this
// asks the reader's server for the same posts and merges the answers into
// the status cache, so the reader's filters apply within a moment.
//
// The caller must know the posts came from the reader's own server: status
// ids are minted per server, and the same id elsewhere is another post. An
// answer whose `uri` differs from the post it replaces is dropped all the
// same.

// Where each post stands, for the reader it was asked for, keyed like the
// relationship cache (`userKey id`): 'pending' while the request is out,
// 'failed' when no copy came back (an error, or the server left the post
// out). A post not in the map is settled. A card covers a post that is not
// settled, so the reader never sees one their filters would hide.
export type ReaderCheck = 'pending' | 'failed'

// Each entry remembers the request that set it. A request settles or clears
// only its own entries, so an older one (from before an account change and
// back, say) can never clear a newer request's pending check.
interface Entry { state: ReaderCheck; request: number }

export const readerChecks = signal<ReadonlyMap<string, Entry>>(new Map())
let requests = 0

export function readerCheckFor(userKey: string, id: string): ReaderCheck | undefined {
  return readerChecks.value.get(`${userKey} ${id}`)?.state
}

function claim(userKey: string, ids: readonly string[], request: number): void {
  const next = new Map(readerChecks.peek())
  for (const id of ids) next.set(`${userKey} ${id}`, { state: 'pending', request })
  readerChecks.value = next
}

// Moves this request's own entries to `to` (null: settled, removed).
function release(userKey: string, ids: readonly string[], request: number, to: ReaderCheck | null): void {
  const next = new Map(readerChecks.peek())
  for (const id of ids) {
    const key = `${userKey} ${id}`
    if (next.get(key)?.request !== request) continue
    if (to) next.set(key, { state: to, request })
    else next.delete(key)
  }
  readerChecks.value = next
}

// Mastodon's limit for// Mastodon's limit for `GET /api/v1/statuses?id[]=`.
const BATCH = 20
// An older server has no batch endpoint; then each post is fetched alone,
// a few at a time, every one of them.
const SINGLE_AT_ONCE = 4

export async function loadReaderView(statuses: readonly Status[], client: CaribouClient): Promise<void> {
  const byId = new Map<string, Status>()
  for (const s of statuses) byId.set(s.id, s)
  if (byId.size === 0) return
  const ids = [...byId.keys()]
  const userKey = client.userKey
  const generation = ownerGeneration()
  // A post whose reader filters are known already stays as it is while it
  // is asked again: covering it would make a shown post blink.
  const unknown = ids.filter((id) => postRecords.peek().get(id)?.filtered === undefined)
  const request = ++requests
  claim(userKey, unknown, request)
  let fresh: Status[] = []
  try {
    fresh = await batched(client, ids)
  } catch (err) {
    if ((err as { code?: string }).code === 'not_found') fresh = await oneByOne(client, ids)
  }
  // The account changed while the requests were out: these are its flags,
  // and its checks.
  if (generation !== ownerGeneration()) {
    release(userKey, unknown, request, null)
    return
  }
  const settled: string[] = []
  batch(() => {
    for (const f of fresh) {
      const own = byId.get(f.id)
      if (!own || own.uri !== f.uri) continue
      mergeStatus(f)
      settled.push(f.id)
    }
    const done = new Set(settled)
    release(userKey, settled, request, null)
    release(userKey, unknown.filter((id) => !done.has(id)), request, 'failed')
  })
}

// A batch that fails leaves its posts out (they end 'failed'); the others
// still count. Only a 404 on the first batch means the endpoint is missing.
async function batched(client: CaribouClient, ids: string[]): Promise<Status[]> {
  const out: Status[] = []
  for (let i = 0; i < ids.length; i += BATCH) {
    try {
      out.push(...await client.fetchStatuses(ids.slice(i, i + BATCH)))
    } catch (err) {
      if (i === 0 && (err as { code?: string }).code === 'not_found') throw err
    }
  }
  return out
}

async function oneByOne(client: CaribouClient, ids: string[]): Promise<Status[]> {
  const out: Status[] = []
  for (let i = 0; i < ids.length; i += SINGLE_AT_ONCE) {
    const settled = await Promise.allSettled(ids.slice(i, i + SINGLE_AT_ONCE).map((id) => client.fetchStatus(id)))
    for (const r of settled) if (r.status === 'fulfilled') out.push(r.value)
  }
  return out
}
