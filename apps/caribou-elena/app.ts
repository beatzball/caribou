// Design tokens are inlined server-side via `server/lib/tokens-head.ts`
// so `var(--bg-0)` et al. resolve on first paint (Vite otherwise extracts
// a tokens.css import into a stylesheet the SSR shell never links to).

// Elena adapter router outlet + link custom elements.
import '@beatzball/litro/adapter/elena/runtime'

import { loadFromStorage, removeActiveUser } from '@beatzball/caribou-state'
import { routes } from './routes.generated.js'

// Hydrate session from localStorage before any component reads it.
if (typeof window !== 'undefined') {
  loadFromStorage()
  // Global 401 interceptor: if any mastodon-client call hits 401, the client
  // calls session.onUnauthorized(). Our session source (see `session-source.ts`
  // wiring in createTimelineStore's clientSource) calls removeActiveUser and
  // navigates to /?error=unauthorized.
  //
  // Litro's router keeps the SSR-rendered <page-feed> alongside a
  // freshly-created client <page-feed> during the brief initial-mount
  // swap window — both elements run Elena's lifecycle, so if the first
  // fetch hits 401, both timelines can fire `caribou:unauthorized`
  // back-to-back. Calling `location.replace` from the second listener
  // interrupts the navigation started by the first, which Chromium
  // reports as `net::ERR_ABORTED` (and Playwright's `waitForURL`
  // surfaces as a test failure). Guard with a one-shot flag so only
  // the first unauthorized event triggers the redirect.
  let unauthorizedHandled = false
  window.addEventListener('caribou:unauthorized', () => {
    if (unauthorizedHandled) return
    unauthorizedHandled = true
    removeActiveUser()
    // Signal the error via sessionStorage instead of `?error=` on the
    // replace target. Firefox + webkit race the query param between
    // `location.replace` and navigation commit (firefox sometimes drops
    // it entirely; webkit observes the banner's post-load URL cleanup).
    // sessionStorage survives the same-tab navigation atomically and is
    // browser-agnostic.
    try { sessionStorage.setItem('caribou.error', 'unauthorized') } catch { /* ignore */ }
    location.replace('/')
  })
}

const outlet = document.querySelector('litro-outlet') as (Element & { routes: unknown }) | null
if (outlet) {
  outlet.routes = routes
} else {
  console.warn('[litro] <litro-outlet> not found — router will not start.')
}
