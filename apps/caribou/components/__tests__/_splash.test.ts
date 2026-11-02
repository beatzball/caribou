import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIMIT_MS, LIVE_MS, QUICK_MS, SETTLE_MS, SPLASH_ID, SPLASH_KEY, SPLASH_MARKUP, settleSplash, showSplash,
} from '../_splash.js'
import { TIMELINE_SPLASH_HEAD } from '../../server/lib/timeline-splash-head.js'

const NOW = 1_000_000

const links = (root: ParentNode) =>
  Array.from(root.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')])

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce') }))
}

// A page under the screen: the outlet the router focuses, and a link.
function pageUnder() {
  document.body.innerHTML = '<litro-outlet tabindex="-1"><a href="/local">Local</a></litro-outlet>'
  return {
    outlet: document.querySelector('litro-outlet') as HTMLElement,
    link: document.querySelector('a') as HTMLElement,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  reducedMotion(false)
  history.replaceState(null, '', '/home')
})

afterEach(() => {
  document.getElementById(SPLASH_ID)?.remove()
  document.body.inert = false
  document.body.replaceChildren()
  sessionStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the screen', () => {
  it('has the logo, a polite live region that gets "Loading…" a moment later, and the way out', () => {
    const el = showSplash('/local')
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/logo.png')
    const status = el.querySelector('[role="status"]')!
    // Born empty, so the text is a change a screen reader announces.
    expect(status.textContent).toBe('')
    vi.advanceTimersByTime(LIVE_MS)
    expect(status.textContent).toBe('Loading…')
    expect(links(el)).toEqual([['Open your timeline', '/local'], ['Sign in', '/?add']])
  })

  it('holds no closing script tag, so a head script can carry it', () => {
    expect(SPLASH_MARKUP).not.toMatch(/<\/script/i)
  })

  it('following one of its links drops the stored forward', () => {
    sessionStorage.setItem(SPLASH_KEY, '{}')
    const el = showSplash('/home')
    el.querySelector('a')!.addEventListener('click', (e) => e.preventDefault())
    el.querySelector('a')!.click()
    expect(sessionStorage.getItem(SPLASH_KEY)).toBeNull()
  })
})

describe('showSplash (client-side forward)', () => {
  it('adds one screen outside the body and counts from the start time', () => {
    showSplash('/home', NOW - 1200)
    showSplash('/home', NOW - 1200)
    const all = document.querySelectorAll(`#${SPLASH_ID}`)
    expect(all).toHaveLength(1)
    expect(all[0]!.parentElement).toBe(document.documentElement)
    expect((all[0] as HTMLElement).style.getPropertyValue('--cs-t')).toBe('-1200ms')
  })

  it('keeps focus off the page under it while it is up', () => {
    const { link } = pageUnder()
    link.focus()
    const el = showSplash('/home')
    expect(document.body.inert).toBe(true)
    expect(document.activeElement).toBe(el)
  })

  it('removes itself at the time limit, counted from the start, and gives the page back', () => {
    const { outlet } = pageUnder()
    showSplash('/home', NOW - 4000)
    vi.advanceTimersByTime(LIMIT_MS - 4000 - 1)
    expect(document.getElementById(SPLASH_ID)).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(document.getElementById(SPLASH_ID)).toBeNull()
    expect(document.body.inert).toBe(false)
    expect(document.activeElement).toBe(outlet)
  })

  it('goes at once when the reader leaves the target', () => {
    pageUnder()
    showSplash('/home')
    // The forward itself: the router moves to the target.
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(document.getElementById(SPLASH_ID)).not.toBeNull()
    // Back, or a link: another page.
    history.replaceState(null, '', '/about')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(document.getElementById(SPLASH_ID)).toBeNull()
    expect(document.body.inert).toBe(false)
  })
})

describe('settleSplash', () => {
  it('does nothing when no screen is shown', () => {
    expect(() => settleSplash('/home')).not.toThrow()
  })

  it('does nothing for another page than the target', () => {
    const el = showSplash('/local')
    vi.advanceTimersByTime(QUICK_MS)
    settleSplash('/home')
    expect(el.hasAttribute('data-done')).toBe(false)
    expect(document.body.inert).toBe(true)
  })

  it('gives the page back at once, then fills and fades the screen and removes it', () => {
    const { outlet } = pageUnder()
    const el = showSplash('/home')
    vi.advanceTimersByTime(QUICK_MS)
    settleSplash('/home')
    expect(document.body.inert).toBe(false)
    expect(document.activeElement).toBe(outlet)
    expect(el.hasAttribute('data-done')).toBe(true)
    vi.advanceTimersByTime(SETTLE_MS - 1)
    expect(el.isConnected).toBe(true)
    settleSplash('/home') // a second call changes nothing
    vi.advanceTimersByTime(1)
    expect(el.isConnected).toBe(false)
  })

  it('removes the screen at once with reduced motion', () => {
    reducedMotion(true)
    const el = showSplash('/home')
    vi.advanceTimersByTime(QUICK_MS)
    settleSplash('/home')
    expect(el.isConnected).toBe(false)
  })

  it('removes the screen at once, with no fade, when the page was ready at once', () => {
    const el = showSplash('/home')
    settleSplash('/home')
    expect(el.isConnected).toBe(false)
  })
})

type Store = Record<string, string>

// Runs the head script of a timeline on a document whose parser is still in
// the head: no body yet. Timers and listeners are kept, to run by hand.
function runTimelineHead(path: string, session: Store | null) {
  const body = TIMELINE_SPLASH_HEAD.replace(/^<script>/, '').replace(/<\/script>$/, '')
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
  const location = { pathname: path }
  const timers: Array<{ fn: () => void; ms: number }> = []
  const listeners: Record<string, () => void> = {}
  const win = { addEventListener: (t: string, fn: () => void) => { listeners[t] = fn }, removeEventListener: () => {} }
  new Function('document', 'sessionStorage', 'setTimeout', 'location', 'window', body)(
    doc, storage, (fn: () => void, ms: number) => { timers.push({ fn, ms }) }, location, win,
  )
  const parseBody = () => {
    const b = doc.createElement('body')
    b.innerHTML = '<litro-outlet tabindex="-1"></litro-outlet>'
    doc.documentElement.append(b)
    doc.dispatchEvent(new Event('DOMContentLoaded'))
    return b
  }
  return { doc, timers, store, listeners, location, parseBody }
}

const forward = (to: string, ago: number) => ({ [SPLASH_KEY]: JSON.stringify({ t: NOW - ago, to }) })

describe('TIMELINE_SPLASH_HEAD (head of /home, /local, /public)', () => {
  it('goes on with the screen of a fresh forward to this page, before the body exists', () => {
    const r = runTimelineHead('/local', forward('/local', 1500))
    const el = r.doc.getElementById(SPLASH_ID)!
    expect(el.parentElement).toBe(r.doc.documentElement)
    expect(el.style.getPropertyValue('--cs-t')).toBe('-1500ms')
    expect(el.dataset.target).toBe('/local')
    expect(links(el)[0]).toEqual(['Open your timeline', '/local'])
    // Read once: a reload shows no screen.
    expect(r.store).toEqual({})
    const limit = r.timers.find((t) => t.ms === LIMIT_MS - 1500)!
    expect(limit).toBeDefined()
    const live = r.timers.find((t) => t.ms === LIVE_MS)!
    live.fn()
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Loading…')
    limit.fn()
    expect(r.doc.getElementById(SPLASH_ID)).toBeNull()
  })

  it('makes the body inert once it is parsed, and gives it back at the end', () => {
    const r = runTimelineHead('/home', forward('/home', 0))
    const body = r.parseBody()
    expect(body.inert).toBe(true)
    r.timers.find((t) => t.ms === LIMIT_MS)!.fn()
    expect(body.inert).toBe(false)
    expect(r.doc.activeElement).toBe(body.querySelector('litro-outlet'))
  })

  it('goes at once when the reader leaves the page', () => {
    const r = runTimelineHead('/home', forward('/home', 0))
    r.parseBody()
    r.listeners.popstate!()
    expect(r.doc.getElementById(SPLASH_ID)).not.toBeNull()
    r.location.pathname = '/about'
    r.listeners.popstate!()
    expect(r.doc.getElementById(SPLASH_ID)).toBeNull()
    expect(r.doc.body.inert).toBe(false)
  })

  it('shows nothing for a forward to another timeline', () => {
    const r = runTimelineHead('/home', forward('/public', 0))
    expect(r.doc.getElementById(SPLASH_ID)).toBeNull()
    expect(r.store).toEqual({})
  })

  it('shows nothing on a plain load', () => {
    const r = runTimelineHead('/home', {})
    expect(r.doc.getElementById(SPLASH_ID)).toBeNull()
    expect(r.timers).toHaveLength(0)
  })

  it('shows nothing for a forward older than the time limit, and drops it', () => {
    const r = runTimelineHead('/home', forward('/home', LIMIT_MS))
    expect(r.doc.getElementById(SPLASH_ID)).toBeNull()
    expect(r.store).toEqual({})
  })

  it('shows nothing for a bad entry or a start in the future', () => {
    expect(runTimelineHead('/home', { [SPLASH_KEY]: 'x' }).doc.getElementById(SPLASH_ID)).toBeNull()
    expect(runTimelineHead('/home', { [SPLASH_KEY]: '{"to":"/home"}' }).doc.getElementById(SPLASH_ID)).toBeNull()
    expect(runTimelineHead('/home', forward('/home', -5000)).doc.getElementById(SPLASH_ID)).toBeNull()
  })

  it('shows nothing, and does not throw, with storage blocked', () => {
    expect(runTimelineHead('/home', null).doc.getElementById(SPLASH_ID)).toBeNull()
  })

  it('is one plain inline script with no closing tag inside', () => {
    expect(TIMELINE_SPLASH_HEAD.startsWith('<script>')).toBe(true)
    expect(TIMELINE_SPLASH_HEAD.indexOf('</script>')).toBe(TIMELINE_SPLASH_HEAD.length - '</script>'.length)
  })
})
