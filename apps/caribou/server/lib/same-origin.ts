import { getHeader, getRequestURL } from 'h3'
import type { H3Event } from 'h3'
import { resolveOrigin } from './public-origin.js'

/**
 * Whether a state-changing request came from a page of this site. A browser
 * sends `Sec-Fetch-Site` on every request; when it is there it decides. An
 * older browser sends only `Origin` on a POST, so that must match this site.
 * A request with neither header is refused: every browser that runs Caribou
 * sends one of them on a `fetch` POST.
 */
export function isSameOrigin(event: H3Event): boolean {
  const site = getHeader(event, 'sec-fetch-site')
  if (site) return site === 'same-origin'
  const origin = getHeader(event, 'origin')
  if (!origin) return false
  if (origin === resolveOrigin(event)) return true
  const url = getRequestURL(event)
  return origin === `${url.protocol}//${url.host}`
}
