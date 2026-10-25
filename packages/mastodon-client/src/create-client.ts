import { createRestAPIClient, type mastodon } from 'masto'
import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError } from './caribou-error.js'
import { normalizeError } from './normalize-error.js'
import { createDedup } from './dedup.js'
import type { SessionSource } from './session-source.js'

export type TimelineKind = 'home' | 'local' | 'public' | 'bookmarks'
  | { type: 'hashtag'; tag: string }
  | { type: 'list'; id: string }

export interface CaribouClient {
  userKey: UserKey
  fetchTimeline(kind: TimelineKind, params?: {
    sinceId?: string
    maxId?: string
    limit?: number
  }): Promise<mastodon.v1.Status[]>
  fetchStatus(statusId: string): Promise<mastodon.v1.Status>
  fetchThread(statusId: string): Promise<{
    ancestors: mastodon.v1.Status[]
    descendants: mastodon.v1.Status[]
  }>
  lookupAccount(handle: string): Promise<mastodon.v1.Account>
  fetchAccountStatuses(
    accountId: string,
    params: { tab: 'posts' | 'replies' | 'media'; maxId?: string; limit?: number },
  ): Promise<mastodon.v1.Status[]>

  // Status actions. Each resolves to the post itself as the server now has
  // it, never the reblog wrapper `reblog` creates.
  favourite(statusId: string): Promise<mastodon.v1.Status>
  unfavourite(statusId: string): Promise<mastodon.v1.Status>
  reblog(statusId: string): Promise<mastodon.v1.Status>
  unreblog(statusId: string): Promise<mastodon.v1.Status>
  bookmark(statusId: string): Promise<mastodon.v1.Status>
  unbookmark(statusId: string): Promise<mastodon.v1.Status>
}

export function createCaribouClient(userKey: UserKey, session: SessionSource): CaribouClient {
  const dedup = createDedup()

  function rest(): mastodon.rest.Client {
    const s = session.get()
    if (!s) throw new CaribouError('unauthorized', 'no active session')
    return createRestAPIClient({ url: `https://${s.server}`, accessToken: s.token })
  }

  async function run<T>(key: string, fn: (c: mastodon.rest.Client) => Promise<T>): Promise<T> {
    return guard(() => dedup.run(key, () => fn(rest())))
  }

  // Writes skip dedup. Two calls are two intents: a favourite and the
  // unfavourite that follows it must both reach the server, and a shared
  // key would hand the second caller the first one's result.
  async function write<T>(fn: (c: mastodon.rest.Client) => Promise<T>): Promise<T> {
    return guard(() => fn(rest()))
  }

  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      const norm = normalizeError(err)
      if (norm.code === 'unauthorized') session.onUnauthorized()
      throw norm
    }
  }

  return {
    userKey,
    async fetchTimeline(kind, params = {}) {
      const key = `timeline:${JSON.stringify(kind)}:${JSON.stringify(params)}`
      return run(key, async (c) => {
        const listParams = {
          ...(params.sinceId ? { sinceId: params.sinceId } : {}),
          ...(params.maxId ? { maxId: params.maxId } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
        }
        if (kind === 'home')   return c.v1.timelines.home.list(listParams)
        if (kind === 'local')  return c.v1.timelines.public.list({ ...listParams, local: true })
        if (kind === 'public') return c.v1.timelines.public.list(listParams)
        if (kind === 'bookmarks') return c.v1.bookmarks.list(listParams)
        if (kind.type === 'hashtag') return c.v1.timelines.tag.$select(kind.tag).list(listParams)
        if (kind.type === 'list')    return c.v1.timelines.list.$select(kind.id).list(listParams)
        throw new CaribouError('unknown', `unhandled timeline kind: ${JSON.stringify(kind)}`)
      })
    },
    async fetchStatus(statusId) {
      return run(`status:${statusId}`, (c) => c.v1.statuses.$select(statusId).fetch())
    },
    async fetchThread(statusId) {
      return run(`thread:${statusId}`, (c) => c.v1.statuses.$select(statusId).context.fetch())
    },
    async lookupAccount(handle) {
      return run(`account-lookup:${handle}`, (c) =>
        c.v1.accounts.lookup({ acct: handle }),
      )
    },
    async fetchAccountStatuses(accountId, { tab, maxId, limit }) {
      const key = `acct-statuses:${accountId}:${tab}:${maxId ?? ''}:${limit ?? ''}`
      return run(key, async (c) =>
        c.v1.accounts.$select(accountId).statuses.list({
          ...(tab === 'posts' ? { excludeReplies: true } : {}),
          ...(tab === 'media' ? { onlyMedia: true } : {}),
          ...(maxId ? { maxId } : {}),
          ...(limit ? { limit } : {}),
        }),
      )
    },

    // --- status actions ---
    async favourite(statusId) {
      return write((c) => c.v1.statuses.$select(statusId).favourite())
    },
    async unfavourite(statusId) {
      return write((c) => c.v1.statuses.$select(statusId).unfavourite())
    },
    async reblog(statusId) {
      // Mastodon answers a boost with the new wrapper status; the caller
      // wants the post it wraps, with `reblogged` and the count updated.
      const wrapper = await write((c) => c.v1.statuses.$select(statusId).reblog())
      return wrapper.reblog ?? wrapper
    },
    async unreblog(statusId) {
      return write((c) => c.v1.statuses.$select(statusId).unreblog())
    },
    async bookmark(statusId) {
      return write((c) => c.v1.statuses.$select(statusId).bookmark())
    },
    async unbookmark(statusId) {
      return write((c) => c.v1.statuses.$select(statusId).unbookmark())
    },
  }
}
