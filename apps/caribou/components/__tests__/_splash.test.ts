import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIMIT_MS, SETTLE_MS, SPLASH_ID, SPLASH_KEY, SPLASH_MARKUP, settleSplash, showSplash,
} from '../_splash.js'
import { HOME_SPLASH_HEAD } from '../../server/lib/home-splash-head.js'

const NOW = 1_000_000

function links(root: ParentNode) {
  return Array.from(root.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')])
}

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce') }))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  reducedMotion(false)
})

afterEach(() => {
  document.getElementById(SPLASH_ID)?.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the screen', () => {
  it('has the logo, "Loading…" in a polite live region, and the way out', () => {
    const el = showSplash()
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/logo.png')
    const status = el.querySelector('[role="status"]')
    expect(status?.textContent).toBe('Loading…')
    expect(links(el)).toEqual([['Open your home timeline', '/home'], ['Sign in', '/?add']])
  })

  it('holds no closing script tag, so a head script can carry it', () => {
    expect(SPLASH_MARKUP).not.toMatch(/<\/script/i)
  })
})

describe('showSplash (client-side forward)', () => {
  it('adds one screen to the body and counts from the start time', () => {
    showSplash(NOW - 1200)
    showSplash(NOW - 1200)
    const all = document.querySelectorAll(`#${SPLASH_ID}`)
    expect(all).toHaveLength(1)
    expect(all[0]!.parentElement).toBe(document.body)
    expect((all[0] as HTMLElement).style.getPropertyValue('--cs-t')).toBe('-1200ms')
  })

  it('removes itself at the time limit, counted from the start', () => {
    showSplash(NOW - 4000)
    vi.advanceTimersByTime(LIMIT_MS - 4000 - 1)
    expect(document.getElementById(SPLASH_ID)).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(document.getElementById(SPLASH_ID)).toBeNull()
  })
})

describe('settleSplash', () => {
  it('does nothing when no screen is shown', () => {
    expect(() => settleSplash()).not.toThrow()
  })

  it('fills and fades the screen, then removes it', () => {
    const el = showSplash()
    settleSplash()
    expect(el.hasAttribute('data-done')).toBe(true)
    vi.advanceTimersByTime(SETTLE_MS - 1)
    expect(el.isConnected).toBe(true)
    settleSplash() // a second call changes nothing
    vi.advanceTimersByTime(1)
    expect(el.isConnected).toBe(false)
  })

  it('removes the screen at once with reduced motion', () => {
    reducedMotion(true)
    const el = showSplash()
    settleSplash()
    expect(el.isConnected).toBe(false)
  })
})

type Store = Record<string, string>

// Runs the head script of `/home` on a document whose parser is still in the
// head: no body yet.
function runHomeHead(session: Store | null) {
  const body = HOME_SPLASH_HEAD.replace(/^<script>/, '').replace(/<\/script>$/, '')
  const doc = document.implementation.createHTMLDocument('')
  doc.body.remove()
  const store = session
  const storage = store
    ? {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = v },
        removeItem: (k: string) => { delete store[k] },
      }
    : { getItem: () => { throw new DOMException('blocked', 'SecurityError') } }
  const timers: Array<{ fn: () => void; ms: number }> = []
  new Function('document', 'sessionStorage', 'setTimeout', body)(
    doc, storage, (fn: () => void, ms: number) => { timers.push({ fn, ms }) },
  )
  return { doc, timers, store }
}

describe('HOME_SPLASH_HEAD (head of /home)', () => {
  it('goes on with the screen of a fresh forward, before the body exists', () => {
    const { doc, timers, store } = runHomeHead({ [SPLASH_KEY]: String(NOW - 1500) })
    const el = doc.getElementById(SPLASH_ID)!
    expect(el.parentElement).toBe(doc.documentElement)
    expect(el.style.getPropertyValue('--cs-t')).toBe('-1500ms')
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Loading…')
    // Read once: a reload of /home shows no screen.
    expect(store).toEqual({})
    expect(timers.map((t) => t.ms)).toEqual([LIMIT_MS - 1500])
    timers[0]!.fn()
    expect(doc.getElementById(SPLASH_ID)).toBeNull()
  })

  it('shows nothing on a plain load of /home', () => {
    const { doc, timers } = runHomeHead({})
    expect(doc.getElementById(SPLASH_ID)).toBeNull()
    expect(timers).toHaveLength(0)
  })

  it('shows nothing for a forward older than the time limit, and drops it', () => {
    const { doc, store } = runHomeHead({ [SPLASH_KEY]: String(NOW - LIMIT_MS) })
    expect(doc.getElementById(SPLASH_ID)).toBeNull()
    expect(store).toEqual({})
  })

  it('shows nothing for a start time that is not a number or is in the future', () => {
    expect(runHomeHead({ [SPLASH_KEY]: 'x' }).doc.getElementById(SPLASH_ID)).toBeNull()
    expect(runHomeHead({ [SPLASH_KEY]: String(NOW + 5000) }).doc.getElementById(SPLASH_ID)).toBeNull()
  })

  it('shows nothing, and does not throw, with storage blocked', () => {
    expect(runHomeHead(null).doc.getElementById(SPLASH_ID)).toBeNull()
  })

  it('is one plain inline script with no closing tag inside', () => {
    expect(HOME_SPLASH_HEAD.startsWith('<script>')).toBe(true)
    expect(HOME_SPLASH_HEAD.indexOf('</script>')).toBe(HOME_SPLASH_HEAD.length - '</script>'.length)
  })
})
