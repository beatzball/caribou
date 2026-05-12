/**
 * Single source of truth for "now" on the server side. Captured once
 * per request via pageData() so SSR'd timestamps inside a single
 * response are mutually consistent and so tests can stub the value
 * by spying on this module.
 */
export function getServerNowMs(): number {
  return Date.now()
}
