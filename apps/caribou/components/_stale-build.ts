/**
 * Recovers a tab that stayed open across a deploy.
 *
 * The page's code names its chunks by hash, and a new image has only its own
 * hashes. So the first navigation to a page whose chunk this tab has not
 * loaded yet asks for a file that is gone: the import rejects, the router
 * stops, and the tap does nothing. The server HTML is always current, so a
 * full load of the same URL brings the tab onto the new build.
 *
 * Two places see the failure: Vite's `vite:preloadError` event, for any
 * dynamic import, and the route action, which the router awaits and never
 * catches. Both call `reloadOnce`.
 */

const KEY = 'caribou.stale-reload'

// A load brings the tab onto the build the server has now, so a second
// failure soon after means that build is broken too, and loading again would
// loop. A deploy after this window can recover the tab again.
const GUARD_MS = 30_000

// Set once a load has started. Both handlers can see the same failure (the
// preload helper fires its event, then rethrows into the route action), and
// only the first one may act.
let reloading = false

/**
 * Loads `href` from the server, unless this tab already did that for a failed
 * import in the last `GUARD_MS`. Returns whether a load is under way.
 */
export function reloadOnce(
  href: string,
  assign: (href: string) => void = (h) => location.assign(h),
  now: number = Date.now(),
): boolean {
  if (reloading) return true
  try {
    const last = Number(sessionStorage.getItem(KEY))
    if (last && now - last >= 0 && now - last < GUARD_MS) return false
    sessionStorage.setItem(KEY, String(now))
  } catch {
    // Without sessionStorage there is no guard against a loop, so do not load.
    return false
  }
  reloading = true
  assign(href)
  return true
}

/** For tests: forget that a load has started. */
export function resetStaleBuildReload(): void {
  reloading = false
}

interface RouteWithAction {
  action?: () => Promise<void> | void
}

/**
 * Wraps each route's action so a failed import loads the target URL from the
 * server. The router has already pushed the new URL when the action runs, so
 * `location.href` is the page the reader asked for.
 */
export function withStaleBuildReload<R extends RouteWithAction>(
  routes: R[],
  assign?: (href: string) => void,
): R[] {
  return routes.map((route) => {
    const action = route.action
    if (!action) return route
    return {
      ...route,
      action: async () => {
        try {
          await action()
        } catch (err) {
          // The page is going away. Keep the router waiting rather than let
          // it mount an element whose class never loaded.
          if (reloadOnce(location.href, assign)) return new Promise<never>(() => {})
          throw err
        }
      },
    }
  })
}

/** Reloads on Vite's `vite:preloadError`, once per URL. */
export function installPreloadErrorReload(target: EventTarget, assign?: (href: string) => void): void {
  target.addEventListener('vite:preloadError', () => { reloadOnce(location.href, assign) })
}
