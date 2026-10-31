import { getCookie, setCookie } from 'h3'
import type { H3Event } from 'h3'

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i

export interface InstanceDeps {
  storage: { getKeys(prefix?: string): Promise<string[]> }
}

export async function getInstance(event: H3Event, deps: InstanceDeps): Promise<string | undefined> {
  const raw = getCookie(event, 'caribou.instance')
  if (!raw) return undefined
  return await isRegisteredInstance(raw, deps) ? raw : undefined
}

/**
 * Whether `hostname` is a server this deployment has an app registered with.
 * The format check runs first so a bad value never reaches storage. Only such
 * a server may be named by the cookie, because SSR fetches from it.
 */
export async function isRegisteredInstance(hostname: string, deps: InstanceDeps): Promise<boolean> {
  if (!HOSTNAME_PATTERN.test(hostname)) return false
  const keys = await deps.storage.getKeys(`apps:${hostname}:`)
  return keys.length > 0
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
