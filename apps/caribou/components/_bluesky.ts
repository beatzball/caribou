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
import type * as BlueskyModerationNs from '@beatzball/caribou-bluesky-client/moderation'

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

export type BlueskyModerationModule = typeof BlueskyModerationNs

/** Moderation (the reader veil's check), from the same lazy chunk. */
export function loadBlueskyModeration(): Promise<BlueskyModerationModule> {
  return import('@beatzball/caribou-bluesky-client/moderation')
}
