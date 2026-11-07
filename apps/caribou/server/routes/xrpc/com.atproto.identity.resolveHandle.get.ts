import { defineEventHandler, getHeader, getQuery, setResponseHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { getHandleResolver, getRequestLimits, normalizeHandle } from '../../lib/handle-resolver.js'

// The rules are in apps/caribou/README.md, "Bluesky sign-in endpoints".

function fail(event: H3Event, status: number, error: string, message: string) {
  setResponseStatus(event, status)
  setResponseHeader(event, 'cache-control', 'no-store')
  return { error, message }
}

/** The last X-Forwarded-For entry (added by the proxy in front of us), else the socket address. */
function clientIp(event: H3Event): string {
  const xff = getHeader(event, 'x-forwarded-for')
  const last = xff?.split(',').map((s) => s.trim()).filter(Boolean).pop()
  return last ?? event.node.req.socket.remoteAddress ?? 'unknown'
}

export default defineEventHandler(async (event) => {
  const handle = normalizeHandle(getQuery(event).handle)
  if (!handle) return fail(event, 400, 'InvalidRequest', 'Invalid handle')

  const limits = getRequestLimits()
  if (!limits.allow(clientIp(event))) return fail(event, 429, 'RateLimitExceeded', 'Too many requests')
  const release = limits.acquire()
  if (!release) return fail(event, 503, 'ServiceUnavailable', 'Too many lookups at once')

  let did: string | null
  try {
    did = await getHandleResolver().resolve(handle)
  } catch {
    did = null
  } finally {
    release()
  }
  if (!did) return fail(event, 400, 'InvalidRequest', 'Unable to resolve handle')
  setResponseHeader(event, 'cache-control', 'public, max-age=60')
  return { did }
})
