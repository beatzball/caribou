export type UserKey = `${string}@${string}`

export function toUserKey(handle: string, server: string): UserKey {
  return `${handle}@${server}` as UserKey
}

export function isUserKey(value: unknown): value is UserKey {
  if (typeof value !== 'string') return false
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [handle, server] = parts
  return !!handle && !!server
}

export function parseUserKey(value: UserKey): { handle: string; server: string } {
  if (!isUserKey(value)) throw new Error(`invalid UserKey: ${String(value)}`)
  const [handle, server] = value.split('@') as [string, string]
  return { handle, server }
}
