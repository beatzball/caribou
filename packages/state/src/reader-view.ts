import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { mergeStatus } from './caches.js'
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

// Mastodon's limit for `GET /api/v1/statuses?id[]=`.
const BATCH = 20
// An older server has no batch endpoint; then each post is fetched alone,
// a few at a time, and only the first page's worth.
const SINGLE_MAX = 40
const SINGLE_AT_ONCE = 4

export async function loadReaderView(statuses: readonly Status[], client: CaribouClient): Promise<void> {
  const byId = new Map<string, Status>()
  for (const s of statuses) byId.set(s.id, s)
  if (byId.size === 0) return
  const ids = [...byId.keys()]
  const generation = ownerGeneration()
  let fresh: Status[]
  try {
    fresh = await batched(client, ids)
  } catch (err) {
    if ((err as { code?: string }).code !== 'not_found') return
    fresh = await oneByOne(client, ids.slice(0, SINGLE_MAX))
  }
  // The account changed while the requests were out: these are its flags.
  if (generation !== ownerGeneration()) return
  for (const f of fresh) {
    const own = byId.get(f.id)
    if (own && own.uri === f.uri) mergeStatus(f)
  }
}

async function batched(client: CaribouClient, ids: string[]): Promise<Status[]> {
  const out: Status[] = []
  for (let i = 0; i < ids.length; i += BATCH) out.push(...await client.fetchStatuses(ids.slice(i, i + BATCH)))
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
