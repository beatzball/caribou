import type { Status, Account } from '@beatzball/caribou-mastodon-client'

export interface ShellInfo {
  instance: string | null
  /**
   * Where `instance` came from: the instance cookie, or the page's path
   * (`/@name@host`). Absent when there is none. The client uses it to heal a
   * cookie that names another server than the active account's.
   */
  source?: 'cookie' | 'path'
}

export type AuthRequired = { kind: 'auth-required' }
export type Failed       = { kind: 'error'; message: string }

export type TimelinePageData =
  | AuthRequired
  | Failed
  | {
      kind: 'ok'
      statuses: Status[]
      nextMaxId: string | null
    }

export type ProfilePageData =
  | AuthRequired
  | Failed
  | {
      kind: 'ok'
      account: Account
      statuses: Status[]
      nextMaxId: string | null
      tab: 'posts' | 'replies' | 'media'
    }

export type ThreadPageData =
  | AuthRequired
  | Failed
  | {
      kind: 'ok'
      focused: Status
      ancestors: Status[]
      descendants: Status[]
    }

export type AuthRequiredOnlyPageData = AuthRequired
export type StubPageData = Record<string, never>

export type WithShell<T> = T & { shell: ShellInfo }
