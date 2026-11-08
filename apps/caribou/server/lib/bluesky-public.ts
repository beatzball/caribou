// Bluesky pages the server paints with no token (spec 8; app README,
// "Bluesky SSR"). Server only: it imports the atproto SDK (through the
// package's `./moderation` and `./syntax` doors), so a page loads it with a
// dynamic `import()` inside `pageData`, never statically.
//
// Every fetch goes through `xrpc()`, to `BLUESKY_PUBLIC_APPVIEW` only, with
// a fixed TTL per call and the 429 back-off (#187).

import { NO_UNAUTHENTICATED_NOTE } from '@beatzball/caribou-bluesky-client'
import {
  signedOutLabelDefs, signedOutProfilePage, signedOutThread,
  type LabelDefs, type SignedOutCall, type SignedOutProfile, type SignedOutSource, type SignedOutTab, type SignedOutThread,
} from '@beatzball/caribou-bluesky-client/moderation'
import { isValidDid, isValidHandle, isValidRecordKey } from '@beatzball/caribou-bluesky-client/syntax'
import { cachedFetch, TTL, UpstreamError } from './upstream-cache.js'
import { sanitizeAccount, sanitizeStatus } from './sanitize.js'

// The guard and the mapping live in the package (`signed-out.ts`): one copy
// for the server and the browser's fallback. Re-exported for the pages and
// the tests.
export {
  asksHidden, guardActor, guardFeedEntry, guardThreadNode, hiddenAccount, signedOutStatus,
} from '@beatzball/caribou-bluesky-client/moderation'

export { NO_UNAUTHENTICATED_NOTE }

export const DEFAULT_PUBLIC_APPVIEW = 'https://public.api.bsky.app'

export { blueskySsrEnabled } from './bluesky-flag.js'

/** The AppView origin: `BLUESKY_PUBLIC_APPVIEW` when it is an http(s) URL, else the default. */
export function publicAppView(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.BLUESKY_PUBLIC_APPVIEW?.trim()
  if (raw) {
    try {
      const u = new URL(raw)
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin
    } catch { /* fall back */ }
  }
  return DEFAULT_PUBLIC_APPVIEW
}

/** True when `actor` is a well-formed DID or handle. Checked before any fetch. */
export function validActor(actor: string): boolean {
  return actor.startsWith('did:') ? isValidDid(actor) : isValidHandle(actor)
}

/** True when `rkey` is a well-formed record key. */
export function validRecordKey(rkey: string): boolean {
  return isValidRecordKey(rkey)
}

// ---------------------------------------------------------------- #187

/** The cache TTL of each AppView call (spec 8.1). */
export const BLUESKY_TTL: Record<SignedOutCall, number> = {
  profile: TTL.BLUESKY_PROFILE,
  authorFeed: TTL.BLUESKY_AUTHOR_FEED,
  thread: TTL.BLUESKY_THREAD,
  labelDefs: TTL.BLUESKY_LABEL_DEFS,
}

/** The back-off when `Retry-After` is missing or cannot be read, in seconds. */
export const BACKOFF_DEFAULT_S = 30
/** The longest back-off, in seconds, whatever `Retry-After` says. */
export const BACKOFF_MAX_S = 60

/**
 * Seconds to wait from a `Retry-After` header: whole seconds, or an HTTP
 * date. Missing or unreadable is the default; the result is at least 1 and
 * at most the cap.
 */
export function retryAfterSeconds(header: string | null, now: number = Date.now()): number {
  const raw = header?.trim() ?? ''
  let s: number
  if (/^\d+$/.test(raw)) s = Number(raw)
  // An HTTP date always names a day or month in letters; `-5` is not one.
  else if (/[a-z]/i.test(raw) && !Number.isNaN(Date.parse(raw))) s = Math.ceil((Date.parse(raw) - now) / 1000)
  else s = BACKOFF_DEFAULT_S
  return Math.min(BACKOFF_MAX_S, Math.max(1, s))
}

/**
 * The AppView rate limited this server: the page renders the shell and the
 * browser reads the AppView itself (README, "Bluesky SSR: rate limits").
 */
export class BlueskyRateLimited extends Error {
  constructor(readonly until: number) {
    super('bluesky: rate limited')
    this.name = 'BlueskyRateLimited'
  }
}

export function isRateLimited(err: unknown): err is BlueskyRateLimited {
  return err instanceof BlueskyRateLimited
}

// Until when no SSR fetch goes out (ms since the epoch); 0 when none.
let backoffUntil = 0

/** Tests only. */
export function _testOnlyResetBackoff(): void {
  backoffUntil = 0
}

// The one place the server asks the AppView.
async function xrpc<T>(method: string, params: Record<string, string | undefined>, call: SignedOutCall): Promise<T> {
  if (Date.now() < backoffUntil) throw new BlueskyRateLimited(backoffUntil)
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v)
  try {
    // `redirect: 'error'`: a 3xx from the AppView never sends the server to another host.
    return await cachedFetch<T>(`${publicAppView()}/xrpc/${method}?${q}`, BLUESKY_TTL[call], { redirect: 'error' })
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 429) {
      backoffUntil = Math.max(backoffUntil, Date.now() + retryAfterSeconds(err.retryAfter) * 1000)
      throw new BlueskyRateLimited(backoffUntil)
    }
    throw err
  }
}

const SOURCE: SignedOutSource = {
  xrpc,
  clean: { status: sanitizeStatus, account: sanitizeAccount },
}

/** Bluesky's label definitions; `null` when they cannot load (fail closed). */
export function fetchLabelDefs(): Promise<LabelDefs | null> {
  return signedOutLabelDefs(SOURCE)
}

export type BlueskyTab = SignedOutTab
export type BlueskyProfileResult = SignedOutProfile
export type BlueskyThread = SignedOutThread

/** A profile and its first page (or the page at `cursor`), signed out. */
export function fetchBlueskyProfilePage(
  actor: string, opts: { tab: BlueskyTab; cursor?: string | undefined },
): Promise<BlueskyProfileResult> {
  return signedOutProfilePage(SOURCE, actor, opts)
}

/** A post and its thread, signed out. Throws when the post is not there. */
export function fetchBlueskyThread(actor: string, rkey: string): Promise<BlueskyThread> {
  return signedOutThread(SOURCE, actor, rkey)
}
