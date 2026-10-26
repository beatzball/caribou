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

// How many tried (build, URL) pairs to remember. Only the latest matter: a
// loop repeats one pair, which then is always among them.
const MAX_TRIED = 20

// Set once a load has started. Both handlers can see the same failure (the
// preload helper fires its event, then rethrows into the route action), and
// only the first one may act.
let reloading = false

export interface StaleBuildEnv {
  assign: (href: string) => void
  /** The build this document runs, from the entry's `?v=`. */
  version: () => string
  online: () => boolean
}

const browserEnv: StaleBuildEnv = {
  assign: (href) => location.assign(href),
  version: documentBuildVersion,
  online: () => navigator.onLine !== false,
}

/**
 * The `?v=` of the entry script this page loaded (see
 * `server/lib/app-entry.ts`), or `''` where the entry has none (dev).
 */
export function documentBuildVersion(): string {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/_litro/app.js"]')
  if (!entry) return ''
  return new URL(entry.src, location.href).searchParams.get('v') ?? ''
}

/**
 * Whether `err` says a module could not be fetched, rather than that one
 * loaded and threw. Each engine words it its own way, always as a TypeError:
 * Chromium "Failed to fetch dynamically imported module", Firefox "error
 * loading dynamically imported module", WebKit "Importing a module script
 * failed". `tests/e2e/stale-build.spec.ts` checks all three against a real 404.
 */
export function isModuleLoadError(err: unknown): boolean {
  return err instanceof TypeError
    && /dynamically imported module|importing a module script failed/i.test(err.message)
}

/**
 * Loads `href` from the server, once for each pair of (the build this page
 * runs, `href`). The full load runs the build the server has now, so it has
 * a different version: if the chunk is missing there too, that pair is tried
 * once more and then never again, however long each load takes. A later
 * deploy is a new version and may try again. Returns whether a load is under
 * way.
 */
export function reloadOnce(href: string, env: StaleBuildEnv = browserEnv): boolean {
  if (reloading) return true
  // Offline, the full load would only swap the page for the browser's error
  // page. Leave the reader where they are.
  if (!env.online()) return false
  const pair = `${env.version()} ${href}`
  try {
    const tried: string[] = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
    if (tried.includes(pair)) return false
    sessionStorage.setItem(KEY, JSON.stringify([...tried, pair].slice(-MAX_TRIED)))
  } catch {
    // Without sessionStorage there is no guard against a loop, so do not load.
    return false
  }
  reloading = true
  env.assign(href)
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
 * `location.href` is the page the reader asked for. A module that loaded and
 * threw is a bug in this build, not a stale tab, so its error goes on to the
 * router as before.
 */
export function withStaleBuildReload<R extends RouteWithAction>(routes: R[], env?: StaleBuildEnv): R[] {
  return routes.map((route) => {
    const action = route.action
    if (!action) return route
    return {
      ...route,
      action: async () => {
        try {
          await action()
        } catch (err) {
          if (!isModuleLoadError(err)) throw err
          // The unload drops the console in some browsers; say why first.
          console.error('[caribou] a page chunk failed to load; loading the page from the server', err)
          // The page is going away. Keep the router waiting rather than let
          // it mount an element whose class never loaded.
          if (reloadOnce(location.href, env)) return new Promise<never>(() => {})
          throw err
        }
      },
    }
  })
}

/** Reloads on Vite's `vite:preloadError` when a module failed to load. */
export function installPreloadErrorReload(target: EventTarget, env?: StaleBuildEnv): void {
  target.addEventListener('vite:preloadError', (event) => {
    const err = (event as Event & { payload?: unknown }).payload
    if (!isModuleLoadError(err)) return
    console.error('[caribou] a chunk failed to load; loading the page from the server', err)
    reloadOnce(location.href, env)
  })
}
