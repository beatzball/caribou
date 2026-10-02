import { getCookie, setCookie } from 'h3'
import type { H3Event } from 'h3'

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i

export interface InstanceDeps {
  storage: { getKeys(prefix?: string): Promise<string[]> }
}

export async function getInstance(event: H3Event, deps: InstanceDeps): Promise<string | undefined> {
  const raw = getCookie(event, 'caribou.instance')
  if (!raw) return undefined
  if (!HOSTNAME_PATTERN.test(raw)) return undefined
  const keys = await deps.storage.getKeys(`apps:${raw}:`)
  return keys.length > 0 ? raw : undefined
}

export function setInstance(event: H3Event, hostname: string): void {
  setCookie(event, 'caribou.instance', hostname, {
    secure: true, httpOnly: true, sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, path: '/',
  })
}

export function clearInstance(event: H3Event): void {
  setCookie(event, 'caribou.instance', '', { maxAge: 0, path: '/' })
}
