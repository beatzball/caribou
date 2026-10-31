import type { H3Event } from 'h3'
import { isRegisteredInstance, setInstance, type InstanceDeps } from './instance-cookie.js'
import { isSameOrigin } from './same-origin.js'

export type SetInstanceResult =
  | { ok: true }
  | { ok: false; status: 400 | 403; message: string }

/**
 * Points the `caribou.instance` cookie at `body.server`. The app calls this
 * after it switches the active account, so SSR of /local, /public and
 * profiles uses the new account's server. Only a server with a registered
 * app is accepted, as `getInstance` would accept on the next read.
 */
export async function handleSetInstance(
  event: H3Event, body: unknown, deps: InstanceDeps,
): Promise<SetInstanceResult> {
  if (!isSameOrigin(event)) return { ok: false, status: 403, message: 'cross-site request' }
  const server = (body as { server?: unknown } | null)?.server
  if (typeof server !== 'string') return { ok: false, status: 400, message: 'server is required' }
  const hostname = server.trim()
  if (!await isRegisteredInstance(hostname, deps)) {
    return { ok: false, status: 400, message: 'unknown server' }
  }
  setInstance(event, hostname)
  return { ok: true }
}
