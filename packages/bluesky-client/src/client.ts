import type { Agent, AppBskyFeedDefs } from '@atproto/api'
import type { UserKey } from '@beatzball/caribou-auth'
import {
  CaribouError, createDedup,
  type Account, type AccountCredentials, type AccountPage, type BlueskyModerationResult,
  type CaribouClient, type Capabilities, type Notification, type NotificationPage, type Role, type Status,
  type TimelineKind, type TimelinePage,
} from '@beatzball/caribou-mastodon-client'
import { normalizeXrpcError } from './errors.js'
import { mapAccount, mapRelationship, type ProfileView } from './map/account.js'
import type { MapContext } from './map/context.js'
import { feedEntryId, mapFeedEntry } from './map/feed-entry.js'
import { mapNotification, notificationPostUri, reasonsFor, type NotificationView } from './map/notification.js'
import { mapPost } from './map/post.js'

/** What Bluesky supports (spec 6.5). */
export const BLUESKY_CAPABILITIES: Readonly<Capabilities> = Object.freeze({
  network: 'bluesky',
  localTimeline: false,
  publicTimeline: false,
  visibility: false,
  contentWarningText: false,
  polls: false,
  edit: false,
  customEmoji: false,
  followTags: false,
  privateLists: false,
  serverFilters: false,
  maxChars: 300,
  maxBytes: 3000,
  maxImages: 4,
  maxImageBytes: 2_000_000,
  readLagMs: 60_000,
})

/** The parts of a signed-in `Agent` the read client calls. */
export type BlueskyAgent = Pick<Agent,
  'did' | 'getTimeline' | 'getAuthorFeed' | 'getPostThread' | 'getPosts' | 'getProfile' | 'getProfiles'
> & Pick<Agent, 'listNotifications' | 'countUnreadNotifications' | 'updateSeenNotifications'> & {
  app: {
    bsky: {
      bookmark: Pick<Agent['app']['bsky']['bookmark'], 'getBookmarks'>
      graph: Pick<Agent['app']['bsky']['graph'], 'getMutes' | 'getBlocks'>
    }
  }
}

/** Moderation as plain data, built by the caller from the reader's prefs (#180). */
export interface BlueskyModerationSource {
  post(view: AppBskyFeedDefs.PostView): BlueskyModerationResult
  profile(view: ProfileView): BlueskyModerationResult
}

export interface BlueskyClientOptions {
  /** `<did>@bsky`. */
  userKey: UserKey
  agent: BlueskyAgent
  moderation: BlueskyModerationSource
  /** Called on a 401, before the error is thrown. */
  onUnauthorized?: () => void
  /**
   * Called when one post fails to map and is dropped, with the error and the
   * post's URI. The page still answers without it. For logging; optional.
   */
  onMapError?: (err: unknown, uri: string) => void
}

/** Entries per page when the client pages on its own (catch-up). */
export const CATCH_UP_PAGE_SIZE = 50
/** Pages a catch-up reads before it calls the answer a gap (spec 6.3, seam 7). */
export const CATCH_UP_MAX_PAGES = 3
/** Pages of only unavailable bookmarks the client reads past before it stops. */
export const BOOKMARK_SKIP_PAGES = 5
/** The AppView's limit for `getPosts` and `getProfiles`. */
const BATCH = 25

const NO_ROLE: Role = {
  id: 0, name: '', color: '', position: 0, permissions: 0, highlighted: false, createdAt: '', updatedAt: '',
}

function page<T>(items: T[], cursor: string | undefined): T[] & { nextCursor: string | null } {
  // An empty page ends the feed, even when the AppView sends a cursor.
  return Object.assign(items, { nextCursor: items.length > 0 ? cursor ?? null : null })
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function isThreadViewPost(v: unknown): v is AppBskyFeedDefs.ThreadViewPost {
  return typeof v === 'object' && v !== null
    && (v as { $type?: unknown }).$type === 'app.bsky.feed.defs#threadViewPost'
}

function isPostView(v: object): v is AppBskyFeedDefs.PostView {
  return typeof v === 'object' && v !== null
    && (v as { $type?: unknown }).$type === 'app.bsky.feed.defs#postView'
}

function notYet(what: string, issue: string): () => Promise<never> {
  return () => Promise.reject(new CaribouError('not_found', `Bluesky: ${what} comes in ${issue}`))
}

/**
 * The Bluesky `CaribouClient`: the read methods (rules in the README).
 * Writes and later features answer `not_found`, naming their issue.
 */
export function createBlueskyClient(opts: BlueskyClientOptions): CaribouClient {
  const { userKey, agent, moderation } = opts
  const dedup = createDedup()
  const ctx: MapContext = { viewerOf: userKey, moderatePost: (view) => moderation.post(view) }

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await dedup.run(key, fn)
    } catch (err) {
      const norm = normalizeXrpcError(err)
      if (norm.code === 'unauthorized') opts.onUnauthorized?.()
      throw norm
    }
  }

  function account(view: ProfileView): Account {
    const a = mapAccount(view)
    return { ...a, bluesky: { ...a.bluesky!, moderation: moderation.profile(view) } }
  }

  // One bad post never fails a page: a mapper that throws on one post's data
  // drops that post. A page's end is still read from what the AppView sent.
  function each<T>(items: readonly T[], uriOf: (item: T) => string, map: (item: T) => Status): Status[] {
    return items.flatMap((item) => {
      try {
        return [map(item)]
      } catch (err) {
        opts.onMapError?.(err, uriOf(item))
        return []
      }
    })
  }

  function entries(feed: AppBskyFeedDefs.FeedViewPost[]): Status[] {
    return each(feed, (e) => e.post.uri, (e) => mapFeedEntry(e, ctx))
  }

  function posts(views: readonly AppBskyFeedDefs.PostView[]): Status[] {
    return each(views, (v) => v.uri, (v) => mapPost(v, ctx))
  }

  /** A page of mapped items; the AppView's own page length says whether it is the end. */
  function feedPage(raw: readonly unknown[], items: Status[], cursor: string | undefined): TimelinePage {
    return Object.assign(items, { nextCursor: raw.length > 0 ? cursor ?? null : null })
  }

  // Seam 7: no since_id, so page from the top until the known top entry.
  async function catchUp(
    fetchPage: (cursor: string | undefined) => Promise<{ feed: AppBskyFeedDefs.FeedViewPost[]; cursor?: string }>,
    sinceId: string,
  ): Promise<TimelinePage> {
    const out: AppBskyFeedDefs.FeedViewPost[] = []
    let cursor: string | undefined
    for (let i = 0; i < CATCH_UP_MAX_PAGES; i++) {
      const data = await fetchPage(cursor)
      const at = data.feed.findIndex((e) => feedEntryId(e) === sinceId)
      if (at !== -1) return page(entries([...out, ...data.feed.slice(0, at + 1)]), undefined)
      // An empty page ends the feed: its cursor names nothing.
      if (data.feed.length === 0) {
        cursor = undefined
        break
      }
      out.push(...data.feed)
      cursor = data.cursor
      if (!cursor) break
    }
    // Not met: a gap. Its cursor is where the page after it starts.
    return Object.assign(entries(out), { nextCursor: out.length > 0 ? cursor ?? null : null })
  }

  async function timeline(params: { sinceId?: string; cursor?: string; limit?: number }): Promise<TimelinePage> {
    const fetchPage = async (cursor: string | undefined, limit: number | undefined) =>
      (await agent.getTimeline({ ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) })).data
    if (params.sinceId) {
      const sinceId = params.sinceId
      return run(`home:since:${sinceId}`, () => catchUp((c) => fetchPage(c, CATCH_UP_PAGE_SIZE), sinceId))
    }
    return run(`home:${params.cursor ?? ''}:${params.limit ?? ''}`, async () => {
      const data = await fetchPage(params.cursor, params.limit)
      return feedPage(data.feed, entries(data.feed), data.cursor)
    })
  }

  async function bookmarks(params: { sinceId?: string; cursor?: string; limit?: number }): Promise<TimelinePage> {
    // Bookmarks are not polled, as on Mastodon.
    if (params.sinceId) return page([], undefined)
    return run(`bookmarks:${params.cursor ?? ''}:${params.limit ?? ''}`, async () => {
      // A page of only deleted or blocked bookmarks says nothing to show. Read
      // on, a few pages at most, until a page has a post or the bookmarks
      // end; at the budget, answer an empty page with the last cursor. That
      // is not the end: the store ends a list only on a null cursor.
      let cursor = params.cursor
      for (let i = 0; i < BOOKMARK_SKIP_PAGES; i++) {
        const { data } = await agent.app.bsky.bookmark.getBookmarks({
          ...(cursor ? { cursor } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
        })
        const views = data.bookmarks.map((b): object => b.item).filter(isPostView)
        if (data.bookmarks.length === 0) return page([], undefined)
        if (views.length > 0) return feedPage(data.bookmarks, posts(views), data.cursor)
        if (!data.cursor) return page([], undefined)
        cursor = data.cursor
      }
      return Object.assign([] as Status[], { nextCursor: cursor ?? null })
    })
  }

  async function accountPage(kind: 'mutes' | 'blocks', params: { cursor?: string; limit?: number } = {}): Promise<AccountPage> {
    return run(`${kind}:${params.cursor ?? ''}:${params.limit ?? ''}`, async () => {
      const q = { ...(params.cursor ? { cursor: params.cursor } : {}), ...(params.limit ? { limit: params.limit } : {}) }
      if (kind === 'mutes') {
        const { data } = await agent.app.bsky.graph.getMutes(q)
        return page(data.mutes.map(account), data.cursor)
      }
      const { data } = await agent.app.bsky.graph.getBlocks(q)
      return page(data.blocks.map(account), data.cursor)
    })
  }

  // --- notifications (README, "Notifications") ---

  type RawNotificationPage = { notifications: NotificationView[]; cursor?: string }

  // The page's notifications that Caribou shows, with their posts read in
  // batches. A skipped one is left out; a page's end is read from what the
  // AppView sent.
  async function notificationItems(raw: readonly NotificationView[]): Promise<Notification[]> {
    const wanted: NotificationView[] = []
    const uris = new Set<string>()
    for (const n of raw) {
      try {
        if (typeof n.author?.did !== 'string') continue
        const uri = notificationPostUri(n)
        if (uri === undefined) continue
        if (uri) uris.add(uri)
        wanted.push(n)
      } catch (err) {
        opts.onMapError?.(err, n?.uri ?? '')
      }
    }
    const views = uris.size === 0 ? [] : (await Promise.all(chunks([...uris], BATCH).map((list) => agent.getPosts({ uris: list }))))
      .flatMap((p) => p.data.posts)
    const byUri = new Map(posts(views).map((s) => [s.bluesky?.uri ?? s.id, s]))
    return wanted.flatMap((n) => {
      try {
        const uri = notificationPostUri(n)
        const mapped = mapNotification(n, account(n.author), uri ? byUri.get(uri) ?? null : null)
        return mapped ? [mapped] : []
      } catch (err) {
        opts.onMapError?.(err, n.uri)
        return []
      }
    })
  }

  // The seen hint: the newest time on the AppView's pages, skipped ones
  // included, and whether any was unread.
  function seenHint(raw: readonly NotificationView[]): { newestAt: string | null; newestUri: string | null; unread: boolean } {
    let newestAt: string | null = null
    let newestUri: string | null = null
    let unread = false
    for (const n of raw) {
      const at = typeof n?.indexedAt === 'string' && !Number.isNaN(Date.parse(n.indexedAt)) ? n.indexedAt : null
      if (at && (newestAt === null || Date.parse(at) > Date.parse(newestAt))) {
        newestAt = at
        newestUri = typeof n.uri === 'string' ? n.uri : null
      }
      if (n?.isRead === false) unread = true
    }
    return { newestAt, newestUri, unread }
  }

  async function notificationPage(raw: readonly NotificationView[], cursor: string | null): Promise<NotificationPage> {
    return Object.assign(await notificationItems(raw), { nextCursor: cursor, bluesky: seenHint(raw) })
  }

  async function notifications(params: {
    types?: readonly string[]; cursor?: string; sinceId?: string; sinceAt?: string; limit?: number
  }): Promise<NotificationPage> {
    const reasons = reasonsFor(params.types)
    const fetchPage = async (cursor: string | undefined, limit: number | undefined): Promise<RawNotificationPage> =>
      (await agent.listNotifications({
        ...(reasons.length > 0 ? { reasons } : {}),
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      })).data
    if (params.sinceId) {
      const sinceId = params.sinceId
      const sinceAt = params.sinceAt !== undefined ? Date.parse(params.sinceAt) : NaN
      // Met: the anchor itself, or the first one older than its time (the
      // anchor can be deleted). One at the same time is read; the store
      // drops the ones it holds.
      const met = (n: NotificationView) => n?.uri === sinceId
        || (!Number.isNaN(sinceAt) && Date.parse(n?.indexedAt ?? '') < sinceAt)
      return run(`notifications:${reasons.join(',')}:since:${sinceId}:${params.sinceAt ?? ''}`, async () => {
        const out: NotificationView[] = []
        let cursor: string | undefined
        for (let i = 0; i < CATCH_UP_MAX_PAGES; i++) {
          const data = await fetchPage(cursor, CATCH_UP_PAGE_SIZE)
          // Matched on the raw page, before any skip.
          const at = data.notifications.findIndex(met)
          if (at !== -1) return notificationPage([...out, ...data.notifications.slice(0, at)], null)
          if (data.notifications.length === 0) {
            cursor = undefined
            break
          }
          out.push(...data.notifications)
          cursor = data.cursor
          if (!cursor) break
        }
        // Not met: a gap, unless the list ended.
        return notificationPage(out, out.length > 0 ? cursor ?? null : null)
      })
    }
    return run(`notifications:${reasons.join(',')}:${params.cursor ?? ''}:${params.limit ?? ''}`, async () => {
      const data = await fetchPage(params.cursor, params.limit)
      // An empty AppView page ends the list; a page of skipped ones does not.
      return notificationPage(data.notifications, data.notifications.length > 0 ? data.cursor ?? null : null)
    })
  }

  function flattenReplies(node: AppBskyFeedDefs.ThreadViewPost, out: Status[]): void {
    for (const reply of node.replies ?? []) {
      if (!isThreadViewPost(reply)) continue
      out.push(...posts([reply.post]))
      flattenReplies(reply, out)
    }
  }

  const author = { posts: 'posts_no_replies', replies: 'posts_with_replies', media: 'posts_with_media' } as const

  return {
    userKey,
    capabilities: BLUESKY_CAPABILITIES,
    timelineOrder: () => null,

    async fetchTimeline(kind: TimelineKind, params = {}) {
      if (kind === 'home') return timeline(params)
      if (kind === 'bookmarks') return bookmarks(params)
      if (kind === 'local' || kind === 'public') {
        throw new CaribouError('not_found', `Bluesky has no ${kind} timeline`)
      }
      return notYet(`the ${kind.type} timeline`, kind.type === 'hashtag' ? '#193' : '#195')()
    },

    async fetchStatus(statusId) {
      return run(`status:${statusId}`, async () => {
        const { data } = await agent.getPosts({ uris: [statusId] })
        const post = posts(data.posts.slice(0, 1))[0]
        if (!post) throw new CaribouError('not_found', 'post not found', { status: 404 })
        return post
      })
    },

    async fetchStatuses(statusIds) {
      if (statusIds.length === 0) return []
      return run(`statuses:${statusIds.join(',')}`, async () => {
        const pages = await Promise.all(chunks(statusIds, BATCH).map((uris) => agent.getPosts({ uris })))
        return posts(pages.flatMap((p) => p.data.posts))
      })
    },

    async fetchThread(statusId) {
      return run(`thread:${statusId}`, async () => {
        const { data } = await agent.getPostThread({ uri: statusId })
        if (!isThreadViewPost(data.thread) || posts([data.thread.post]).length === 0) {
          throw new CaribouError('not_found', 'post not found', { status: 404 })
        }
        const ancestors: Status[] = []
        for (let p = data.thread.parent; isThreadViewPost(p); p = p.parent) ancestors.unshift(...posts([p.post]))
        const descendants: Status[] = []
        flattenReplies(data.thread, descendants)
        return { ancestors, descendants }
      })
    },

    async lookupAccount(handle) {
      const actor = handle.replace(/^@/, '')
      return run(`lookup:${actor}`, async () => account((await agent.getProfile({ actor })).data))
    },

    async verifyCredentials(): Promise<AccountCredentials> {
      return run('verify', async () => {
        if (!agent.did) throw new CaribouError('unauthorized', 'no active session')
        const view = (await agent.getProfile({ actor: agent.did })).data
        const a = account(view)
        return {
          ...a,
          source: {
            attributionDomains: [], note: view.description ?? '', fields: [], privacy: 'public',
            sensitive: false, language: null, indexable: true, quotePolicy: 'public', role: NO_ROLE,
          },
          role: NO_ROLE,
        }
      })
    },

    async fetchAccountStatuses(accountId, { tab, cursor, limit }) {
      return run(`author:${accountId}:${tab}:${cursor ?? ''}:${limit ?? ''}`, async () => {
        const { data } = await agent.getAuthorFeed({
          actor: accountId, filter: author[tab], includePins: false,
          ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}),
        })
        return feedPage(data.feed, entries(data.feed), data.cursor)
      })
    },

    async fetchRelationships(accountIds) {
      if (accountIds.length === 0) return []
      return run(`rels:${accountIds.join(',')}`, async () => {
        const pages = await Promise.all(chunks(accountIds, BATCH).map((actors) => agent.getProfiles({ actors })))
        const byDid = new Map(pages.flatMap((p) => p.data.profiles).map((v) => [v.did, mapRelationship(v)]))
        return accountIds.flatMap((id) => byDid.get(id) ?? [])
      })
    },

    fetchMutes: (params) => accountPage('mutes', params),
    fetchBlocks: (params) => accountPage('blocks', params),
    fetchFilters: async () => [],

    favourite: notYet('like', '#188'),
    unfavourite: notYet('unlike', '#188'),
    reblog: notYet('repost', '#188'),
    unreblog: notYet('undo repost', '#188'),
    bookmark: notYet('bookmark', '#188'),
    unbookmark: notYet('remove bookmark', '#188'),
    follow: notYet('follow', '#188'),
    unfollow: notYet('unfollow', '#188'),
    mute: notYet('mute', '#188'),
    unmute: notYet('unmute', '#188'),
    block: notYet('block', '#188'),
    unblock: notYet('unblock', '#188'),

    fetchTag: notYet('hashtags', '#193'),
    followTag: notYet('hashtags', '#193'),
    unfollowTag: notYet('hashtags', '#193'),

    fetchLists: notYet('lists', '#195'),
    fetchList: notYet('lists', '#195'),
    createList: notYet('lists', '#195'),
    updateList: notYet('lists', '#195'),
    deleteList: notYet('lists', '#195'),
    fetchListAccounts: notYet('lists', '#195'),
    addListAccounts: notYet('lists', '#195'),
    removeListAccounts: notYet('lists', '#195'),
    fetchAccountLists: notYet('lists', '#195'),

    createStatus: notYet('compose', '#189'),
    uploadMedia: notYet('compose', '#189'),
    fetchMedia: notYet('compose', '#189'),
    waitForMedia: notYet('compose', '#189'),
    updateMedia: notYet('compose', '#189'),
    fetchInstance: notYet('compose limits', '#189'),

    votePoll: notYet('polls', 'no issue: Bluesky has no polls'),
    fetchPoll: notYet('polls', 'no issue: Bluesky has no polls'),

    fetchStatusSource: notYet('delete and redraft', '#190'),
    editStatus: notYet('edit', 'no issue: Bluesky has no edit'),
    deleteStatus: notYet('delete', '#190'),
    fetchStatusHistory: notYet('edit history', 'no issue: Bluesky has no edit'),

    fetchNotifications: (params = {}) => notifications(params),
    fetchGroupedNotifications: notYet('server notification groups', 'no issue: Caribou groups Bluesky notifications itself'),
    fetchNotificationGroupAccounts: notYet('server notification groups', 'no issue: Caribou groups Bluesky notifications itself'),
    async getUnreadCount() {
      return run('unread-count', async () => {
        const { data } = await agent.countUnreadNotifications({})
        const count = (data as { count?: unknown }).count
        return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
      })
    },
    async updateSeen(seenAt) {
      // A write: not through the dedup.
      try {
        await agent.updateSeenNotifications(seenAt)
      } catch (err) {
        const norm = normalizeXrpcError(err)
        if (norm.code === 'unauthorized') opts.onUnauthorized?.()
        throw norm
      }
    },

    search: notYet('search', '#192'),
  }
}
