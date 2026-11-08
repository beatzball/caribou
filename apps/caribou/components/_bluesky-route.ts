// Which routes name a Bluesky account (spec 8.4), for the client-rendered
// Bluesky views of phase 2b (README, "Bluesky views"). SSR of these routes
// is phase 3; until then the page swaps in a client render after hydration.

import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { blueskyEnabled } from './_bluesky.js'

/**
 * The Bluesky actor a `/@<handle>` segment names, or null for a Mastodon
 * one. Rules in order: a second `@` is Mastodon; `did:` is Bluesky; a dot
 * is a Bluesky handle; no dot is a local Mastodon name.
 */
export function blueskyActor(segment: string): string | null {
  const name = segment.replace(/^@/, '')
  if (!name || name.includes('@')) return null
  if (name.startsWith('did:')) return name
  return name.includes('.') ? name : null
}

/** The AT URI of the post `/@<actor>/<rkey>` names. The AppView resolves a handle in it. */
export function blueskyPostUri(actor: string, rkey: string): string {
  return `at://${actor}/app.bsky.feed.post/${rkey}`
}

/** The DID in a Bluesky user key (`<did>@bsky`). */
export function didOfUserKey(userKey: string): string {
  return userKey.slice(0, userKey.lastIndexOf('@'))
}

/**
 * True when this browser renders Bluesky views itself: the flag is on and
 * the active account is a Bluesky one. Reader state: read it after the
 * first render, never in it.
 */
export function rendersBluesky(win: Pick<Window, 'localStorage'> | undefined, client: Pick<CaribouClient, 'capabilities'> | null): boolean {
  return blueskyEnabled(win) && client?.capabilities.network === 'bluesky'
}
