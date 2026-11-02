import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIMIT_MS, LIVE_MS, QUICK_MS, SETTLE_MS, SPLASH_ES5, SPLASH_ID, SPLASH_KEY, SPLASH_MARKUP, settleSplash, showSplash,
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

// The head scripts' screen, run in this document, as a predecessor of a
// client-side one.
function headSplash(to: string, start = Date.now()): HTMLElement {
  const [splash, guard] = new Function(`${SPLASH_ES5} return [caribouSplash, caribouGuard]`)() as [
    (t: number, to: string, top: boolean) => HTMLElement, (d: HTMLElement, to: string, ms: number) => void,
  ]
  const el = splash(start, to, true)
  guard(el, to, LIMIT_MS - (Date.now() - start))
  return el
}

describe('one screen at a time', () => {
  it.each([['client-side', showSplash], ['head script', headSplash]] as const)(
    'a settled %s screen does not unlock the body under the next one, at its fade or its old deadline',
    (_name, first) => {
      pageUnder()
      const a = first('/home')
      vi.advanceTimersByTime(200)
      settleSplash('/home') // A fades: its removal is SETTLE_MS away
      vi.advanceTimersByTime(800)
      expect(a.isConnected).toBe(false)
      // t = 1 s. A's deadline is at 10 s; B (a later forward, still
      // loading) has until 11 s.
      const b = showSplash('/home')
      vi.advanceTimersByTime(SETTLE_MS) // past A's fade
      expect(document.body.inert).toBe(true)
      vi.advanceTimersByTime(LIMIT_MS - SETTLE_MS - 1) // t = 11 s - 1 ms: A's deadline has passed
      expect(b.isConnected).toBe(true)
      expect(document.body.inert).toBe(true)
      vi.advanceTimersByTime(1) // B's own deadline
      expect(b.isConnected).toBe(false)
      expect(document.body.inert).toBe(false)
    },
  )

  it.each([['client-side', showSplash], ['head script', headSplash]] as const)(
    'a %s screen that is replaced is ended, with its timers and listeners',
    (_name, first) => {
      pageUnder()
      const a = first('/home')
      const b = showSplash('/local')
      expect(a.isConnected).toBe(false)
      expect(document.body.inert).toBe(true)
      // A's popstate check would end it on /local; it must not touch B.
      history.replaceState(null, '', '/local')
      window.dispatchEvent(new PopStateEvent('popstate'))
      vi.advanceTimersByTime(LIMIT_MS - 1)
      expect(b.isConnected).toBe(true)
      expect(document.body.inert).toBe(true)
    },
  )

  it('the time limit does nothing once the screen has settled', () => {
    const { outlet } = pageUnder()
    showSplash('/home')
    vi.advanceTimersByTime(QUICK_MS)
    settleSplash('/home')
    vi.advanceTimersByTime(SETTLE_MS)
    // Later, something else locks the page and focus is on the body (a
    // modal, say). The old screen's limit must leave both alone.
    outlet.blur()
    document.body.inert = true
    vi.advanceTimersByTime(LIMIT_MS)
    expect(document.body.inert).toBe(true)
    expect(document.activeElement).toBe(document.body)
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
  const win = {
    addEventListener: (t: string, fn: () => void) => { listeners[t] = fn },
    removeEventListener: (t: string) => { delete listeners[t] },
  }
  new Function('document', 'sessionStorage', 'setTimeout', 'location', 'window', body)(
    doc, storage, (fn: () => void, ms: number) => { timers.push({ fn, ms }) }, location, win,
  )
  // The parser adds the body; DOMContentLoaded comes later, after the app's
  // module (which may be slow) has run.
  const parseBody = () => {
    const b = doc.createElement('body')
    b.innerHTML = '<litro-outlet tabindex="-1"></litro-outlet><a href="/local">Local</a>'
    doc.documentElement.append(b)
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

  it('makes the body inert as soon as it is parsed, before DOMContentLoaded, and gives it back at the end', async () => {
    const r = runTimelineHead('/home', forward('/home', 0))
    // happy-dom delivers mutation records on a real timer.
    vi.useRealTimers()
    const body = r.parseBody()
    await new Promise((resolve) => setTimeout(resolve, 10))
    // (Focus on the screen is checked in the browser, `loading-screen.spec.ts`.)
    expect(body.inert).toBe(true)
    r.timers.find((t) => t.ms === LIMIT_MS)!.fn()
    expect(body.inert).toBe(false)
    expect(r.doc.activeElement).toBe(body.querySelector('litro-outlet'))
  })

  it('goes at once when the reader leaves the page', async () => {
    const r = runTimelineHead('/home', forward('/home', 0))
    vi.useRealTimers()
    r.parseBody()
    await new Promise((resolve) => setTimeout(resolve, 10))
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
