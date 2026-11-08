// The browser's fallback for a Bluesky page the server could not fill
// because the public AppView rate limited it (#187; README, "Bluesky SSR:
// rate limits"). The page then reads the same data from the same AppView
// itself, signed out, through the same guard and mapping as the server
// (`signedOutProfilePage` / `signedOutThread` in the package). The SDK
// comes in the lazy `bsky` chunk, through `loadBlueskyModeration()`, and
// only on a Bluesky page that needs it.

import DOMPurify from 'dompurify'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import type { SignedOutProfile, SignedOutSource, SignedOutTab, SignedOutThread } from '@beatzball/caribou-bluesky-client/moderation'
import { loadBlueskyModeration } from './_bluesky.js'
import { sanitizeAccountWith, sanitizeStatusWith } from './_sanitize-shape.js'

if (typeof window !== 'undefined') installPurifyHooks(DOMPurify)

const sanitize = (html: string): string => DOMPurify.sanitize(html, PURIFY_OPTS) as unknown as string

/**
 * A source that reads `appview` (an origin the server named) from the
 * browser: no redirects, nothing cached. Any non-2xx answer throws.
 */
export function browserSource(appview: string, fetchFn: typeof fetch = fetch): SignedOutSource {
  return {
    async xrpc<T>(method: string, params: Record<string, string | undefined>): Promise<T> {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v)
      const res = await fetchFn(`${appview}/xrpc/${method}?${q}`, { redirect: 'error', headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`bluesky ${res.status}`)
      return (await res.json()) as T
    },
    clean: {
      status: (s: Status) => sanitizeStatusWith(s, sanitize),
      account: (a: Account) => sanitizeAccountWith(a, sanitize),
    },
  }
}

/** A profile page, signed out, read by the browser. */
export async function publicProfilePage(
  appview: string, actor: string, opts: { tab: SignedOutTab; cursor?: string | undefined },
): Promise<SignedOutProfile> {
  const m = await loadBlueskyModeration()
  return m.signedOutProfilePage(browserSource(appview), actor, opts)
}

/** A thread, signed out, read by the browser. */
export async function publicThread(appview: string, actor: string, rkey: string): Promise<SignedOutThread> {
  const m = await loadBlueskyModeration()
  return m.signedOutThread(browserSource(appview), actor, rkey)
}
