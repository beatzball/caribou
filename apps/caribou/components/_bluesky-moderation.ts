// What a Bluesky card reads from a post's moderation (spec 7.4; rules in
// the app README, "Bluesky views"). Plain functions over plain data: no
// runtime import of the atproto libraries. The reader veil's check lives in
// `./moderation`, an SDK door, so it is loaded lazily through `_bluesky.ts`.

import { signal } from '@preact/signals-core'
import type {
  BlueskyModerationReason, BlueskyModerationResult, BlueskyModerationUi, CaribouClient, StatusBluesky,
} from '@beatzball/caribou-mastodon-client'
import type { BlueskyReader } from '@beatzball/caribou-bluesky-client/moderation'
import { loadBlueskyModeration } from './_bluesky.js'

/**
 * The reason names of a fail-closed cover. The same strings as
 * `LABELER_UNAVAILABLE`, `UNKNOWN_LABEL` and `MODERATION_FAILED` in
 * `./moderation` (a test keeps them equal); a static import of that module
 * would put the libraries on every page.
 */
const FAIL_CLOSED = new Set([
  'Content warning (labeler unavailable)',
  'Content warning (unknown label)',
  'Content warning (moderation failed)',
])

/** True when a reason is a fail-closed cover: the card offers Retry for it. */
export function isFailClosed(reason: BlueskyModerationReason): boolean {
  return FAIL_CLOSED.has(reason.name)
}

/** The surface a card is: the focused post of a thread, or a list row. */
export function surfaceOf(focused: boolean): 'contentView' | 'contentList' {
  return focused ? 'contentView' : 'contentList'
}

/** The names to show on a cover, once each, in the order given. */
export function reasonNames(ui: BlueskyModerationUi): string {
  return [...new Set(ui.reasons.map((r) => r.name || r.label))].join(', ')
}

/**
 * A cover's text: "Content warning: Spoiler, Scam". A fail-closed name
 * already says "Content warning (…)", so it stands alone.
 */
export function coverNote(ui: BlueskyModerationUi): string {
  const names = reasonNames(ui)
  if (!names) return 'Content warning'
  return ui.reasons.every(isFailClosed) ? names : `Content warning: ${names}`
}

/**
 * Sent on a Retry of a Bluesky cover, with `{ id }`: the session glue (#182)
 * loads the reader's label definitions again.
 */
export const BLUESKY_RETRY_EVENT = 'caribou:bluesky-moderation-retry'

// A result with a context missing is not one Caribou can trust: covered,
// no Show, with Retry (fail closed, as `moderate()` does when the SDK throws).
export const UNREADABLE: BlueskyModerationUi = Object.freeze({
  filter: false, blur: true, alert: false, inform: false, noOverride: true,
  reasons: [{ label: '', source: '', name: 'Content warning (moderation failed)' }],
})

/**
 * One context of a result. No result is no moderation (a Mastodon post); a
 * result without the context fails closed.
 */
export function uiOf(mod: BlueskyModerationResult | null | undefined, context: keyof BlueskyModerationResult['contexts']): BlueskyModerationUi | null {
  if (!mod) return null
  const ui = Object.hasOwn(mod.contexts ?? {}, context) ? mod.contexts[context] : undefined
  return ui ?? UNREADABLE
}

// The reader the veil checks against: prefs and label definitions. The one
// signal for it. The session glue (`_bluesky-session.ts`) sets it when the
// active Bluesky client restores and after a Retry reloads the definitions.
export const blueskyReader = signal<BlueskyReader | null>(null)
// `blueskyCheckSettled`, once `./moderation` has loaded.
const check = signal<((post: Pick<StatusBluesky, 'viewerOf' | 'moderation'>, r: BlueskyReader | null) => boolean) | null>(null)
let loading: Promise<void> | null = null

/** The session glue sets the active Bluesky reader here (null: none loaded). */
export function setBlueskyReader(next: BlueskyReader | null): void {
  blueskyReader.value = next
}

/**
 * The labelers in the active reader's prefs that are gone (#238; bluesky
 * README, "A gone labeler"), for `<caribou-gone-labelers>`. The session glue
 * sets it with the reader. Null: no Bluesky reader loaded.
 */
export const blueskyGoneLabelers = signal<{ userKey: string; dids: readonly string[] } | null>(null)

function ensureCheck(): void {
  if (check.peek() || loading) return
  loading = loadBlueskyModeration().then(
    (m) => { check.value = m.blueskyCheckSettled },
    // A failed load leaves the cards covered; the next card asks again.
    () => { loading = null },
  )
}

/**
 * Whether a Bluesky card may show its post (the reader veil, spec 7.4).
 * Reads signals, so an effect that calls it follows the reader and the
 * lazy load. Fails closed: with a Bluesky account active, the post stays
 * covered until the check has loaded and says it settled.
 */
export function blueskyVeilSettled(
  post: Pick<StatusBluesky, 'viewerOf' | 'moderation'>,
  client: Pick<CaribouClient, 'userKey' | 'capabilities'> | null,
): boolean {
  // No Bluesky account active: the logged-out default is final.
  if (!client || client.capabilities.network !== 'bluesky') return true
  const fn = check.value
  const r = blueskyReader.value
  if (!fn) {
    ensureCheck()
    return false
  }
  // A reader for another account is no reader for this one.
  if (!r || r.userKey !== client.userKey) return false
  return fn(post, r)
}

/** Tests only: forget the reader and the loaded check. */
export function _testOnlyResetBlueskyVeil(): void {
  blueskyReader.value = null
  blueskyGoneLabelers.value = null
  check.value = null
  loading = null
}

/** Tests only: wait for the lazy load of the check. */
export function _testOnlyVeilLoaded(): Promise<void> {
  return loading ?? Promise.resolve()
}

/**
 * The reader a Bluesky decision must be made for: the active Bluesky
 * account's user key, or null with no Bluesky account active (signed out,
 * or a Mastodon account). README, "A decision belongs to one reader".
 */
export function currentBlueskyReader(client: Pick<CaribouClient, 'userKey' | 'capabilities'> | null): string | null {
  return client?.capabilities.network === 'bluesky' ? client.userKey : null
}

/** The note that takes the place of an author who asked not to be seen signed out (spec 8.3). */
export const NO_UNAUTHENTICATED_NOTE = 'This account asked to be seen only by signed-in readers.'

/**
 * True when the account self-labels `!no-unauthenticated` (not negated).
 * The same rule as `isNoUnauthenticated` in the bluesky package (a test
 * keeps them equal), over the account's mapped labels.
 */
export function asksNoUnauthenticated(account: { bluesky?: { labels?: readonly { val: string; neg?: boolean }[] } | null }): boolean {
  return (account.bluesky?.labels ?? []).some((l) => l.val === '!no-unauthenticated' && !l.neg)
}

/** A copy's decision fits the current reader only when it was made for that reader. */
export function decisionFits(viewerOf: string | null | undefined, reader: string | null): boolean {
  return (viewerOf ?? null) === reader
}

/**
 * The full check for one surface's own newest decision (README, "Covers
 * compose"): the decision was made for the current reader, and the reader
 * veil is settled for it (every subscribed labeler covered). The card, the
 * quote and the profile header all ask this. Reads signals, so an effect
 * that calls it follows reader and subscription changes. A decision that is
 * missing is not judged here: the caller covers it as unreadable.
 *
 * It reads the same signals on every call, whatever its inputs, before any
 * early return: an effect that first ran with no decision, or with another
 * reader's, still hears a later prefs, definitions or check change.
 */
export function blueskyDecisionSettled(
  owned: { viewerOf?: string | null; moderation?: BlueskyModerationResult | null } | null | undefined,
  client: Pick<CaribouClient, 'userKey' | 'capabilities'> | null,
): boolean {
  // Subscribe first (see above). The values are read again below.
  void blueskyReader.value
  void check.value
  // Load the check as soon as a Bluesky reader is active, even when this
  // copy is not yet theirs: the reader's copy must not wait a turn for it.
  if (client?.capabilities.network === 'bluesky') ensureCheck()
  if (!owned) return true
  if (!decisionFits(owned.viewerOf, currentBlueskyReader(client))) return false
  if (!owned.moderation) return true
  return blueskyVeilSettled({
    viewerOf: (owned.viewerOf ?? null) as StatusBluesky['viewerOf'], moderation: owned.moderation,
  }, client)
}
