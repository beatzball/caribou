import { createRestAPIClient, type mastodon } from 'masto'
import type {
  Account, AccountCredentials, Capabilities, Filter, Instance, List, ListRepliesPolicy,
  MediaAttachment, Notification, NotificationType, Poll, Relationship, Search,
  Status, StatusEdit, StatusSource, StatusVisibility, Tag,
} from './types.js'
// Loads masto-mapping's correction to masto's declarations (see there).
import type {} from './masto-mapping.js'
import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError } from './caribou-error.js'
import { normalizeError } from './normalize-error.js'
import { createDedup } from './dedup.js'
import type { SessionSource } from './session-source.js'

export type TimelineKind = 'home' | 'local' | 'public' | 'bookmarks'
  | { type: 'hashtag'; tag: string }
  | { type: 'list'; id: string }

/**
 * How a timeline's posts are ordered: a compare function that sorts two
 * post ids newest first, or null to keep the order the feed sent.
 */
export type TimelineOrder = ((a: string, b: string) => number) | null

export interface CaribouClient {
  userKey: UserKey
  /** What this client's network can do. Fixed for the client's lifetime. */
  capabilities: Capabilities
  /** The order the timeline store keeps `kind` in (see `TimelineOrder`). */
  timelineOrder(kind: TimelineKind): TimelineOrder
  fetchTimeline(kind: TimelineKind, params?: {
    sinceId?: string
    maxId?: string
    limit?: number
  }): Promise<TimelinePage>
  fetchStatus(statusId: string): Promise<Status>
  /**
   * Several statuses in one request (`GET /api/v1/statuses?id[]=`,
   * Mastodon 4.3+), at most 20 ids. Unknown or hidden ids are left out. An
   * older server answers 404.
   */
  fetchStatuses(statusIds: readonly string[]): Promise<Status[]>
  fetchThread(statusId: string): Promise<{
    ancestors: Status[]
    descendants: Status[]
  }>
  lookupAccount(handle: string): Promise<Account>
  verifyCredentials(): Promise<AccountCredentials>
  fetchAccountStatuses(
    accountId: string,
    params: { tab: 'posts' | 'replies' | 'media'; maxId?: string; limit?: number },
  ): Promise<Status[]>

  // Status actions. Each resolves to the post itself as the server now has
  // it, never the reblog wrapper `reblog` creates.
  favourite(statusId: string): Promise<Status>
  unfavourite(statusId: string): Promise<Status>
  reblog(statusId: string): Promise<Status>
  unreblog(statusId: string): Promise<Status>
  bookmark(statusId: string): Promise<Status>
  unbookmark(statusId: string): Promise<Status>

  // Relationships (follow / unfollow).
  fetchRelationships(accountIds: readonly string[]): Promise<Relationship[]>
  follow(accountId: string): Promise<Relationship>
  unfollow(accountId: string): Promise<Relationship>
  // Mute and block. Each resolves to the relationship as the server now has
  // it. A mute hides the account's notifications too.
  mute(accountId: string): Promise<Relationship>
  unmute(accountId: string): Promise<Relationship>
  block(accountId: string): Promise<Relationship>
  unblock(accountId: string): Promise<Relationship>
  /** The muted accounts, newest first. Pages by the cursor in `nextMaxId`. */
  fetchMutes(params?: { maxId?: string; limit?: number }): Promise<AccountPage>
  /** The blocked accounts, newest first. Pages by the cursor in `nextMaxId`. */
  fetchBlocks(params?: { maxId?: string; limit?: number }): Promise<AccountPage>
  /** The reader's filters (filters v2). An older server answers 404. */
  fetchFilters(): Promise<Filter[]>

  // Hashtags. `following` on the result says whether the reader follows it.
  fetchTag(name: string): Promise<Tag>
  followTag(name: string): Promise<Tag>
  unfollowTag(name: string): Promise<Tag>

  // Lists. Only the reader's own lists; an account must be one the reader
  // follows before the server lets it join a list.
  fetchLists(): Promise<List[]>
  fetchList(id: string): Promise<List>
  createList(input: ListInput): Promise<List>
  updateList(id: string, input: ListInput): Promise<List>
  deleteList(id: string): Promise<void>
  /** Every member of the list: the pages the Link header names, in order. */
  fetchListAccounts(id: string): Promise<Account[]>
  addListAccounts(id: string, accountIds: readonly string[]): Promise<void>
  removeListAccounts(id: string, accountIds: readonly string[]): Promise<void>
  /** The reader's lists that hold the account. */
  fetchAccountLists(accountId: string): Promise<List[]>

  // Compose. Writes bypass dedup: two posts with the same text are two posts.
  createStatus(params: CreateStatusInput, opts?: { idempotencyKey?: string }): Promise<Status>
  /** Resolves once the server has processed the file and it has a `url`. */
  uploadMedia(file: Blob, opts?: UploadMediaOpts): Promise<MediaAttachment>
  fetchMedia(id: string): Promise<MediaAttachment>
  /** Polls an uploaded attachment until it has a `url`. */
  waitForMedia(id: string, opts?: WaitForMediaOpts): Promise<MediaAttachment>
  updateMedia(id: string, params: { description: string }): Promise<MediaAttachment>
  fetchInstance(): Promise<Instance>

  // Polls. A vote answers with the poll as the server now has it.
  /** Votes on a poll with the indexes of the chosen options. */
  votePoll(pollId: string, choices: readonly number[]): Promise<Poll>
  fetchPoll(pollId: string): Promise<Poll>

  // Edit and delete the reader's own posts.
  /** The post's plain text and content warning, as the author wrote them. */
  fetchStatusSource(statusId: string): Promise<StatusSource>
  /**
   * Replaces the post's text. Mastodon drops every attachment an edit does
   * not list, so pass the ids of the media to keep. Visibility cannot change.
   */
  editStatus(statusId: string, params: EditStatusInput): Promise<Status>
  /** Deletes the post. The answer carries `text`, the source to redraft from. */
  deleteStatus(statusId: string): Promise<Status>
  /** Every version of the post, oldest first, the current one last. */
  fetchStatusHistory(statusId: string): Promise<StatusEdit[]>

  // Notifications.
  fetchNotifications(params?: FetchNotificationsParams): Promise<Notification[]>
  /**
   * Grouped notifications (`GET /api/v2/notifications`, Mastodon 4.3+).
   * Favourites, boosts and follows are grouped; every other type comes as
   * a group of one. An older server answers 404 (`not_found`).
   */
  fetchGroupedNotifications(params?: FetchGroupedNotificationsParams): Promise<GroupedNotificationsPage>
  /** Every account in one notification group (`GET /api/v2/notifications/:group_key/accounts`). */
  fetchNotificationGroupAccounts(groupKey: string): Promise<Account[]>

  /**
   * Accounts, hashtags and posts that match `q` (`GET /api/v2/search`).
   * `resolve` asks the server to fetch a remote URL or handle it does not
   * know yet.
   */
  search(params: SearchInput): Promise<Search>
}

export type FetchGroupedNotificationsParams = Omit<FetchNotificationsParams, 'sinceId'>

/** The notification types the server groups for Caribou. */
export const GROUPED_NOTIFICATION_TYPES = ['favourite', 'reblog', 'follow'] as const

/**
 * One notification group as the server sends it. masto types
 * `sample_account_ids` as a string; it is a list.
 */
export interface NotificationGroupData {
  groupKey: string
  type: string
  /**
   * How many notifications the group has up to the top of this page,
   * older ones included: a running total, not a count for the page.
   */
  notificationsCount: number
  mostRecentNotificationId: string
  pageMinId?: string
  pageMaxId?: string
  latestPageNotificationAt?: string
  /** Some of the newest accounts in the group, newest first. A sample, not all of them. */
  sampleAccountIds: string[]
  statusId?: string | null
}

export interface GroupedNotificationsPage {
  accounts: Account[]
  statuses: Status[]
  notificationGroups: NotificationGroupData[]
}

export type SearchType = 'accounts' | 'hashtags' | 'statuses'

export interface SearchInput {
  q: string
  /** Only this kind of result. Omitted means all three. */
  type?: SearchType
  resolve?: boolean
  limit?: number
}

// Mastodon refuses `resolve` and `offset` without a token (401), so only a
// signed-in search sends them.
function searchQuery(params: SearchInput, signedIn: boolean) {
  return {
    q: params.q,
    ...(params.type ? { type: params.type } : {}),
    ...(signedIn && params.resolve ? { resolve: true } : {}),
    ...(params.limit ? { limit: params.limit } : {}),
  }
}

/**
 * A search on `server` with no token, for a reader who is not signed in.
 * Mastodon answers accounts and hashtags; it finds no posts without a
 * token, and it never resolves a remote URL.
 */
export async function searchPublic(
  server: string, params: Omit<SearchInput, 'resolve'>,
): Promise<Search> {
  try {
    const c = createRestAPIClient({ url: `https://${server}` })
    return await c.v2.search.list(searchQuery(params, false))
  } catch (err) {
    throw normalizeError(err)
  }
}

export interface FetchNotificationsParams {
  /** Only these types. Omitted or empty means every type. */
  types?: readonly NotificationType[]
  sinceId?: string
  /** The page just newer than this id; use it to page forward without a gap. */
  minId?: string
  maxId?: string
  limit?: number
}

// A page of a timeline. `nextMaxId` is set only where the last status id is
// not the cursor for the next page (bookmarks): the `max_id` to ask for next,
// or null when there is no next page. Undefined means "page by the last
// status id", as every other timeline does.
export type TimelinePage = Status[] & { nextMaxId?: string | null }

// A page of accounts. Mastodon pages mutes and blocks by the mute or block
// id, not the account id, and names the next page only in the Link header:
// `nextMaxId` is that cursor, or null on the last page.
export type AccountPage = Account[] & { nextMaxId: string | null }

// A list's fields. `exclusive` (Mastodon 4.2+) keeps the members' posts out
// of the home timeline; an older server ignores it. Unset fields are not sent.
export interface ListInput {
  title: string
  repliesPolicy?: ListRepliesPolicy
  exclusive?: boolean
}

// A safety stop for a list with very many members: 80 per page.
const MAX_LIST_ACCOUNT_PAGES = 50

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
  visibility: StatusVisibility
  inReplyToId?: string
  mediaIds?: string[]
  sensitive?: boolean
  language?: string
  /** A poll. Mastodon refuses a post with both a poll and media. */
  poll?: CreatePollInput
}

export interface CreatePollInput {
  options: readonly string[]
  /** Seconds the poll stays open. */
  expiresIn: number
  multiple?: boolean
  /** Hide the counts until the poll ends. */
  hideTotals?: boolean
}

export interface EditStatusInput {
  status: string
  spoilerText: string
  sensitive?: boolean
  language?: string | null
  mediaIds: readonly string[]
}

/** What Mastodon supports. `maxChars` and `maxImages` are its defaults; the server can say others. */
export const MASTODON_CAPABILITIES: Capabilities = Object.freeze({
  network: 'mastodon',
  localTimeline: true,
  publicTimeline: true,
  visibility: true,
  contentWarningText: true,
  polls: true,
  edit: true,
  customEmoji: true,
  followTags: true,
  privateLists: true,
  serverFilters: true,
  maxChars: 500,
  maxBytes: null,
  maxImages: 4,
  maxImageBytes: null,
})

// Mastodon ids are numbers too large for a double, sent as strings. A longer
// id is a larger number; ids of one length compare as text.
function newerFirst(a: string, b: string): number {
  if (a.length !== b.length) return b.length - a.length
  return a < b ? 1 : a > b ? -1 : 0
}

/**
 * Mastodon's timeline order: newest first by post id. Bookmarks run in the
 * order they were made, not by post id, so they keep the server's order.
 */
export function mastodonTimelineOrder(kind: TimelineKind): TimelineOrder {
  return kind === 'bookmarks' ? null : newerFirst
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
  ): Promise<MediaAttachment> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (Date.now() >= deadline) throw new MediaProcessingTimeout(id)
      await new Promise((r) => setTimeout(r, pollIntervalMs))
      const media = await run(`media:${id}`, (c) => c.v1.media.$select(id).fetch())
      if (media.url) return media
    }
  }

  // Mastodon pages bookmarks by bookmark id, not status id, and names the
  // next page only in the Link header. The caller keeps that cursor and
  // passes it back as `maxId`.
  async function fetchBookmarkTimeline(
    c: mastodon.rest.Client, params: { sinceId?: string; maxId?: string; limit?: number },
  ): Promise<TimelinePage> {
    // Bookmarks are not polled; a since_id would be a status id here too.
    if (params.sinceId) return Object.assign([], { nextMaxId: null })
    const res = await c.v1.bookmarks.list.$raw({
      ...(params.maxId ? { maxId: params.maxId } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    })
    return Object.assign(res.data, { nextMaxId: nextMaxIdFromLink(res.headers.get('link')) })
  }

  async function fetchAccountPage(
    kind: 'mutes' | 'blocks', params: { maxId?: string; limit?: number },
  ): Promise<AccountPage> {
    return run(`${kind}:${params.maxId ?? ''}:${params.limit ?? ''}`, async (c) => {
      const query = {
        ...(params.maxId ? { maxId: params.maxId } : {}),
        ...(params.limit ? { limit: params.limit } : {}),
      }
      const res = kind === 'mutes'
        ? await c.v1.mutes.list.$raw(query)
        : await c.v1.blocks.list.$raw(query)
      return Object.assign(res.data, { nextMaxId: nextMaxIdFromLink(res.headers.get('link')) })
    })
  }

  return {
    userKey,
    capabilities: MASTODON_CAPABILITIES,
    timelineOrder: mastodonTimelineOrder,
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
        if (kind === 'bookmarks') return fetchBookmarkTimeline(c, params)
        if (kind.type === 'hashtag') return c.v1.timelines.tag.$select(encodeURIComponent(kind.tag)).list(listParams)
        if (kind.type === 'list')    return c.v1.timelines.list.$select(encodeURIComponent(kind.id)).list(listParams)
        throw new CaribouError('unknown', `unhandled timeline kind: ${JSON.stringify(kind)}`)
      })
    },
    async fetchStatus(statusId) {
      return run(`status:${statusId}`, (c) => c.v1.statuses.$select(statusId).fetch())
    },
    async fetchStatuses(statusIds) {
      // masto 7 has no typed method for this endpoint; its client builds
      // the path from the property names, so `statuses.list` is
      // `GET /api/v1/statuses`, with the query and the answer camel-cased.
      type StatusList = { list(params: { id: string[] }): Promise<Status[]> }
      return run(`statuses:${statusIds.join(',')}`, async (c) =>
        (c.v1.statuses as unknown as StatusList).list({ id: [...statusIds] }))
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
    async mute(accountId) {
      return write((c) => c.v1.accounts.$select(accountId).mute({ notifications: true }))
    },
    async unmute(accountId) {
      return write((c) => c.v1.accounts.$select(accountId).unmute())
    },
    async block(accountId) {
      return write((c) => c.v1.accounts.$select(accountId).block())
    },
    async unblock(accountId) {
      return write((c) => c.v1.accounts.$select(accountId).unblock())
    },
    async fetchMutes(params = {}) {
      return fetchAccountPage('mutes', params)
    },
    async fetchBlocks(params = {}) {
      return fetchAccountPage('blocks', params)
    },
    async fetchFilters() {
      return run('filters', async (c) => c.v2.filters.list())
    },

    // --- tags ---
    // masto puts the name into the path as it is; a non-ASCII name must be
    // encoded.
    async fetchTag(name) {
      return run(`tag:${name}`, (c) => c.v1.tags.$select(encodeURIComponent(name)).fetch())
    },
    async followTag(name) {
      return write((c) => c.v1.tags.$select(encodeURIComponent(name)).follow())
    },
    async unfollowTag(name) {
      return write((c) => c.v1.tags.$select(encodeURIComponent(name)).unfollow())
    },

    // --- lists ---
    // masto puts an id into the path as it is; each one is encoded, so an
    // id can never leave its path segment.
    async fetchLists() {
      return run('lists', async (c) => c.v1.lists.list())
    },
    async fetchList(id) {
      return run(`list:${id}`, (c) => c.v1.lists.$select(encodeURIComponent(id)).fetch())
    },
    async createList(input) {
      return write((c) => c.v1.lists.create(listBody(input)))
    },
    async updateList(id, input) {
      return write((c) => c.v1.lists.$select(encodeURIComponent(id)).update(listBody(input)))
    },
    async deleteList(id) {
      await write((c) => c.v1.lists.$select(encodeURIComponent(id)).remove())
    },
    async fetchListAccounts(id) {
      return run(`list-accounts:${id}`, async (c) => {
        const all: Account[] = []
        let maxId: string | null = null
        for (let i = 0; i < MAX_LIST_ACCOUNT_PAGES; i++) {
          const res = await c.v1.lists.$select(encodeURIComponent(id)).accounts.list.$raw({
            limit: 80, ...(maxId ? { maxId } : {}),
          })
          all.push(...res.data)
          maxId = nextMaxIdFromLink(res.headers.get('link'))
          if (!maxId || res.data.length === 0) break
        }
        return all
      })
    },
    async addListAccounts(id, accountIds) {
      await write((c) => c.v1.lists.$select(encodeURIComponent(id)).accounts.create({ accountIds: [...accountIds] }))
    },
    async removeListAccounts(id, accountIds) {
      await write((c) => c.v1.lists.$select(encodeURIComponent(id)).accounts.remove({ accountIds: [...accountIds] }))
    },
    async fetchAccountLists(accountId) {
      return run(`account-lists:${accountId}`, async (c) => c.v1.accounts.$select(encodeURIComponent(accountId)).lists.list())
    },

    async createStatus(params, opts = {}) {
      const { status, mediaIds, poll, ...rest } = params
      // Media and a poll exclude each other; media wins, as Mastodon would
      // refuse the pair.
      const body: mastodon.rest.v1.CreateStatusParams = mediaIds && mediaIds.length > 0
        ? { ...rest, status, mediaIds }
        : { ...rest, status, ...(poll ? { poll: { ...poll, options: [...poll.options] } } : {}) }
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

    // --- polls ---
    async votePoll(pollId, choices) {
      return write((c) => c.v1.polls.$select(encodeURIComponent(pollId)).votes.create({ choices: [...choices] }))
    },
    async fetchPoll(pollId) {
      return run(`poll:${pollId}`, (c) => c.v1.polls.$select(encodeURIComponent(pollId)).fetch())
    },

    // --- edit and delete ---
    async fetchStatusSource(statusId) {
      return run(`status-source:${statusId}`, (c) => c.v1.statuses.$select(statusId).source.fetch())
    },
    async editStatus(statusId, params) {
      const { mediaIds, language, sensitive, ...rest } = params
      const body = {
        ...rest,
        ...(sensitive !== undefined ? { sensitive } : {}),
        ...(language ? { language } : {}),
        ...(mediaIds.length > 0 ? { mediaIds: [...mediaIds] } : {}),
      }
      return write((c) => c.v1.statuses.$select(statusId).update(body as mastodon.rest.v1.UpdateStatusParams))
    },
    async deleteStatus(statusId) {
      return write((c) => c.v1.statuses.$select(statusId).remove())
    },
    async fetchStatusHistory(statusId) {
      return run(`status-history:${statusId}`, async (c) => await c.v1.statuses.$select(statusId).history.list())
    },

    // --- notifications ---
    async fetchNotifications(params = {}) {
      const key = `notifications:${JSON.stringify(params)}`
      return run(key, async (c) => c.v1.notifications.list({
        ...(params.types && params.types.length > 0 ? { types: params.types } : {}),
        ...(params.sinceId ? { sinceId: params.sinceId } : {}),
        ...(params.minId ? { minId: params.minId } : {}),
        ...(params.maxId ? { maxId: params.maxId } : {}),
        ...(params.limit ? { limit: params.limit } : {}),
      }))
    },
    async fetchGroupedNotifications(params = {}) {
      const key = `grouped-notifications:${JSON.stringify(params)}`
      return run(key, async (c) => {
        // masto's group-type union collapses to three members; the server
        // takes any notification type here.
        type Types = mastodon.rest.v2.ListNotificationsParams['types']
        const page = await c.v2.notifications.list({
          groupedTypes: GROUPED_NOTIFICATION_TYPES as unknown as Types,
          expandAccounts: 'full',
          ...(params.types && params.types.length > 0 ? { types: params.types as unknown as Types } : {}),
          ...(params.minId ? { minId: params.minId } : {}),
          ...(params.maxId ? { maxId: params.maxId } : {}),
          ...(params.limit ? { limit: params.limit } : {}),
        })
        return {
          accounts: page.accounts ?? [],
          statuses: page.statuses ?? [],
          notificationGroups: (page.notificationGroups ?? []) as unknown as NotificationGroupData[],
        }
      })
    },
    async fetchNotificationGroupAccounts(groupKey) {
      return run(`notification-group-accounts:${groupKey}`, (c) =>
        c.v2.notifications.$select(encodeURIComponent(groupKey)).accounts.fetch())
    },

    // --- search ---
    async search(params) {
      return run(`search:${JSON.stringify(params)}`, async (c) =>
        c.v2.search.list(searchQuery(params, true)))
    },
  }
}

// masto's own params type has no `repliesPolicy`; it snake-cases every key,
// so the server gets `replies_policy`.
function listBody(input: ListInput): { title: string; exclusive?: boolean } {
  return {
    title: input.title,
    ...(input.repliesPolicy ? { repliesPolicy: input.repliesPolicy } : {}),
    ...(input.exclusive !== undefined ? { exclusive: input.exclusive } : {}),
  }
}

function nextMaxIdFromLink(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part)
    if (!m) continue
    try {
      return new URL(m[1]!).searchParams.get('max_id')
    } catch {
      return null
    }
  }
  return null
}
