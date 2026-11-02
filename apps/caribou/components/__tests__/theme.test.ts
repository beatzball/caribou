import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, users } from '@beatzball/caribou-state'
import type { UserKey } from '@beatzball/caribou-auth'
import {
  THEME_COLORS, applyTheme, resolveTheme, setThemePref, startTheme, themeFromStorage,
} from '../_theme.js'
import { THEME_HEAD } from '../../server/lib/theme-head.js'
import { THEME_COLOR } from '../../server/lib/brand-head.js'

type Store = Record<string, string>

const KEY = 'alice@example.social'
const active = (prefs?: unknown): Store => ({
  'caribou.activeUserKey': JSON.stringify(KEY),
  ...(prefs === undefined ? {} : { [`caribou.prefs.${KEY}`]: typeof prefs === 'string' ? prefs : JSON.stringify(prefs) }),
})

// Each case: localStorage, whether the system asks for light, and the theme
// that must be on <html>. The head script and the client must agree.
const CASES: Array<[string, Store | null, boolean, 'dark' | 'light']> = [
  ['nothing stored', {}, false, 'dark'],
  ['nothing stored, system light', {}, true, 'dark'],
  ['no prefs', active(), true, 'dark'],
  ['dark', active({ theme: 'dark' }), true, 'dark'],
  ['light', active({ theme: 'light' }), false, 'light'],
  ['system, system dark', active({ theme: 'system' }), false, 'dark'],
  ['system, system light', active({ theme: 'system' }), true, 'light'],
  ['unknown value', active({ theme: 'pink' }), true, 'dark'],
  ['broken prefs JSON', active('{'), true, 'dark'],
  ['prefs not an object', active('["light"]'), true, 'dark'],
  ['no active account', { 'caribou.activeUserKey': 'null', [`caribou.prefs.${KEY}`]: '{"theme":"light"}' }, false, 'dark'],
  ['broken active key', { 'caribou.activeUserKey': '{' }, false, 'dark'],
  ['storage blocked', null, true, 'dark'],
]

function storage(store: Store | null): Storage {
  if (!store) {
    return { getItem: () => { throw new DOMException('blocked', 'SecurityError') } } as unknown as Storage
  }
  return { getItem: (k: string) => (k in store ? store[k] : null) } as unknown as Storage
}

const matchMediaFor = (light: boolean) => (q: string) => ({ matches: light && q === '(prefers-color-scheme: light)' })

// Runs the head script on a document whose parser stopped in the head.
function runHeadScript(local: Store | null, light: boolean, opts: { noMatchMedia?: boolean } = {}) {
  const body = THEME_HEAD.replace(/^<script>/, '').replace(/<\/script>$/, '')
  const doc = document.implementation.createHTMLDocument('')
  doc.body.remove()
  const meta = doc.createElement('meta')
  meta.name = 'theme-color'
  meta.content = THEME_COLOR
  doc.head.append(meta)
  const win = opts.noMatchMedia ? {} : { matchMedia: matchMediaFor(light) }
  new Function('localStorage', 'document', 'window', body)(storage(local), doc, win)
  return doc
}

describe('themeFromStorage + resolveTheme (client)', () => {
  it.each(CASES)('%s', (_name, local, light, expected) => {
    expect(resolveTheme(themeFromStorage(storage(local)), light)).toBe(expected)
  })
})

describe('THEME_HEAD (inline script before first paint)', () => {
  it.each(CASES)('%s', (_name, local, light, expected) => {
    const doc = runHeadScript(local, light)
    expect(doc.documentElement.getAttribute('data-theme')).toBe(expected)
    expect(doc.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(THEME_COLORS[expected])
  })

  it('a browser without matchMedia gets dark for system', () => {
    const doc = runHeadScript(active({ theme: 'system' }), true, { noMatchMedia: true })
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('is one plain inline script with no closing tag inside', () => {
    expect(THEME_HEAD.startsWith('<script>')).toBe(true)
    expect(THEME_HEAD.indexOf('</script>')).toBe(THEME_HEAD.length - '</script>'.length)
  })
})

describe('THEME_COLORS', () => {
  it('dark is the brand theme colour', () => {
    expect(THEME_COLORS.dark).toBe(THEME_COLOR)
  })
})

describe('applyTheme', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('sets data-theme and the theme-color meta', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.append(meta)
    applyTheme(document, 'light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(meta.content).toBe(THEME_COLORS.light)
    applyTheme(document, 'dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(meta.content).toBe(THEME_COLORS.dark)
  })
})

describe('startTheme', () => {
  const key = KEY as UserKey
  let stop: (() => void) | undefined
  afterEach(() => {
    stop?.()
    stop = undefined
    localStorage.clear()
    users.value = new Map()
    activeUserKey.value = null
    vi.restoreAllMocks()
  })

  function fakeMedia(light: boolean) {
    const listeners: Array<() => void> = []
    const mql = {
      matches: light,
      addEventListener: (_t: string, fn: () => void) => { listeners.push(fn) },
      removeEventListener: vi.fn(),
    }
    const win = { matchMedia: () => mql } as unknown as Window
    return { mql, win, fire: (next: boolean) => { mql.matches = next; listeners.forEach((fn) => fn()) } }
  }

  it('follows the active account, the setting and the system', () => {
    const media = fakeMedia(false)
    users.value = new Map([[key, { userKey: key } as never]])
    activeUserKey.value = key
    stop = startTheme(media.win, document)
    expect(document.documentElement.dataset.theme).toBe('dark')

    setThemePref('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(JSON.parse(localStorage.getItem(`caribou.prefs.${KEY}`)!)).toEqual({ theme: 'light' })

    setThemePref('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
    media.fire(true)
    expect(document.documentElement.dataset.theme).toBe('light')

    activeUserKey.value = null
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('stops listening when stopped', () => {
    const media = fakeMedia(false)
    stop = startTheme(media.win, document)
    stop()
    stop = undefined
    expect(media.mql.removeEventListener).toHaveBeenCalled()
  })
})
