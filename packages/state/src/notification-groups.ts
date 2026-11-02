import type { GroupedNotificationsPage } from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'

/**
 * One row of the notifications list. A favourite, a boost or a follow can
 * stand for many notifications; every other type is a group of one.
 */
export interface NotificationGroup {
  key: string
  type: string
  /** How many notifications the row stands for, as far as the list knows. */
  count: number
  /** Who did it, newest first, each once. From a server group: a sample. */
  accounts: mastodon.v1.Account[]
  /** Whether `accounts` is everyone in the group, not a sample. */
  complete: boolean
  status: mastodon.v1.Status | null
  /** The newest and the oldest notification id the row covers. */
  newestId: string
  oldestId: string
}

/** The types that group. The rest are one row each. */
export const GROUPABLE_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(['favourite', 'reblog', 'follow'])

/**
 * Mastodon ids are numbers in a string and grow over time; a longer id is a
 * newer one. Comparing them as numbers would lose precision past 2^53.
 */
export function compareNotificationIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

// Read loosely: a server can leave out a field its type says is there.
type LooseNotification = {
  id: string
  type: string
  createdAt?: string
  groupKey?: string
  account?: mastodon.v1.Account | null
  status?: mastodon.v1.Status | null
}

// The server's key when it sent one (Mastodon 4.3+ sends it on v1 too),
// also one that says `ungrouped-`. An older server sends none: the same
// type on the same post, or a follow, on the same UTC day share a row.
function clientGroupKey(n: LooseNotification): string {
  if (n.groupKey) return n.groupKey
  if (!GROUPABLE_NOTIFICATION_TYPES.has(n.type)) return `ungrouped-${n.id}`
  const day = (n.createdAt ?? '').slice(0, 10)
  return `${n.type}-${n.status?.id ?? ''}-${day}`
}

function addAccount(list: mastodon.v1.Account[], account: mastodon.v1.Account | null | undefined) {
  if (account && !list.some((a) => a.id === account.id)) list.push(account)
}

/**
 * Groups a list of single notifications, newest first, as an older server
 * sends them. Every row sits where its newest notification is. The whole
 * list is grouped again on every change, so a page added below or above
 * joins its rows with no duplicates.
 */
export function groupNotifications(list: readonly mastodon.v1.Notification[]): NotificationGroup[] {
  const out: NotificationGroup[] = []
  const byKey = new Map<string, NotificationGroup>()
  const seen = new Set<string>()
  for (const raw of list) {
    const n = raw as unknown as LooseNotification
    if (seen.has(n.id)) continue
    seen.add(n.id)
    const key = clientGroupKey(n)
    let group = byKey.get(key)
    if (!group) {
      group = {
        key, type: n.type, count: 0, accounts: [], complete: true,
        status: n.status ?? null, newestId: n.id, oldestId: n.id,
      }
      byKey.set(key, group)
      out.push(group)
    }
    group.count++
    addAccount(group.accounts, n.account)
    if (compareNotificationIds(n.id, group.newestId) > 0) group.newestId = n.id
    if (compareNotificationIds(n.id, group.oldestId) < 0) group.oldestId = n.id
  }
  return out
}

/** The rows of one page from `GET /api/v2/notifications`. */
export function groupsFromPage(page: GroupedNotificationsPage): NotificationGroup[] {
  const accounts = new Map(page.accounts.map((a) => [a.id, a]))
  const statuses = new Map(page.statuses.map((s) => [s.id, s]))
  return page.notificationGroups.map((g) => {
    const list: mastodon.v1.Account[] = []
    for (const id of g.sampleAccountIds ?? []) addAccount(list, accounts.get(id))
    // Mastodon's count covers the sample, so the guard only matters for a
    // server that sends a wider sample than its count, or no count.
    const count = Math.max(g.notificationsCount ?? 1, list.length, 1)
    return {
      key: g.groupKey,
      type: g.type,
      count,
      accounts: list,
      complete: list.length >= count,
      status: g.statusId ? statuses.get(g.statusId) ?? null : null,
      newestId: g.pageMaxId ?? g.mostRecentNotificationId,
      oldestId: g.pageMinId ?? g.mostRecentNotificationId,
    }
  })
}

// Joins two parts of one group. `newer` covers the newer notifications.
// Mastodon's `notifications_count` counts every notification of the group
// up to the top of its page, older ones included. So the newer part's count
// is the total, and the older part's is already in it: never add them.
function join(newer: NotificationGroup, older: NotificationGroup): NotificationGroup {
  const accounts: mastodon.v1.Account[] = []
  for (const a of newer.accounts) addAccount(accounts, a)
  for (const a of older.accounts) addAccount(accounts, a)
  const count = Math.max(newer.count, accounts.length)
  return {
    ...older,
    status: newer.status ?? older.status,
    count,
    accounts,
    complete: accounts.length >= count,
    newestId: compareNotificationIds(newer.newestId, older.newestId) > 0 ? newer.newestId : older.newestId,
    oldestId: compareNotificationIds(newer.oldestId, older.oldestId) < 0 ? newer.oldestId : older.oldestId,
  }
}

/** Adds an older page below the list. A group already in the list takes its part and keeps its place. */
export function appendOlderGroups(list: readonly NotificationGroup[], older: readonly NotificationGroup[]): NotificationGroup[] {
  const out = [...list]
  const index = new Map(out.map((g, i) => [g.key, i]))
  for (const g of older) {
    const i = index.get(g.key)
    if (i === undefined) {
      index.set(g.key, out.length)
      out.push(g)
    } else {
      out[i] = join(out[i]!, g)
    }
  }
  return out
}

/**
 * Puts a newer page on top of the list. A group already in the list takes
 * the new part and moves up to where its newest notification now is.
 */
export function prependNewerGroups(list: readonly NotificationGroup[], newer: readonly NotificationGroup[]): NotificationGroup[] {
  const old = new Map(list.map((g) => [g.key, g]))
  const top: NotificationGroup[] = []
  const moved = new Set<string>()
  for (const g of newer) {
    const prev = old.get(g.key)
    if (prev && !moved.has(g.key)) {
      top.push(join(g, prev))
      moved.add(g.key)
    } else if (!moved.has(g.key)) {
      top.push(g)
      moved.add(g.key)
    }
  }
  return [...top, ...list.filter((g) => !moved.has(g.key))]
}

/**
 * Takes the accounts the reader mutes or blocks out of each row. A row
 * with nobody left goes. A server row knows only a sample: when the whole
 * sample is silenced, the people outside it still count, and the row stays
 * with no names. A row without accounts (a poll that ended) stays.
 */
export function withoutSilencedAccounts(
  list: readonly NotificationGroup[], silenced: ReadonlySet<string>,
): NotificationGroup[] {
  if (silenced.size === 0) return [...list]
  const out: NotificationGroup[] = []
  for (const g of list) {
    const accounts = g.accounts.filter((a) => !silenced.has(a.id))
    if (accounts.length === g.accounts.length) {
      out.push(g)
    } else {
      const count = Math.max(accounts.length, g.count - (g.accounts.length - accounts.length))
      if (accounts.length > 0 || (!g.complete && count > 0)) out.push({ ...g, accounts, count })
    }
  }
  return out
}
