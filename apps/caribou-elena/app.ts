import '@beatzball/caribou-design-tokens/tokens.css'

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
    location.replace('/?error=unauthorized')
  })
}

const outlet = document.querySelector('litro-outlet') as (Element & { routes: unknown }) | null
if (outlet) {
  outlet.routes = routes
} else {
  console.warn('[litro] <litro-outlet> not found — router will not start.')
}
