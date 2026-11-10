// The one place the app loads the Bluesky libraries (spec 12.2).
//
// Bluesky is on for everyone (#169). The libraries load only when a Bluesky
// account restores or a reader starts a Bluesky sign-in, so a Mastodon page
// never requests the `bsky` chunk (`tests/e2e/bluesky-chunk.spec.ts`).
//
// Load the libraries only through `loadBluesky()`. A static import of
// `@beatzball/caribou-bluesky-client/browser` (or of `/moderation`) would put
// them on every page.

import type * as BlueskyBrowserModule from '@beatzball/caribou-bluesky-client/browser'
import type * as BlueskyModerationNs from '@beatzball/caribou-bluesky-client/moderation'

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

export type BlueskyModerationModule = typeof BlueskyModerationNs

/** Moderation (the reader veil's check), from the same lazy chunk. */
export function loadBlueskyModeration(): Promise<BlueskyModerationModule> {
  return import('@beatzball/caribou-bluesky-client/moderation')
}
