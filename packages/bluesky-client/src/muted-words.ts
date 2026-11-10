// The reader's muted words (#196): the edit a prefs write applies. Browser
// only: it loads through `./oauth`, in the lazy chunk. Rules: README,
// "Muted words".
import { sanitizeMutedWordValue } from '@atproto/api'
import { TID } from '@atproto/common-web'

export const MUTED_WORDS_PREF = 'app.bsky.actor.defs#mutedWordsPref'

export type MutedWordTarget = 'content' | 'tag'
export type MutedWordActorTarget = 'all' | 'exclude-following'

/** One edit to the reader's muted words: add one word, or remove one. */
export type MutedWordEdit =
  | {
    kind: 'add'
    value: string
    targets: MutedWordTarget[]
    actorTarget: MutedWordActorTarget
    /** An ISO time in the future; none is forever. */
    expiresAt?: string
  }
  | {
    kind: 'remove'
    /** The word's `id`. A word an old app wrote has none: it is found by `value`. */
    id?: string
    value: string
  }

/** `added` / `removed`: written. `exists` / `absent`: nothing to write. */
export type MutedWordOutcome = 'added' | 'exists' | 'removed' | 'absent'

/** An add that rule 6 refuses. No request was made. */
export class InvalidMutedWord extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidMutedWord'
  }
}

const TARGETS = new Set<string>(['content', 'tag'])
const ACTOR_TARGETS = new Set<string>(['all', 'exclude-following'])

/**
 * Checks an edit before any request (rule 6) and returns it ready to
 * write: an add's value sanitized. Throws `InvalidMutedWord`.
 */
export function checkMutedWordEdit(edit: MutedWordEdit, now = Date.now()): MutedWordEdit {
  if (edit.kind === 'remove') return edit
  const value = typeof edit.value === 'string' ? sanitizeMutedWordValue(edit.value) : ''
  if (!value) throw new InvalidMutedWord('Enter a word to mute.')
  const targets = Array.isArray(edit.targets) ? edit.targets : []
  if (targets.length === 0 || targets.some((t) => !TARGETS.has(t))) throw new InvalidMutedWord('Choose where to mute it.')
  if (!ACTOR_TARGETS.has(edit.actorTarget)) throw new InvalidMutedWord('Choose whose posts to mute it in.')
  if (edit.expiresAt !== undefined) {
    const at = Date.parse(edit.expiresAt)
    if (!Number.isFinite(at) || at <= now) throw new InvalidMutedWord('Choose a time in the future.')
  }
  return { ...edit, value, targets: [...new Set(targets)] }
}

type Pref = { $type?: string } & Record<string, unknown>
type Item = Record<string, unknown>

const sameValue = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

/**
 * The edit on a fresh prefs read (rules 5 to 8). Returns the new prefs, or
 * `false` to write nothing, and the outcome. Only the last muted-words pref
 * changes; everything else is returned as read. Throws for a muted-words
 * pref with no `items` array (rule 8).
 */
export function applyMutedWordEdit(all: Pref[], edit: MutedWordEdit): { prefs: Pref[] | false; outcome: MutedWordOutcome } {
  let at = -1
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]?.$type === MUTED_WORDS_PREF) { at = i; break }
  }
  const pref = at >= 0 ? all[at]! : null
  if (pref && !Array.isArray(pref.items)) throw new Error('Bluesky: the muted words pref has no items list')
  const items = (pref?.items ?? []) as Item[]

  if (edit.kind === 'add') {
    if (items.some((it) => sameValue(it?.value, edit.value))) return { prefs: false, outcome: 'exists' }
    const word: Item = { id: TID.nextStr(), value: edit.value, targets: edit.targets, actorTarget: edit.actorTarget }
    if (edit.expiresAt) word.expiresAt = edit.expiresAt
    const next = { ...(pref ?? { $type: MUTED_WORDS_PREF }), items: [...items, word] }
    return { prefs: at >= 0 ? all.map((p, i) => (i === at ? next : p)) : [...all, next], outcome: 'added' }
  }

  // A word with an id is found by it; one with none (an old app's) by its
  // value, and only when the edit names no id.
  const index = items.findIndex((it) => (typeof it?.id === 'string' && it.id
    ? it.id === edit.id
    : !edit.id && it?.value === edit.value))
  if (index < 0 || !pref) return { prefs: false, outcome: 'absent' }
  const next = { ...pref, items: items.filter((_, i) => i !== index) }
  return { prefs: all.map((p, i) => (i === at ? next : p)), outcome: 'removed' }
}
