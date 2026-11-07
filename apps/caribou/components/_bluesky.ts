// The one place the app loads the Bluesky libraries (spec 12.2).
//
// Bluesky is behind a flag until phase 4. The flag is a localStorage key a
// developer sets by hand; no reader sees a control for it. With the flag
// off, nothing here runs and a Mastodon page never requests the `bsky`
// chunk (`tests/e2e/bluesky-chunk.spec.ts`).
//
// Load the libraries only through `loadBluesky()`. A static import of
// `@beatzball/caribou-bluesky-client/browser` (or of `/moderation`) would put
// them on every page.

import type * as BlueskyBrowserModule from '@beatzball/caribou-bluesky-client/browser'

export const BLUESKY_FLAG_KEY = 'caribou.flag.bluesky'

/**
 * True when the Bluesky flag is on. Blocked storage reads as off: with site
 * data blocked, even reading `window.localStorage` throws, so it happens
 * inside the `try`.
 */
export function blueskyEnabled(win: Pick<Window, 'localStorage'> | undefined): boolean {
  try {
    return win?.localStorage.getItem(BLUESKY_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

export type BlueskyBrowser = typeof BlueskyBrowserModule

/** The atproto libraries, from their lazy chunk. */
export function loadBluesky(): Promise<BlueskyBrowser> {
  return import('@beatzball/caribou-bluesky-client/browser')
}

/** The path the authorization server sends the reader back to (spec 5.5). */
export const BLUESKY_CALLBACK_PATH = '/signin/bluesky'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * The OAuth `client_id` and handle resolver for a page at `origin`. The one
 * place the client id is chosen: the loopback client on a loopback host
 * (local dev and tests), else the client metadata document the server
 * serves (#181).
 */
export function blueskyOAuthConfig(origin: string): { clientId: string; handleResolver: string } {
  const url = new URL(origin)
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    // The SDK wants the IP form in a loopback redirect URI.
    const redirect = `http://127.0.0.1${url.port ? `:${url.port}` : ''}${BLUESKY_CALLBACK_PATH}`
    const clientId = `http://localhost?redirect_uri=${encodeURIComponent(redirect)}`
      + `&scope=${encodeURIComponent('atproto transition:generic')}`
    return { clientId, handleResolver: url.origin }
  }
  return { clientId: `${url.origin}/oauth/client-metadata.json`, handleResolver: url.origin }
}
