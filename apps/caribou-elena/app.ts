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
  window.addEventListener('caribou:unauthorized', () => {
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
