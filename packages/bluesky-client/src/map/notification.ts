import type { AppBskyNotificationListNotifications } from '@atproto/api'
import type { Account, Notification, NotificationType, Status } from '@beatzball/caribou-mastodon-client'

/** One notification as `app.bsky.notification.listNotifications` sends it. */
export type NotificationView = AppBskyNotificationListNotifications.Notification

/**
 * The reasons Caribou shows, and the type each one becomes (README,
 * "Notifications"). Every other reason is skipped. A `Map`, so a reason
 * named like an `Object` member (`constructor`, `__proto__`) is unknown.
 */
export const NOTIFICATION_REASONS: ReadonlyMap<string, NotificationType> = new Map<string, NotificationType>([
  ['like', 'favourite'],
  ['repost', 'reblog'],
  ['follow', 'follow'],
  ['mention', 'mention'],
  ['reply', 'mention'],
  ['quote', 'mention'],
])

/** The Caribou type for an AppView reason, or undefined when it is not shown. */
export function notificationType(reason: unknown): NotificationType | undefined {
  return typeof reason === 'string' ? NOTIFICATION_REASONS.get(reason) : undefined
}

/** The AppView reasons for a filter's Caribou types. Empty: send none (every reason). */
export function reasonsFor(types: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const t of types ?? []) {
    for (const [reason, type] of NOTIFICATION_REASONS) {
      if (type === t && !out.includes(reason)) out.push(reason)
    }
  }
  return out
}

function validTime(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v))
}

/**
 * The post a notification shows, or null for one without a post (a
 * follow). Undefined: the notification is skipped (an unknown reason, a
 * like or repost with no subject).
 */
export function notificationPostUri(n: NotificationView): string | null | undefined {
  const type = notificationType(n.reason)
  if (!type) return undefined
  if (type === 'follow') return null
  if (type === 'mention') return n.uri
  return typeof n.reasonSubject === 'string' && n.reasonSubject !== '' ? n.reasonSubject : undefined
}

/**
 * One notification → a Caribou `Notification`, or null when it is skipped.
 * `author` is the mapped author; `post` the mapped post it shows, or null
 * when `getPosts` did not return it (then a post reason is skipped).
 */
export function mapNotification(n: NotificationView, author: Account, post: Status | null): Notification | null {
  const type = notificationType(n.reason)
  const uri = notificationPostUri(n)
  if (!type || uri === undefined || !validTime(n.indexedAt)) return null
  if (uri !== null && !post) return null
  const base = {
    id: n.uri,
    createdAt: n.indexedAt,
    account: author,
    groupKey: n.uri,
    bluesky: {
      uri: n.uri,
      reason: n.reason,
      reasonSubject: typeof n.reasonSubject === 'string' ? n.reasonSubject : null,
      indexedAt: n.indexedAt,
      isRead: n.isRead === true,
    },
  }
  if (type === 'follow') return { ...base, type: 'follow' }
  return { ...base, type: type as 'favourite' | 'reblog' | 'mention', status: post! }
}
