// The app itself. `app.ts` loads this file, after it has installed Lit's
// hydration support; see there for why the two are separate files.
//
// Design tokens are inlined server-side via `server/lib/tokens-head.ts`
// so `var(--bg-0)` et al. resolve on first paint (Vite otherwise extracts
// a tokens.css import into a stylesheet the SSR shell never links to).

// Client runtime: router outlet and link custom elements.
import '@beatzball/litro/runtime/LitroOutlet.js'
import '@beatzball/litro/runtime/LitroLink.js'

import {
  activeUserKey, loadActiveAccount, loadFromStorage, startUnreadNotifications,
} from '@beatzball/caribou-state'
import { installUnauthorizedHandler } from './components/_unauthorized.js'
import {
  healInstanceCookie, installRestoreHandler, land, readShellInfo,
} from './components/_switch-account.js'
import { installPreloadErrorReload, withStaleBuildReload } from './components/_stale-build.js'
import './components/caribou-update-notice.js'
import { routes } from './routes.generated.js'

// Hydrate session from localStorage before any component reads it.
if (typeof window !== 'undefined') {
  loadFromStorage()
  // A session from sign-in has no account yet. Load it in the background,
  // now and whenever the active user changes.
  activeUserKey.subscribe(() => { void loadActiveAccount() })
  // A client that gets a 401 fires `caribou:unauthorized` with its session.
  // Land as the next stored account, or on `/` when none is left.
  installUnauthorizedHandler(window, (req) => { void land(req) })
  // A page restored from the back-forward cache forgets its landing and
  // reads the accounts again.
  installRestoreHandler(window)
  // A stale instance cookie (it names another server than the active
  // account's) is pointed at the active account's server, once.
  void healInstanceCookie(readShellInfo(document))
  // A tab open across a deploy asks for chunks the new build no longer has.
  installPreloadErrorReload(window)
  // The nav rail's unread badge. One poll for the app, not one per rail:
  // every page has its own, and a page swap mounts two.
  startUnreadNotifications()
  // One "Updating…" live region for the whole tab, outside every page.
  document.body.append(document.createElement('caribou-update-notice'))
}

const outlet = document.querySelector('litro-outlet') as (Element & { routes: unknown }) | null
if (outlet) {
  outlet.routes = withStaleBuildReload(routes)
} else {
  console.warn('[litro] <litro-outlet> not found — router will not start.')
}
