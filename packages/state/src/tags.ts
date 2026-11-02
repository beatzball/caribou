import { signal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { activeClient, activeUserKey } from './users.js'
import { ownerGeneration } from './keep-alive.js'

// Whether a signed-in user follows a hashtag, keyed by the user and the
// tag's normalized name. Treat it as read-only — write through the functions
// here.
export const tagCache = signal<Map<string, boolean>>(new Map())

// Mastodon's `ASCIIFolding` table (app/lib/ascii_folding.rb), one character
// for one character.
const FOLD_FROM = 'ÀÁÂÃÄÅàáâãäåĀāĂăĄąÇçĆćĈĉĊċČčÐðĎďĐđÈÉÊËèéêëĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħÌÍÎÏìíîïĨĩĪīĬĭĮįİıĴĵĶķĸĹĺĻļĽľĿŀŁłÑñŃńŅņŇňŉŊŋÒÓÔÕÖØòóôõöøŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšſŢţŤťŦŧÙÚÛÜùúûüŨũŪūŬŭŮůŰűŲųŴŵÝýÿŶŷŸŹźŻżŽž'
const FOLD_TO   = 'AAAAAAaaaaaaAaAaAaCcCcCcCcCcDdDdDdEEEEeeeeEeEeEeEeEeGgGgGgGgHhHhIIIIiiiiIiIiIiIiIiJjKkkLlLlLlLlLlNnNnNnNnnNnOOOOOOooooooOoOoOoRrRrRrSsSsSsSssTtTtTtUUUUuuuuUuUuUuUuUuUuWwYyyYyYZzZzZz'
const FOLD = new Map([...FOLD_FROM].map((c, i) => [c, FOLD_TO[i]!]))

// `Tag::HASHTAG_INVALID_CHARS_RE`: what is not a letter, a digit, a Thai
// tone mark or a separator. Ruby's `[[:alnum:]]` is Alphabetic or a decimal
// digit.
const INVALID = /[^\p{Alphabetic}\p{Nd}็-๎_·・‌]/gu

/**
 * A hashtag's name as Mastodon stores it (`HashtagNormalizer`): NFKC,
 * lowercase, ASCII folding, then invalid characters dropped. `#Café` and
 * `#cafe` are one tag, and so are `#AI` and `#ai`.
 */
export function normalizeTagName(name: string): string {
  // Lowercase one character at a time, as Ruby's `downcase` does. A whole
  // string's `toLowerCase` turns a final Σ into ς; the server keeps σ.
  let folded = ''
  for (const c of name.normalize('NFKC')) {
    for (const l of c.toLowerCase()) folded += FOLD.get(l) ?? l
  }
  return folded.replace(INVALID, '')
}

export function tagKey(userKey: UserKey, name: string): string {
  return `${userKey} ${normalizeTagName(name)}`
}

/** Whether the active account follows the tag; undefined while not known. */
export function tagFollowing(name: string, userKey: UserKey | null = activeUserKey.value): boolean | undefined {
  return userKey ? tagCache.value.get(tagKey(userKey, name)) : undefined
}

export interface TagOpts {
  clientSource?: () => CaribouClient | null
}

const defaultSource = () => activeClient.value

// One write per tag at a time. A revision per tag is bumped when a write
// starts and again when it ends, so a read that overlaps a write at any
// point — started before it, or while it was on its way — carries older
// state and is dropped.
const writing = new Set<string>()
const revisions = new Map<string, number>()
const bump = (key: string) => revisions.set(key, (revisions.get(key) ?? 0) + 1)

function put(key: string, following: boolean): void {
  const next = new Map(tagCache.value)
  next.set(key, following)
  tagCache.value = next
}

function toast(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'error', message } }))
}

const isNotFound = (err: unknown) => (err as { code?: unknown } | null)?.code === 'not_found'

// Each request reads the owner generation first and checks it before it
// writes anything or says anything: a result for an account that is no
// longer active is dropped, even after a switch and back (`mutations.ts`).

export async function loadTag(name: string, opts: TagOpts = {}): Promise<void> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return
  const key = tagKey(client.userKey, name)
  // A write on its way already holds the newest state.
  if (writing.has(key)) return
  const generation = ownerGeneration()
  const revision = revisions.get(key) ?? 0
  let following: boolean
  try {
    following = !!(await client.fetchTag(name)).following
  } catch (err) {
    // An older server answers 404 for a tag nobody has used: nobody follows
    // it, and the reader can still follow it. Any other failure says
    // nothing about the follow, so what is known stays, and an unknown
    // state stays unknown (no button).
    if (!isNotFound(err)) return
    following = false
  }
  if (generation !== ownerGeneration() || (revisions.get(key) ?? 0) !== revision) return
  put(key, following)
}

// The button changes at once; a failed request puts the old state back and
// says so.
export async function toggleTagFollow(name: string, opts: TagOpts = {}): Promise<void> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return
  const key = tagKey(client.userKey, name)
  if (writing.has(key)) return
  const generation = ownerGeneration()
  const before = tagCache.value.get(key) ?? false
  put(key, !before)
  writing.add(key)
  bump(key)
  try {
    const t = before ? await client.unfollowTag(name) : await client.followTag(name)
    if (generation !== ownerGeneration()) return
    put(key, t.following ?? !before)
  } catch {
    if (generation !== ownerGeneration()) return
    put(key, before)
    toast(before ? `Couldn't unfollow #${name}.` : `Couldn't follow #${name}.`)
  } finally {
    writing.delete(key)
    bump(key)
  }
}
