import { isUserKey, type UserKey } from './user-key.js'

export interface CallbackFragment {
  token: string
  server: string
  userKey: UserKey
  vapidKey: string
}

export function parseCallbackFragment(fragment: string): CallbackFragment | null {
  if (!fragment) return null
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const token = params.get('token')
  const server = params.get('server')
  const userKey = params.get('userKey')
  const vapidKey = params.get('vapidKey') ?? ''
  if (!token || !server || !userKey) return null
  if (!isUserKey(userKey)) return null
  return { token, server, userKey, vapidKey }
}
