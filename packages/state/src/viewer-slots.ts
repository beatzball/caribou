import type { UserKey } from '@beatzball/caribou-auth'
import type { Status, StatusBluesky } from '@beatzball/caribou-mastodon-client'
import { activeUserKey } from './users.js'

// The rules are in the package README, "Viewer state: slots and who wins".
// The names below match its words.

/** One action's flag and its record ref, kept together. */
export type Slot = 'like' | 'repost' | 'bookmark'

interface SlotSpec {
  flag: 'favourited' | 'reblogged' | 'bookmarked'
  count: 'favouritesCount' | 'reblogsCount' | null
  record: 'likeUri' | 'repostUri' | null
}

export const SLOTS: Record<Slot, SlotSpec> = {
  like:     { flag: 'favourited', count: 'favouritesCount', record: 'likeUri' },
  repost:   { flag: 'reblogged',  count: 'reblogsCount',    record: 'repostUri' },
  bookmark: { flag: 'bookmarked', count: null,              record: null },
}

const SLOT_NAMES = Object.keys(SLOTS) as Slot[]

/**
 * The viewer fields at the top of a post: the slot flags and the other
 * viewer fields. Page data leaves them out.
 */
export const VIEWER_FIELDS = ['favourited', 'reblogged', 'bookmarked', 'muted', 'pinned'] as const

/**
 * The viewer fields of a Bluesky post, with the value a signed-out reader
 * sees: the slot refs, the other viewer fields, and whose they are.
 */
export const BLUESKY_VIEWER_FIELDS = {
  likeUri: null, repostUri: null, viewerOf: null, replyDisabled: false, embeddingDisabled: false,
} as const satisfies Partial<StatusBluesky>

const BLUESKY_KEYS = Object.keys(BLUESKY_VIEWER_FIELDS) as (keyof typeof BLUESKY_VIEWER_FIELDS)[]

/**
 * Where a copy came from: the account whose token fetched it (null for
 * none) and the viewer clock when the request started. `'page'` is the
 * server's page data.
 */
export type CopySource = { owner: UserKey | null; startedAt: number } | 'page'

/** The server's page data: no token, and maybe older than what is cached. */
export const PAGE_DATA: CopySource = 'page'

let clock = 0

/**
 * The source of a fetch that starts now. Read it just before the request,
 * never after the answer.
 */
export function readSource(owner: UserKey | null): CopySource {
  return { owner, startedAt: clock }
}

/**
 * Runs a fetch by `client` and answers its result with the source to cache
 * it under: taken before the request, as the slot rule needs.
 */
export async function readAs<T>(client: { userKey: UserKey }, run: () => Promise<T>): Promise<[T, CopySource]> {
  const source = readSource(client.userKey)
  return [await run(), source]
}

/** The source `cacheStatus` assumes when none is given. */
export function readerNow(): CopySource {
  return readSource(activeUserKey.peek())
}

interface SlotState {
  /** A write to the slot is out. */
  writing: boolean
  /** The clock when the last write finished; 0 when none has. */
  finishedAt: number
  /** Date.now() when the last write finished. */
  finishedTime: number
  /** The flag the last write left. */
  value: boolean
  /** The record ref the last write left; null for none or a Mastodon post. */
  record: string | null
  /** The writing client's `capabilities.readLagMs`. */
  lagMs: number
}

// By post id, then slot. Only the reader's actions write here.
const slots = new Map<string, Partial<Record<Slot, SlotState>>>()

function slotState(id: string, slot: Slot): SlotState | undefined {
  return slots.get(id)?.[slot]
}

function setSlot(id: string, slot: Slot, state: SlotState): void {
  slots.set(id, { ...slots.get(id), [slot]: state })
}

/** The reader's action on `slot` of post `id` has started. */
export function slotWriteStarted(id: string, slot: Slot): void {
  const had = slotState(id, slot)
  setSlot(id, slot, { finishedAt: 0, finishedTime: 0, value: false, record: null, lagMs: 0, ...had, writing: true })
}

/**
 * The reader's action finished (commit or rollback), leaving the flag
 * `value` and the record ref `record` on the cached post. `lagMs` is the
 * writing client's `capabilities.readLagMs`.
 */
export function slotWriteFinished(
  id: string, slot: Slot, value: boolean, record: string | null, lagMs: number,
): void {
  clock += 1
  setSlot(id, slot, { writing: false, finishedAt: clock, finishedTime: Date.now(), value, record, lagMs })
}

/** Forgets every slot record. Runs on an account change, with the flags. */
export function forgetSlots(): void {
  slots.clear()
}

type Kind = 'reader' | 'other' | 'page'

// The three kinds of copy (README, "Three kinds of copy").
function kindOf(copy: Status, source: CopySource): Kind {
  const active = activeUserKey.peek()
  const viewer = copy.bluesky?.viewerOf ?? null
  if (viewer !== null && viewer !== active) return 'other'
  if (source === 'page') return 'page'
  if (source.owner !== active) return 'other'
  // A Bluesky copy read with no viewer carries none.
  return copy.bluesky && viewer === null ? 'page' : 'reader'
}

// Rules 2 to 4 for one slot of a reader's copy.
function copyWinsSlot(id: string, slot: Slot, copy: Status, source: Exclude<CopySource, 'page'>): boolean {
  const state = slotState(id, slot)
  if (!state) return true
  if (state.writing) return false
  if (source.startedAt < state.finishedAt) return false
  const { flag, record } = SLOTS[slot]
  const agrees = (copy[flag] === true) === state.value
    && (!record || !copy.bluesky || (copy.bluesky[record] ?? null) === state.record)
  return agrees || Date.now() - state.finishedTime >= state.lagMs
}

type Fields = Record<string, unknown>

// Sets `key` of `out` to `had`'s, or removes it when `had` has none.
function keep(out: Fields, had: Fields, key: string): void {
  if (key in had) out[key] = had[key]
  else delete out[key]
}

/**
 * `copy` with every viewer field removed: as a signed-out reader sees it.
 * One level only; nested posts are settled on their own.
 */
export function withoutViewerState(copy: Status): Status {
  const out = { ...copy } as unknown as Fields
  for (const key of VIEWER_FIELDS) delete out[key]
  if (copy.bluesky) {
    // The decision was made for the reader named in `viewerOf`; with that
    // name gone, so is the decision (README, "A Bluesky decision stays with
    // its reader").
    const { moderation: _decision, ...rest } = copy.bluesky
    out.bluesky = { ...rest, ...BLUESKY_VIEWER_FIELDS }
  }
  return out as unknown as Status
}

// Page data's counts (README, "Copies that are not the reader's").
function keepPageCounts(out: Fields, had: Fields, id: string): void {
  for (const slot of SLOT_NAMES) {
    const { flag, count } = SLOTS[slot]
    if (!count || typeof had[count] !== 'number') continue
    const now = typeof out[count] === 'number' ? out[count] as number : 0
    if (slotState(id, slot)?.writing || (had[flag] === true && now < (had[count] as number))) out[count] = had[count]
  }
}

function sameFields(a: Fields, b: Fields): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

/**
 * The viewer fields of `copy` by the merge rule, against `known` (the
 * cached copy of the same post, or undefined). Every other field is the
 * copy's. Returns `copy` itself when nothing changes.
 */
export function settleViewer(copy: Status, known: Status | undefined, source: CopySource): Status {
  const kind = kindOf(copy, source)
  if (!known) return kind === 'other' ? withoutViewerState(copy) : copy
  const had = known as unknown as Fields
  const hadBsky = known.bluesky as unknown as Fields | undefined
  const out = (kind === 'other' ? withoutViewerState(copy) : { ...copy }) as unknown as Fields
  const outBsky = out.bluesky ? { ...out.bluesky as Fields } : null
  if (kind === 'reader') {
    for (const slot of SLOT_NAMES) {
      if (copyWinsSlot(copy.id, slot, copy, source as Exclude<CopySource, 'page'>)) continue
      // The slot is kept: flag and ref as cached. The count is the copy's,
      // moved by one when the kept flag is not the copy's flag.
      const { flag, count, record } = SLOTS[slot]
      const copyOn = out[flag] === true
      keep(out, had, flag)
      if (count && typeof out[count] === 'number') {
        const step = (out[flag] === true ? 1 : 0) - (copyOn ? 1 : 0)
        out[count] = Math.max(0, (out[count] as number) + step)
      }
      if (record && outBsky) outBsky[record] = hadBsky?.[record] ?? null
    }
  } else {
    // Another account's copy or page data: every cached viewer field stays.
    // A field the cache lacks is the copy's (page data) or gone (another
    // account's: `withoutViewerState` removed it).
    for (const key of VIEWER_FIELDS) if (key in had) out[key] = had[key]
    if (outBsky && hadBsky) {
      for (const key of BLUESKY_KEYS) outBsky[key] = hadBsky[key]
      // The decision goes with the `viewerOf` it was made for: the copy's
      // when the kept reader is the copy's, else the cached one.
      const copyBsky = copy.bluesky as unknown as Fields
      if ((copyBsky.viewerOf ?? null) === (hadBsky.viewerOf ?? null)) outBsky.moderation = copyBsky.moderation
      else if ('moderation' in hadBsky) outBsky.moderation = hadBsky.moderation
      else delete outBsky.moderation
    }
    keepPageCounts(out, had, copy.id)
  }
  if (outBsky) out.bluesky = outBsky
  const original = copy as unknown as Fields
  const sameBsky = !copy.bluesky || sameFields(outBsky!, copy.bluesky as unknown as Fields)
  if (sameBsky && sameFields({ ...out, bluesky: original.bluesky }, original)) return copy
  return out as unknown as Status
}
