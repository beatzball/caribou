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
  verifyCredentials(): Promise<mastodon.v1.AccountCredentials>
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

  // Relationships (follow / unfollow).
  fetchRelationships(accountIds: readonly string[]): Promise<mastodon.v1.Relationship[]>
  follow(accountId: string): Promise<mastodon.v1.Relationship>
  unfollow(accountId: string): Promise<mastodon.v1.Relationship>

  // Compose. Writes bypass dedup: two posts with the same text are two posts.
  createStatus(params: CreateStatusInput, opts?: { idempotencyKey?: string }): Promise<mastodon.v1.Status>
  /** Resolves once the server has processed the file and it has a `url`. */
  uploadMedia(file: Blob, opts?: UploadMediaOpts): Promise<mastodon.v1.MediaAttachment>
  fetchMedia(id: string): Promise<mastodon.v1.MediaAttachment>
  /** Polls an uploaded attachment until it has a `url`. */
  waitForMedia(id: string, opts?: WaitForMediaOpts): Promise<mastodon.v1.MediaAttachment>
  updateMedia(id: string, params: { description: string }): Promise<mastodon.v1.MediaAttachment>
  fetchInstance(): Promise<mastodon.v2.Instance>
}

export interface WaitForMediaOpts {
  pollIntervalMs?: number
  timeoutMs?: number
}

export interface UploadMediaOpts extends WaitForMediaOpts {
  description?: string
}

// The upload itself succeeded; only the server's processing outlasted the
// wait. `mediaId` lets a retry go back to waiting instead of uploading again.
export class MediaProcessingTimeout extends CaribouError {
  readonly mediaId: string
  constructor(mediaId: string) {
    super('server_error', 'media processing timed out')
    this.mediaId = mediaId
  }
}

export interface CreateStatusInput {
  status: string
  spoilerText?: string
  visibility: mastodon.v1.StatusVisibility
  inReplyToId?: string
  mediaIds?: string[]
  sensitive?: boolean
  language?: string
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

  // Video can take minutes to transcode on a busy server.
  async function waitForMedia(
    id: string, { pollIntervalMs = 1000, timeoutMs = 5 * 60_000 }: WaitForMediaOpts = {},
  ): Promise<mastodon.v1.MediaAttachment> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (Date.now() >= deadline) throw new MediaProcessingTimeout(id)
      await new Promise((r) => setTimeout(r, pollIntervalMs))
      const media = await run(`media:${id}`, (c) => c.v1.media.$select(id).fetch())
      if (media.url) return media
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
    async verifyCredentials() {
      return run('verify-credentials', (c) => c.v1.accounts.verifyCredentials())
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

    // --- relationships ---
    async fetchRelationships(accountIds) {
      return run(`relationships:${accountIds.join(',')}`, (c) =>
        c.v1.accounts.relationships.fetch({ id: [...accountIds] }),
      )
    },
    async follow(accountId) {
      return write((c) => c.v1.accounts.$select(accountId).follow())
    },
    async unfollow(accountId) {
      return write((c) => c.v1.accounts.$select(accountId).unfollow())
    },
    async createStatus(params, opts = {}) {
      const { status, mediaIds, ...rest } = params
      const body = mediaIds && mediaIds.length > 0
        ? { ...rest, status, mediaIds }
        : { ...rest, status }
      // Mastodon remembers an Idempotency-Key for an hour and answers a
      // repeat with the first post, so a retry after a lost response never
      // posts twice. The caller keeps one key per draft.
      const meta = opts.idempotencyKey
        ? { requestInit: { headers: { 'Idempotency-Key': opts.idempotencyKey } } }
        : undefined
      return write((c) => c.v1.statuses.create(body, meta))
    },
    async uploadMedia(file, opts = {}) {
      // Large files come back 202 with `url: null` while the server
      // transcodes them. masto can wait for that itself, but its wait is
      // not routed through run(), so a 401 mid-wait would skip onUnauthorized.
      const media = await write((c) => c.v2.media.create({
        file,
        ...(opts.description ? { description: opts.description } : {}),
        skipPolling: true,
      }))
      return media.url ? media : waitForMedia(media.id, opts)
    },
    waitForMedia,
    async fetchMedia(id) {
      return run(`media:${id}`, (c) => c.v1.media.$select(id).fetch())
    },
    async updateMedia(id, params) {
      return write((c) => c.v1.media.$select(id).update(params))
    },
    async fetchInstance() {
      return run('instance', (c) => c.v2.instance.fetch())
    },
  }
}
