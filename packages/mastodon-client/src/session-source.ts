import type { UserKey } from '@beatzball/caribou-auth'

export interface SessionData {
  userKey: UserKey
  server: string
  token: string
}

export interface SessionSource {
  get(): SessionData | null
  onUnauthorized(): void
}
