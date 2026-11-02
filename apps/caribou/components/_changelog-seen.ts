// The changelog's unread dot: does the running build have a version the
// active account has not seen on `/changelog`?
//
// The marker is `lastSeenChangelogVersion` in `caribou.prefs.<userKey>`, so
// it is per account and goes away on that account's sign-out. An account
// with no marker takes the running version as seen: a new reader gets no
// dot for notes from before they came. Signed out, there is no dot.
import { computed, effect, signal } from '@preact/signals-core'
import { activeUserKey } from '@beatzball/caribou-state'
import { PACKAGE_VERSION } from '../server/build-meta.generated.js'

const PREF = 'lastSeenChangelogVersion'

/** < 0, 0 or > 0 as `a` is older, the same as or newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const [aCore = '', aPre] = a.split('-', 2)
  const [bCore = '', bPre] = b.split('-', 2)
  const aParts = aCore.split('.').map(Number)
  const bParts = bCore.split('.').map(Number)
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const d = (aParts[i] || 0) - (bParts[i] || 0)
    if (d !== 0) return d
  }
  if (aPre === bPre) return 0
  if (aPre === undefined) return 1
  if (bPre === undefined) return -1
  return comparePrerelease(aPre, bPre)
}

// Semver's order: field by field, numbers as numbers and before words, and
// fewer fields first when the rest is equal (`beta` < `beta.1`).
function comparePrerelease(a: string, b: string): number {
  const as = a.split('.')
  const bs = b.split('.')
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const x = as[i]!
    const y = bs[i]!
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return Number(x) - Number(y)
    if (xn) return -1
    if (yn) return 1
    return x < y ? -1 : 1
  }
  return as.length - bs.length
}

function prefsKey(userKey: string): string {
  return `caribou.prefs.${userKey}`
}

function readPrefs(userKey: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(prefsKey(userKey)) ?? 'null') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function writeSeen(userKey: string, version: string): void {
  try {
    localStorage.setItem(prefsKey(userKey), JSON.stringify({ ...readPrefs(userKey), [PREF]: version }))
  } catch {
    // Storage full or blocked: the dot stays until it works.
  }
}

let running = PACKAGE_VERSION
// The active account's marker, or null when signed out.
const seen = signal<string | null>(null)

/** True when the running version is newer than the active account's marker. */
export const changelogUnread = computed(() =>
  seen.value !== null && compareVersions(running, seen.value) > 0)

/**
 * Follows the active account and keeps `changelogUnread` current. Call once
 * for the app (`app-main.ts`). Returns a stop function (for tests).
 */
export function startChangelogSeen(version: string = PACKAGE_VERSION): () => void {
  running = version
  return effect(() => {
    const key = activeUserKey.value
    if (!key) { seen.value = null; return }
    const stored = readPrefs(key)[PREF]
    if (typeof stored === 'string' && stored !== '') { seen.value = stored; return }
    writeSeen(key, running)
    seen.value = running
  })
}

/** The reader opened `/changelog`: the running version is seen. Never moves the marker back. */
export function markChangelogSeen(): void {
  const key = activeUserKey.peek()
  if (!key) return
  const stored = readPrefs(key)[PREF]
  if (typeof stored === 'string' && stored !== '' && compareVersions(running, stored) <= 0) {
    seen.value = stored
    return
  }
  writeSeen(key, running)
  seen.value = running
}
