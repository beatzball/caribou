import { batch, signal } from '@preact/signals-core'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { filteredById, mergeStatus } from './caches.js'
import { ownerGeneration } from './keep-alive.js'

type Status = mastodon.v1.Status

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
export const readerChecks = signal<ReadonlyMap<string, ReaderCheck>>(new Map())

export function readerCheckFor(userKey: string, id: string): ReaderCheck | undefined {
  return readerChecks.value.get(`${userKey} ${id}`)
}

function mark(userKey: string, ids: readonly string[], to: ReaderCheck | null): void {
  const next = new Map(readerChecks.peek())
  for (const id of ids) {
    if (to) next.set(`${userKey} ${id}`, to)
    else next.delete(`${userKey} ${id}`)
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
  const unknown = ids.filter((id) => !filteredById.peek().has(id))
  mark(userKey, unknown, 'pending')
  let fresh: Status[] = []
  try {
    fresh = await batched(client, ids)
  } catch (err) {
    if ((err as { code?: string }).code === 'not_found') fresh = await oneByOne(client, ids)
  }
  // The account changed while the requests were out: these are its flags,
  // and its checks.
  if (generation !== ownerGeneration()) {
    mark(userKey, unknown, null)
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
    mark(userKey, settled, null)
    mark(userKey, unknown.filter((id) => !done.has(id)), 'failed')
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
