import type { UserKey } from '@beatzball/caribou-auth'
import type {
  BlueskyBlobRef, BlueskyPostRecord, BlueskyStrongRef, CaribouClient, MediaAttachmentType, Status, StatusVisibility,
} from '@beatzball/caribou-mastodon-client'
import { cacheStatus } from './caches.js'

export interface DraftMedia {
  id: string
  type: MediaAttachmentType
  url: string
  previewUrl: string | null
  description: string
  // The name of the file the user picked. Drafts stored before this field
  // existed have none.
  name?: string
}

/**
 * A poll being written. Options keep the reader's blanks while they type;
 * only the filled ones are sent, trimmed.
 */
export interface DraftPoll {
  options: string[]
  /** Seconds the poll stays open. */
  expiresIn: number
  multiple: boolean
  hideTotals: boolean
}

/** An image a Bluesky draft holds: the PDS has the blob, so a reload does not upload it again. */
export interface BlueskyDraftImage {
  /**
   * A local id for the controls. Not the CID: the same file picked twice
   * has the same CID and is still two images.
   */
  id: string
  blob: BlueskyBlobRef
  mime: string
  size: number
  /** Alt text. It goes in the post's embed; Bluesky keeps none on the blob. */
  alt: string
  aspectRatio: { width: number; height: number } | null
  /** The name of the file the reader picked, for the controls' names. */
  name?: string
}

/**
 * The exact record a send wrote, or tried to, frozen before the request
 * (spec 7.2). `input` is `blueskyDraftInput` of the draft it was made
 * from, so a retry can tell whether the reader edited since.
 */
export interface BlueskySentRecord {
  input: string
  record: BlueskyPostRecord
}

/**
 * What a Bluesky draft holds beside `text` (spec 7.2; rules in the README,
 * "Bluesky drafts"). Plain JSON, kept in the account's drafts.
 */
export interface BlueskyDraft {
  reply: { root: BlueskyStrongRef; parent: BlueskyStrongRef } | null
  quote: BlueskyStrongRef | null
  /** Self-labels from the label menu. Sent only with images. */
  labels: string[]
  images: BlueskyDraftImage[]
  /** The record key, picked before the first send and kept until the post is known. */
  rkey: string | null
  /** Set from just before a send until its outcome is known. */
  sent: BlueskySentRecord | null
  /** A redraft only: the URI of the post it was made from (#190). */
  source?: string
  /**
   * A redraft only: the delete of `source` had no clear answer, so the post
   * may still be up. The dialog checks when it opens the draft.
   */
  sourceMaybeLive?: boolean
  /**
   * A staged redraft only: when it was staged (ms). After a day with its
   * post still up, it is shown as a normal redraft (README, rule E).
   */
  stagedAt?: number
  /**
   * Set the first time a staged redraft can be seen: revealed, opened or
   * moved to `redraft:`. An exposed draft is a normal draft for good: only
   * its send or the reader removes it (README, rule E).
   */
  exposed?: boolean
}

export interface ComposeDraft {
  text: string
  spoilerText: string
  cw: boolean
  visibility: StatusVisibility
  inReplyToId: string | null
  media: DraftMedia[]
  // One key per draft, kept across reloads: a retry after a lost response
  // gets the first post back from the server instead of a second post.
  idempotencyKey: string
  // Set only by a redraft, which keeps what the deleted post had. A new
  // post leaves them out and the server decides.
  sensitive?: boolean
  language?: string | null
  /** A poll. Mastodon refuses a post with both a poll and media. */
  poll?: DraftPoll | null
  /** A Bluesky draft's own parts. A Mastodon draft has none. */
  bluesky?: BlueskyDraft
  /**
   * The stored revision: every save in this slot makes a new, unique one
   * (so a cleared and refilled slot never repeats one). A send writes only
   * while the revision is the one it owns (README, R4).
   */
  rev?: string
}

// A new post and each reply keep their own draft, so opening a reply does
// not overwrite a half-written post, and the reverse.
// `redraft:<key>` holds a delete-and-redraft opened while its own slot held
// an unsent draft. The deleted post exists nowhere else, so it is stored
// like any draft, beside the one it must not overwrite.
// A Bluesky quote keeps its own draft too, `quote:<uri>`.
// `staged:<key>` holds a Bluesky redraft while its delete runs. No composer
// opens it; the delete's outcome moves it to `redraft:<key>` or removes it
// (README, "Bluesky delete and redraft").
export type DraftSlot = 'new' | `reply:${string}` | `redraft:${string}` | `quote:${string}` | `staged:${string}`

export function draftSlot(inReplyToId: string | null | undefined): DraftSlot {
  return inReplyToId ? `reply:${inReplyToId}` : 'new'
}

function newKey(): string {
  return globalThis.crypto.randomUUID()
}

export function emptyDraft(init: Partial<ComposeDraft> = {}): ComposeDraft {
  return {
    text: '',
    spoilerText: '',
    cw: false,
    visibility: 'public',
    inReplyToId: null,
    media: [],
    idempotencyKey: newKey(),
    ...init,
  }
}

export function isDraftEmpty(d: ComposeDraft): boolean {
  return d.text.trim() === '' && d.spoilerText.trim() === '' && d.media.length === 0
    && !(d.poll?.options.some((o) => o.trim() !== '') ?? false)
    // A Bluesky draft that can be posted is never empty: images or a quote
    // alone can be posted, and a send whose outcome is not known yet is kept
    // whatever it holds (README, "Bluesky drafts").
    && (d.bluesky?.images.length ?? 0) === 0 && !d.bluesky?.quote && !d.bluesky?.sent
}

/** The options a poll sends: the filled ones, trimmed. */
export function pollOptions(poll: DraftPoll): string[] {
  return poll.options.map((o) => o.trim()).filter((o) => o !== '')
}

// Sign-out (`signOutActive`) clears this key. A 401 or an expiry keeps it
// (README, "Session rules").
function storageKey(userKey: UserKey): string {
  return `caribou.drafts.${userKey}`
}

function readAll(userKey: UserKey): Partial<Record<DraftSlot, ComposeDraft>> {
  try {
    const raw = localStorage.getItem(storageKey(userKey))
    const parsed = raw ? JSON.parse(raw) as unknown : null
    return parsed && typeof parsed === 'object' ? parsed as Partial<Record<DraftSlot, ComposeDraft>> : {}
  } catch {
    return {}
  }
}

// False when storage refused the write (full or blocked).
function writeAll(userKey: UserKey, all: Partial<Record<DraftSlot, ComposeDraft>>): boolean {
  try {
    if (Object.keys(all).length === 0) localStorage.removeItem(storageKey(userKey))
    else localStorage.setItem(storageKey(userKey), JSON.stringify(all))
    return true
  } catch {
    // Storage full or blocked: the draft lives on in the open dialog.
    return false
  }
}

export function loadDraft(userKey: UserKey, slot: DraftSlot): ComposeDraft | null {
  const d = readAll(userKey)[slot]
  if (!d || typeof d.text !== 'string') return null
  return withRevealed(userKey, slot, emptyDraft(d))
}

// An empty draft is removed rather than stored, so a dialog opened and
// closed again leaves nothing behind.
export function saveDraft(userKey: UserKey, slot: DraftSlot, draft: ComposeDraft): void {
  storeDraftIf(userKey, slot, undefined, draft)
}

/** The revision stored in `slot` now, or null when the slot is empty. */
export function draftRev(userKey: UserKey, slot: DraftSlot): string | null {
  const d = readAll(userKey)[slot]
  return d && typeof d.text === 'string' ? d.rev ?? '' : null
}

/**
 * Stores `draft` (null, or an empty draft, clears the slot) only when the
 * slot's revision is still `expected` (null: an empty slot; undefined: any).
 * Answers the slot's new revision (null once cleared), or false when the
 * revision had moved or storage refused the write.
 */
export function storeDraftIf(
  userKey: UserKey, slot: DraftSlot, expected: string | null | undefined, draft: ComposeDraft | null,
): { rev: string | null } | false {
  const all = readAll(userKey)
  const held = all[slot]
  const current = held && typeof held.text === 'string' ? held.rev ?? '' : null
  if (expected !== undefined && current !== expected) return false
  const keep = !!draft && !isDraftEmpty(draft)
  const rev = newKey()
  if (keep) all[slot] = { ...draft, rev }
  else delete all[slot]
  if (!writeAll(userKey, all)) return false
  return { rev: keep ? rev : null }
}

/**
 * The slot of the oldest kept redraft (`redraft:<key>`), or null. A new
 * post opens it before the plain `new` draft, so it cannot be forgotten.
 * A `staged:` slot is never found here.
 */
export function findRedraftSlot(userKey: UserKey): DraftSlot | null {
  for (const [slot, d] of Object.entries(readAll(userKey))) {
    const kept = slot.startsWith('redraft:')
      || (slot.startsWith('staged:') && (!!d?.bluesky?.exposed || revealed.has(`${userKey}\u0000${slot}`)))
    if (kept && d && typeof d.text === 'string' && !isDraftEmpty(emptyDraft(d))) {
      return slot as DraftSlot
    }
  }
  return null
}

// `staged:` slots whose delete is decided but that could not be renamed
// (storage refused), with the fields storage could not take (`exposed`,
// the outcome's `sourceMaybeLive`). This page reads the slot with them.
const revealed = new Map<string, Partial<BlueskyDraft>>()

function withRevealed(userKey: UserKey, slot: DraftSlot, d: ComposeDraft): ComposeDraft {
  const over = revealed.get(`${userKey}\u0000${slot}`)
  return over && d.bluesky ? { ...d, bluesky: { ...d.bluesky, ...over } } : d
}

/**
 * Reveals a `staged:` slot whose rename failed: it is exposed (rule E),
 * and `findRedraftSlot` finds it. `patch` (the outcome's mark) is kept in
 * this page, and stored too when storage takes it, with `exposed`.
 */
export function revealDraftSlot(userKey: UserKey, slot: DraftSlot, patch: Partial<BlueskyDraft> = {}): void {
  const key = `${userKey}\u0000${slot}`
  revealed.set(key, { ...revealed.get(key), ...patch, exposed: true })
  const held = loadDraft(userKey, slot)
  if (held) storeDraftIf(userKey, slot, held.rev ?? '', held)
}

/** Changes the page-only fields of a revealed slot (no-op for any other). */
export function patchRevealed(userKey: UserKey, slot: DraftSlot, patch: Partial<BlueskyDraft>): void {
  const key = `${userKey}\u0000${slot}`
  const over = revealed.get(key)
  if (over) revealed.set(key, { ...over, ...patch })
}

/** Tests only: forget the page-only reveals, as a reload does. */
export function _testOnlyForgetRevealed(): void {
  revealed.clear()
}

/**
 * Renames `from` to `to` in one write of the account's draft map, only
 * while `from` still has revision `expected` and `to` is empty. `patch`
 * changes the moved draft. No second copy is stored, so a full storage
 * that took the draft takes the rename too. Answers the new revision, or
 * false.
 */
export function renameDraftIf(
  userKey: UserKey, from: DraftSlot, expected: string, to: DraftSlot,
  patch: (d: ComposeDraft) => ComposeDraft = (d) => d,
): { rev: string } | false {
  const all = readAll(userKey)
  const held = all[from]
  if (!held || typeof held.text !== 'string' || (held.rev ?? '') !== expected || all[to]) return false
  const rev = newKey()
  // Rebuilt in order, so the map keeps its shape and its size.
  const next: Partial<Record<DraftSlot, ComposeDraft>> = {}
  for (const [slot, d] of Object.entries(all) as Array<[DraftSlot, ComposeDraft]>) {
    if (slot === from) next[to] = { ...patch(withRevealed(userKey, from, held as ComposeDraft)), rev }
    else next[slot] = d
  }
  if (!writeAll(userKey, next)) return false
  revealed.delete(`${userKey}\u0000${from}`)
  return { rev }
}

/** Every stored slot of the account, with its draft. */
export function storedDrafts(userKey: UserKey): Array<[DraftSlot, ComposeDraft]> {
  const out: Array<[DraftSlot, ComposeDraft]> = []
  for (const [slot, d] of Object.entries(readAll(userKey))) {
    if (d && typeof d.text === 'string') out.push([slot as DraftSlot, withRevealed(userKey, slot as DraftSlot, emptyDraft(d))])
  }
  return out
}

export function clearDraft(userKey: UserKey, slot: DraftSlot): void {
  const all = readAll(userKey)
  delete all[slot]
  writeAll(userKey, all)
}

export interface PostedDetail { status: Status }

// Posts the draft, then clears it. On failure the draft stays stored and
// the error is rethrown for the caller to show.
export async function postDraft(
  client: CaribouClient, slot: DraftSlot, draft: ComposeDraft,
): Promise<Status> {
  const status = await client.createStatus({
    status: draft.text,
    visibility: draft.visibility,
    ...(draft.sensitive ? { sensitive: true } : {}),
    ...(draft.cw && draft.spoilerText.trim() ? { spoilerText: draft.spoilerText, sensitive: true } : {}),
    ...(draft.language ? { language: draft.language } : {}),
    ...(draft.inReplyToId ? { inReplyToId: draft.inReplyToId } : {}),
    ...(draft.media.length > 0 ? { mediaIds: draft.media.map((m) => m.id) } : {}),
    ...(draft.poll && draft.media.length === 0 ? {
      poll: {
        options: pollOptions(draft.poll), expiresIn: draft.poll.expiresIn,
        multiple: draft.poll.multiple, hideTotals: draft.poll.hideTotals,
      },
    } : {}),
  }, { idempotencyKey: draft.idempotencyKey })
  clearDraft(client.userKey, slot)
  cacheStatus(status)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<PostedDetail>('caribou:posted', { detail: { status } }))
  }
  return status
}
