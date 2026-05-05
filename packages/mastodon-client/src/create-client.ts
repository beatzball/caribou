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
}

export function createCaribouClient(userKey: UserKey, session: SessionSource): CaribouClient {
  const dedup = createDedup()

  function rest(): mastodon.rest.Client {
    const s = session.get()
    if (!s) throw new CaribouError('unauthorized', 'no active session')
    return createRestAPIClient({ url: `https://${s.server}`, accessToken: s.token })
  }

  async function run<T>(key: string, fn: (c: mastodon.rest.Client) => Promise<T>): Promise<T> {
    try {
      return await dedup.run(key, () => fn(rest()))
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
  }
}
