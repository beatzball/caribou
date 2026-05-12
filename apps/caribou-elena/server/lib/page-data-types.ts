import type { Status, Account } from '@beatzball/caribou-mastodon-client'

export interface ShellInfo {
  instance: string | null
}

export type AuthRequired = { kind: 'auth-required'; serverNowMs: number }
export type Failed       = { kind: 'error'; message: string; serverNowMs: number }

export type TimelinePageData =
  | AuthRequired
  | Failed
  | {
      kind: 'ok'
      statuses: Status[]
      nextMaxId: string | null
      serverNowMs: number
      populatedListHtml: string
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
      serverNowMs: number
      populatedListHtml: string
    }

export type ThreadPageData =
  | AuthRequired
  | Failed
  | {
      kind: 'ok'
      focused: Status
      ancestors: Status[]
      descendants: Status[]
      serverNowMs: number
      populatedListHtml: string
    }

export type AuthRequiredOnlyPageData = AuthRequired
export type StubPageData = Record<string, never>

export type WithShell<T> = T & { shell: ShellInfo }
