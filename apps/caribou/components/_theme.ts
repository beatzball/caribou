// The theme: dark (the default), light, or system, per account (spec §8.6,
// issue 49). The setting is `theme` in `caribou.prefs.<userKey>`.
//
// Two places apply it, with the same rules. On a full page load the inline
// script in the head (`server/lib/theme-head.ts`) sets `data-theme` on
// `<html>` before the first paint, so the page never flashes the other theme.
// After that, `startTheme` (from `app-main.ts`) keeps it in step: a change on
// /settings, a switch of account, and for "system" a change of the system's
// own setting. The tests run both on one table of cases.
//
// `<html>` is outside every Lit template, so its attribute does not touch
// hydration.
import { effect, signal } from '@preact/signals-core'
import {
  activeUserKey, readPrefs, themeOf, updatePrefs, type ThemePref,
} from '@beatzball/caribou-state'
import { isUserKey } from '@beatzball/caribou-auth'
import { LIGHT_THEME_COLOR, THEME_COLOR } from '../server/lib/brand-head.js'

export type ResolvedTheme = 'dark' | 'light'

/** `--bg-0` of each theme in tokens.css: the browser's own chrome colour. */
export const THEME_COLORS: Record<ResolvedTheme, string> = { dark: THEME_COLOR, light: LIGHT_THEME_COLOR }

export const LIGHT_QUERY = '(prefers-color-scheme: light)'

export function resolveTheme(pref: ThemePref, systemLight: boolean): ResolvedTheme {
  if (pref === 'system') return systemLight ? 'light' : 'dark'
  return pref
}

/**
 * The active account's theme, read straight from `local`. Dark when nothing
 * is active, nothing is stored, or storage is blocked.
 */
export function themeFromStorage(local: Pick<Storage, 'getItem'>): ThemePref {
  try {
    const key: unknown = JSON.parse(local.getItem('caribou.activeUserKey') ?? 'null')
    const users: unknown = JSON.parse(local.getItem('caribou.users') ?? '[]')
    if (typeof key !== 'string' || !isUserKey(key) || !Array.isArray(users)) return 'dark'
    // `loadFromStorage` drops an active key that names no stored account.
    if (!users.some((e) => Array.isArray(e) && e[0] === key)) return 'dark'
    const raw: unknown = JSON.parse(local.getItem(`caribou.prefs.${key}`) ?? 'null')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? themeOf(raw as Record<string, unknown>) : 'dark'
  } catch {
    return 'dark'
  }
}

/** Black at `alpha` (0 to 1) over a `#rrggbb` color, as `#rrggbb`. */
export function dimmed(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  const a = Math.min(1, Math.max(0, alpha))
  return '#' + [n >> 16, (n >> 8) & 255, n & 255]
    // toFixed first: 1 - 0.55 is 0.4499…, which would round 112.5 down.
    .map((c) => Math.round(Number((c * (1 - a)).toFixed(6))).toString(16).padStart(2, '0')).join('')
}

/**
 * The browser's own bars: the page color, or with a full-screen dim open
 * (the media viewer) that dim over the page color, so the bars look dimmed
 * with the page.
 */
export function themeColor(theme: ResolvedTheme, dim: number | null): string {
  return dim === null ? THEME_COLORS[theme] : dimmed(THEME_COLORS[theme], dim)
}

export function applyTheme(doc: Document, theme: ResolvedTheme, dim: number | null = null): void {
  doc.documentElement.setAttribute('data-theme', theme)
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(theme, dim))
}

/**
 * The dim of the full-screen overlay that is open, or null. `startTheme`
 * reads it, so the theme-color follows a theme change while the overlay is
 * open, and goes back to the current theme's color when it closes.
 */
export const chromeDim = signal<number | null>(null)
let dimHolder: object | null = null

/**
 * Dims the browser's bars; call the returned function to undo it. Only the
 * latest call's undo does anything, so a late undo from an overlay that was
 * already replaced leaves the new one's dim alone.
 */
export function dimChrome(alpha: number): () => void {
  const token = {}
  dimHolder = token
  chromeDim.value = alpha
  return () => {
    if (dimHolder !== token) return
    dimHolder = null
    chromeDim.value = null
  }
}

// Bumped by `setThemePref`, so the effect in `startTheme` reads the setting again.
const changed = signal(0)

/** The active account's stored theme. Dark with no account. */
export function currentThemePref(): ThemePref {
  const key = activeUserKey.peek()
  return key ? themeOf(readPrefs(key)) : 'dark'
}

/**
 * Saves the active account's theme and applies it. False, and nothing
 * changes, when there is no active account or storage refused the write.
 */
export function setThemePref(pref: ThemePref): boolean {
  const key = activeUserKey.peek()
  if (!key || !updatePrefs(key, { theme: pref })) return false
  changed.value++
  return true
}

/** Applies the theme now and on every change. Returns a stop function. */
export function startTheme(win: Window, doc: Document): () => void {
  const media = typeof win.matchMedia === 'function' ? win.matchMedia(LIGHT_QUERY) : null
  const systemLight = signal(media?.matches ?? false)
  const onChange = () => { systemLight.value = media?.matches ?? false }
  media?.addEventListener?.('change', onChange)
  const stop = effect(() => {
    const key = activeUserKey.value
    void changed.value
    const pref = key ? themeOf(readPrefs(key)) : 'dark'
    applyTheme(doc, resolveTheme(pref, systemLight.value), chromeDim.value)
  })
  return () => {
    stop()
    media?.removeEventListener?.('change', onChange)
  }
}
