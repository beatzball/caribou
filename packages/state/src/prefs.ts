import type { UserKey } from '@beatzball/caribou-auth'

// One account's settings, in `caribou.prefs.<userKey>` (localStorage). Every
// per-account preference lives in this one object, so signing out of the
// account (which removes the key, `dropSession` in `users.ts`) clears them all.
//
// Two inline head scripts read the same key before the app loads: the theme
// (`apps/caribou/server/lib/theme-head.ts`) and the forward from `/`
// (`apps/caribou/server/lib/root-forward-head.ts`). Keep the names and the
// defaults below in step with them.

export type ThemePref = 'dark' | 'light' | 'system'
export type DefaultTimeline = 'home' | 'local' | 'public'

export const THEME_PREFS: readonly ThemePref[] = ['dark', 'light', 'system']
export const DEFAULT_TIMELINES: readonly DefaultTimeline[] = ['home', 'local', 'public']

export function prefsKey(userKey: UserKey): string {
  return `caribou.prefs.${userKey}`
}

/** The stored object, or `{}` when there is none, it is broken, or storage is blocked. */
export function readPrefs(userKey: UserKey): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(prefsKey(userKey)) ?? 'null') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/** Merges `patch` into the stored object. False when storage refused the write. */
export function updatePrefs(userKey: UserKey, patch: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(prefsKey(userKey), JSON.stringify({ ...readPrefs(userKey), ...patch }))
    return true
  } catch {
    return false
  }
}

/** The stored theme. Dark is the default (spec §8.6). */
export function themeOf(prefs: Record<string, unknown>): ThemePref {
  const t = prefs.theme
  return t === 'light' || t === 'system' ? t : 'dark'
}

/** The timeline to open after sign-in and on `/`. Home is the default. */
export function defaultTimelineOf(prefs: Record<string, unknown>): DefaultTimeline {
  const t = prefs.defaultTimeline
  return t === 'local' || t === 'public' ? t : 'home'
}

export function defaultTimelinePath(userKey: UserKey): `/${DefaultTimeline}` {
  return `/${defaultTimelineOf(readPrefs(userKey))}`
}
