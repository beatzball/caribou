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

/** Viewer fields that are not slots: rule 1 only. */
const OTHER_FIELDS = ['muted', 'pinned'] as const
const OTHER_BLUESKY_FIELDS = ['replyDisabled', 'embeddingDisabled'] as const

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
  setSlot(id, slot, { finishedAt: 0, finishedTime: 0, value: false, lagMs: 0, ...had, writing: true })
}

/**
 * The reader's action finished (commit or rollback), leaving `value`.
 * `lagMs` is the writing client's `capabilities.readLagMs`.
 */
export function slotWriteFinished(id: string, slot: Slot, value: boolean, lagMs: number): void {
  clock += 1
  setSlot(id, slot, { writing: false, finishedAt: clock, finishedTime: Date.now(), value, lagMs })
}

/** Forgets every slot record. Runs on an account change, with the flags. */
export function forgetSlots(): void {
  slots.clear()
}

/** The account whose viewer state this copy carries, if it is the reader's. */
function isReadersCopy(copy: Status, source: CopySource): boolean {
  if (source === 'page') return false
  if (source.owner !== activeUserKey.peek()) return false
  return !copy.bluesky || copy.bluesky.viewerOf === source.owner
}

// Rules 2 to 4 for one slot of a reader's copy.
function copyWinsSlot(id: string, slot: Slot, copy: Status, source: Exclude<CopySource, 'page'>): boolean {
  const state = slotState(id, slot)
  if (!state) return true
  if (state.writing) return false
  if (source.startedAt < state.finishedAt) return false
  const agrees = (copy[SLOTS[slot].flag] === true) === state.value
  return agrees || Date.now() - state.finishedTime >= state.lagMs
}

type Fields = Record<string, unknown>

// Keeps the cached flag and record ref. The count stays the copy's (other
// readers' actions show), moved by one when the kept flag differs from the
// copy's: the copy's count does not hold the reader's write yet.
function keepSlot(out: Fields, outBsky: Fields | null, known: Status, slot: Slot): void {
  const { flag, count, record } = SLOTS[slot]
  const had = known as unknown as Fields
  const copyOn = out[flag] === true
  if (flag in had) out[flag] = had[flag]
  else delete out[flag]
  if (count && typeof out[count] === 'number') {
    const step = (out[flag] === true ? 1 : 0) - (copyOn ? 1 : 0)
    out[count] = Math.max(0, (out[count] as number) + step)
  }
  if (record && outBsky) outBsky[record] = known.bluesky?.[record] ?? null
}

function withoutViewerState(copy: Status): Status {
  const out = { ...copy } as unknown as Fields
  for (const slot of SLOT_NAMES) delete out[SLOTS[slot].flag]
  for (const key of OTHER_FIELDS) delete out[key]
  if (copy.bluesky) {
    out.bluesky = { ...copy.bluesky, likeUri: null, repostUri: null, viewerOf: null } satisfies StatusBluesky
  }
  return out as unknown as Status
}

/**
 * The viewer fields of `copy` by the merge rule, against `known` (the
 * cached copy of the same post, or undefined). Every other field is the
 * copy's. Returns `copy` itself when nothing changes.
 */
export function settleViewer(copy: Status, known: Status | undefined, source: CopySource): Status {
  const readers = isReadersCopy(copy, source)
  if (!known) {
    // Cached as it is, unless the copy names another account as its viewer.
    const other = copy.bluesky?.viewerOf != null && copy.bluesky.viewerOf !== activeUserKey.peek()
    return readers || !other ? copy : withoutViewerState(copy)
  }
  const out = { ...copy } as unknown as Fields
  const outBsky = copy.bluesky ? { ...copy.bluesky } as unknown as Fields : null
  const had = known as unknown as Fields
  let changed = false
  if (!readers) {
    // Rule 1: another copy keeps every cached viewer field.
    for (const slot of SLOT_NAMES) {
      const { flag, record } = SLOTS[slot]
      if (flag in had) {
        if (out[flag] !== had[flag]) { out[flag] = had[flag]; changed = true }
      } else if (out[flag] === true) {
        // Nothing known (an account change dropped it): such a copy still
        // adds no viewer state.
        delete out[flag]; changed = true
      }
      if (record && outBsky && known.bluesky && outBsky[record] !== known.bluesky[record]) {
        outBsky[record] = known.bluesky[record]; changed = true
      }
    }
    for (const key of OTHER_FIELDS) {
      if (key in had && out[key] !== had[key]) { out[key] = had[key]; changed = true }
    }
    if (outBsky && known.bluesky) {
      for (const key of OTHER_BLUESKY_FIELDS) {
        if (outBsky[key] !== known.bluesky[key]) { outBsky[key] = known.bluesky[key]; changed = true }
      }
      if (outBsky.viewerOf !== known.bluesky.viewerOf) { outBsky.viewerOf = known.bluesky.viewerOf; changed = true }
    }
  } else {
    for (const slot of SLOT_NAMES) {
      if (copyWinsSlot(copy.id, slot, copy, source as Exclude<CopySource, 'page'>)) continue
      keepSlot(out, outBsky, known, slot)
      changed = true
    }
  }
  if (!changed) return copy
  if (outBsky) out.bluesky = outBsky
  return out as unknown as Status
}
