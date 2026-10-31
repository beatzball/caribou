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
  // Hostnames are not case-sensitive, but storage keys are on Linux. Sign-in
  // now saves the lower-case name; a session from before that may still
  // carry the name as typed, so that spelling is tried second.
  const given = server.trim()
  const lower = given.toLowerCase()
  let hostname: string | null = null
  if (await isRegisteredInstance(lower, deps)) hostname = lower
  else if (given !== lower && await isRegisteredInstance(given, deps)) hostname = given
  if (!hostname) return { ok: false, status: 400, message: 'unknown server' }
  setInstance(event, hostname)
  return { ok: true }
}
