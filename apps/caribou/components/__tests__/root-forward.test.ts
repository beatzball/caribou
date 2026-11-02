import { describe, it, expect, vi, afterEach } from 'vitest'
import { DECIDED_ATTR, forwardsToHome, replaceWithHome } from '../_root-forward.js'
import { ROOT_FORWARD_HEAD } from '../../server/lib/root-forward-head.js'
import { LIMIT_MS, SPLASH_ID, SPLASH_KEY } from '../_splash.js'

type Store = Record<string, string>

const links = (root: ParentNode) =>
  Array.from(root.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')])

const KEY = 'alice@example.social'
const signedIn: Store = {
  'caribou.activeUserKey': JSON.stringify(KEY),
  'caribou.users': JSON.stringify([[KEY, { userKey: KEY, token: 'T', server: 'example.social' }]]),
}
const withKey = (key: string): Store => ({
  'caribou.activeUserKey': JSON.stringify(key),
  'caribou.users': JSON.stringify([[key, {}]]),
})

// Each case: the query string, localStorage, sessionStorage, and whether `/`
// goes to `/home`. The client check and the inline head script must agree.
const CASES: Array<[string, string, Store | null, Store | null, boolean]> = [
  ['signed in', '', signedIn, {}, true],
  ['signed in, other query', '?utm=x', signedIn, {}, true],
  ['add an account', '?add', signedIn, {}, false],
  ['add an account (value)', '?add=1', signedIn, {}, false],
  ['sign-in error in the URL', '?error=denied', signedIn, {}, false],
  ['sign-in error stashed', '', signedIn, { 'caribou.error': 'unauthorized' }, false],
  ['no accounts', '', {}, {}, false],
  ['no active account', '', { ...signedIn, 'caribou.activeUserKey': 'null' }, {}, false],
  ['active key not stored', '', { ...signedIn, 'caribou.users': '[]' }, {}, false],
  ['active key has no @', '', withKey('nope'), {}, false],
  ['active key has an empty name', '', withKey('@example.social'), {}, false],
  ['active key has an empty server', '', withKey('alice@'), {}, false],
  ['active key has two @', '', withKey('a@b@c'), {}, false],
  ['broken JSON', '', { 'caribou.activeUserKey': '{', 'caribou.users': '[' }, {}, false],
  ['users not a list', '', { ...signedIn, 'caribou.users': '{}' }, {}, false],
  ['storage blocked', '', null, null, false],
]

function storage(store: Store | null): Storage {
  if (!store) {
    return { getItem: () => { throw new DOMException('blocked', 'SecurityError') } } as unknown as Storage
  }
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
  } as unknown as Storage
}

// Runs the head script on a document whose parser stopped in the head: no
// body yet, still loading. `document.write` is what the parser would do with
// `<plaintext hidden>` there: it ends the head and opens the body. Timers,
// frames and the `pageshow` listener are kept, to run by hand.
function runHeadScript(search: string, local: Store | null, session: Store | null) {
  const body = ROOT_FORWARD_HEAD.replace(/^<script>/, '').replace(/<\/script>$/, '')
  const location = { pathname: '/', search, replace: vi.fn() }
  const doc = document.implementation.createHTMLDocument('')
  doc.body.remove()
  let readyState = 'loading'
  Object.defineProperty(doc, 'readyState', { get: () => readyState })
  const written: string[] = []
  doc.write = (html: string) => {
    written.push(html)
    const b = doc.createElement('body')
    const pt = doc.createElement('plaintext')
    pt.hidden = true
    b.append(pt)
    doc.documentElement.append(b)
  }
  const timers: Array<{ fn: () => void; ms: number }> = []
  const frames: Array<() => void> = []
  const listeners: Record<string, (e: { persisted: boolean }) => void> = {}
  const win = { addEventListener: (type: string, fn: (e: { persisted: boolean }) => void) => { listeners[type] = fn } }
  new Function('location', 'localStorage', 'sessionStorage', 'document', 'window', 'setTimeout', 'requestAnimationFrame', body)(
    location, storage(local), storage(session), doc, win,
    (fn: () => void, ms: number) => { timers.push({ fn, ms }) },
    (fn: () => void) => { frames.push(fn) },
  )
  const complete = () => { readyState = 'complete' }
  return { location, doc, timers, frames, listeners, written, complete }
}

// The forward waits for one frame, so the screen is painted first, or for
// 100 ms when no frame comes (a tab in the background).
function runFrameThenTimers(r: ReturnType<typeof runHeadScript>, upTo = 100) {
  r.frames.splice(0).forEach((fn) => fn())
  r.timers.filter((t) => t.ms <= upTo).forEach((t) => t.fn())
}

describe('forwardsToHome (client check)', () => {
  it.each(CASES)('%s', (_name, search, local, session, expected) => {
    expect(forwardsToHome(search, storage(local), storage(session))).toBe(expected)
  })
})

describe('ROOT_FORWARD_HEAD (inline script before first paint)', () => {
  it.each(CASES)('%s', (_name, search, local, session, expected) => {
    const r = runHeadScript(search, local, session)
    runFrameThenTimers(r)
    if (expected) {
      expect(r.location.replace).toHaveBeenCalledTimes(1)
      expect(r.location.replace).toHaveBeenCalledWith('/home')
      expect(r.doc.documentElement.hasAttribute(DECIDED_ATTR)).toBe(false)
    } else {
      expect(r.location.replace).not.toHaveBeenCalled()
      expect(r.doc.getElementById(SPLASH_ID)).toBeNull()
      expect(r.written).toEqual([])
      // The page decided to stay; the router must not check again.
      expect(r.doc.documentElement.hasAttribute(DECIDED_ATTR)).toBe(true)
    }
  })

  it('ends the page as hidden text, shows the screen, and leaves after one frame', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000)
    const session: Store = {}
    const r = runHeadScript('', signedIn, session)
    // The rest of `/` (the landing, the app) is never parsed as markup.
    expect(r.written).toEqual(['<plaintext hidden>'])
    const splash = r.doc.getElementById(SPLASH_ID)!
    expect(splash.parentElement).toBe(r.doc.body)
    expect(splash.querySelector('[role="status"]')?.textContent).toBe('Loading…')
    // /home goes on from this start time.
    expect(session[SPLASH_KEY]).toBe('5000')
    expect(r.location.replace).not.toHaveBeenCalled()
    r.frames[0]!()
    r.timers.find((t) => t.ms === 0)!.fn()
    expect(r.location.replace).toHaveBeenCalledWith('/home')
    // The 100 ms fallback then does not go a second time.
    r.timers.find((t) => t.ms === 100)!.fn()
    expect(r.location.replace).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('leaves after 100 ms when no frame comes', () => {
    const r = runHeadScript('', signedIn, {})
    r.timers.find((t) => t.ms === 100)!.fn()
    expect(r.location.replace).toHaveBeenCalledWith('/home')
  })

  it('shows the way out with the screen, and a plain page at the time limit', () => {
    const r = runHeadScript('', signedIn, {})
    expect(links(r.doc.getElementById(SPLASH_ID)!)).toEqual([['Open your home timeline', '/home'], ['Sign in', '/?add']])
    const limit = r.timers.find((t) => t.ms === LIMIT_MS)!
    limit.fn()
    expect(r.doc.getElementById(SPLASH_ID)).toBeNull()
    expect(r.doc.body?.textContent).toContain('Opening your home timeline…')
    expect(links(r.doc.body!)).toEqual([['Open your home timeline', '/home'], ['Sign in', '/?add']])
  })

  it('sets no timer when it stays', () => {
    const r = runHeadScript('', {}, {})
    expect(r.timers).toHaveLength(0)
    expect(r.frames).toHaveLength(0)
  })

  it('a / page back from the back-forward cache checks again, without ending the page', () => {
    const local: Store = {}
    const r = runHeadScript('', local, {})
    expect(r.location.replace).not.toHaveBeenCalled()
    // The page was parsed and shown as the sign-in page.
    r.complete()
    const landing = r.doc.createElement('body')
    landing.textContent = 'landing'
    r.doc.documentElement.append(landing)
    Object.assign(local, signedIn) // signed in, in another tab
    r.listeners.pageshow!({ persisted: false })
    runFrameThenTimers(r)
    expect(r.location.replace).not.toHaveBeenCalled()
    r.listeners.pageshow!({ persisted: true })
    runFrameThenTimers(r)
    expect(r.location.replace).toHaveBeenCalledWith('/home')
    expect(r.written).toEqual([])
    expect(r.doc.getElementById(SPLASH_ID)?.parentElement).toBe(landing)
    // At the time limit the screen goes, and the page under it stays.
    r.timers.find((t) => t.ms === LIMIT_MS)!.fn()
    expect(r.doc.getElementById(SPLASH_ID)).toBeNull()
    expect(r.doc.body?.textContent).toBe('landing')
  })

  it('a restored page that moved off / by client-side navigation stays', () => {
    const r = runHeadScript('?add', signedIn, {})
    r.location.pathname = '/about'
    r.location.search = ''
    r.listeners.pageshow!({ persisted: true })
    expect(r.location.replace).not.toHaveBeenCalled()
    expect(r.timers).toHaveLength(0)
  })

  it('a restored /?add stays', () => {
    const r = runHeadScript('?add', signedIn, {})
    r.listeners.pageshow!({ persisted: true })
    runFrameThenTimers(r)
    expect(r.location.replace).not.toHaveBeenCalled()
  })

  it('a forward with storage that cannot be written still goes', () => {
    const r = runHeadScript('', signedIn, Object.freeze({}) as Store)
    runFrameThenTimers(r)
    expect(r.location.replace).toHaveBeenCalledWith('/home')
  })

  it('is one plain inline script with no closing tag inside', () => {
    expect(ROOT_FORWARD_HEAD.startsWith('<script>')).toBe(true)
    expect(ROOT_FORWARD_HEAD.indexOf('</script>')).toBe(ROOT_FORWARD_HEAD.length - '</script>'.length)
  })
})

describe('replaceWithHome', () => {
  afterEach(() => {
    document.getElementById('__litro_data__')?.remove()
    vi.restoreAllMocks()
  })

  it('replaces the entry with /home, drops left-over SSR data, and tells the router', () => {
    const data = document.createElement('script')
    data.type = 'application/json'
    data.id = '__litro_data__'
    data.textContent = '{"add":false}'
    document.body.append(data)
    const replace = vi.spyOn(history, 'replaceState')
    const popstate = vi.fn()
    window.addEventListener('popstate', popstate, { once: true })
    replaceWithHome()
    expect(replace).toHaveBeenCalledWith(null, '', '/home')
    expect(popstate).toHaveBeenCalledTimes(1)
    expect(document.getElementById('__litro_data__')).toBeNull()
  })

  it('shows the loading screen until Home has something to show', () => {
    window.addEventListener('popstate', () => {}, { once: true })
    replaceWithHome()
    const splash = document.getElementById(SPLASH_ID)
    expect(splash?.querySelector('[role="status"]')?.textContent).toBe('Loading…')
    splash?.remove()
  })
})
