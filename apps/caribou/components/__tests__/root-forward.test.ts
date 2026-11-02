import { describe, it, expect, vi, afterEach } from 'vitest'
import { DECIDED_ATTR, rootForwardTarget, replaceWithTimeline } from '../_root-forward.js'
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

const withPrefs = (prefs: string): Store => ({ ...signedIn, [`caribou.prefs.${KEY}`]: prefs })

// Each case: the query string, localStorage, sessionStorage, and where `/`
// goes (null: it stays). The client check and the inline head script must agree.
const CASES: Array<[string, string, Store | null, Store | null, string | null]> = [
  ['signed in', '', signedIn, {}, '/home'],
  ['signed in, other query', '?utm=x', signedIn, {}, '/home'],
  ['default timeline local', '', withPrefs('{"defaultTimeline":"local"}'), {}, '/local'],
  ['default timeline public', '', withPrefs('{"defaultTimeline":"public"}'), {}, '/public'],
  ['default timeline home', '', withPrefs('{"defaultTimeline":"home"}'), {}, '/home'],
  ['default timeline unknown', '', withPrefs('{"defaultTimeline":"//evil.example"}'), {}, '/home'],
  ['prefs broken JSON', '', withPrefs('{'), {}, '/home'],
  ['prefs not an object', '', withPrefs('["local"]'), {}, '/home'],
  ['default timeline, adding an account', '?add', withPrefs('{"defaultTimeline":"local"}'), {}, null],
  ['add an account', '?add', signedIn, {}, null],
  ['add an account (value)', '?add=1', signedIn, {}, null],
  ['sign-in error in the URL', '?error=denied', signedIn, {}, null],
  ['sign-in error stashed', '', signedIn, { 'caribou.error': 'unauthorized' }, null],
  ['no accounts', '', {}, {}, null],
  ['no active account', '', { ...signedIn, 'caribou.activeUserKey': 'null' }, {}, null],
  ['active key not stored', '', { ...signedIn, 'caribou.users': '[]' }, {}, null],
  ['active key has no @', '', withKey('nope'), {}, null],
  ['active key has an empty name', '', withKey('@example.social'), {}, null],
  ['active key has an empty server', '', withKey('alice@'), {}, null],
  ['active key has two @', '', withKey('a@b@c'), {}, null],
  ['broken JSON', '', { 'caribou.activeUserKey': '{', 'caribou.users': '[' }, {}, null],
  ['users not a list', '', { ...signedIn, 'caribou.users': '{}' }, {}, null],
  ['storage blocked', '', null, null, null],
]

function storage(store: Store | null): Storage {
  if (!store) {
    return { getItem: () => { throw new DOMException('blocked', 'SecurityError') } } as unknown as Storage
  }
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
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

describe('rootForwardTarget (client check)', () => {
  it.each(CASES)('%s', (_name, search, local, session, expected) => {
    expect(rootForwardTarget(search, storage(local), storage(session))).toBe(expected)
  })
})

describe('ROOT_FORWARD_HEAD (inline script before first paint)', () => {
  it.each(CASES)('%s', (_name, search, local, session, expected) => {
    const r = runHeadScript(search, local, session)
    runFrameThenTimers(r)
    if (expected) {
      expect(r.location.replace).toHaveBeenCalledTimes(1)
      expect(r.location.replace).toHaveBeenCalledWith(expected)
      expect(r.doc.getElementById(SPLASH_ID)?.dataset.target).toBe(expected)
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
    const r = runHeadScript('', withPrefs('{"defaultTimeline":"public"}'), session)
    // The rest of `/` (the landing, the app) is never parsed as markup.
    expect(r.written).toEqual(['<plaintext hidden>'])
    const splash = r.doc.getElementById(SPLASH_ID)!
    expect(splash.parentElement).toBe(r.doc.body)
    expect(links(splash)).toEqual([['Open your timeline', '/public'], ['Sign in', '/?add']])
    // The timeline goes on from this start time.
    expect(JSON.parse(session[SPLASH_KEY]!)).toEqual({ t: 5000, to: '/public' })
    expect(r.location.replace).not.toHaveBeenCalled()
    r.frames[0]!()
    r.timers.find((t) => t.ms === 0)!.fn()
    expect(r.location.replace).toHaveBeenCalledWith('/public')
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

  it('at the time limit, a plain page with the way out takes the place of the screen, and the forward is dropped', () => {
    const session: Store = {}
    const r = runHeadScript('', withPrefs('{"defaultTimeline":"local"}'), session)
    r.timers.find((t) => t.ms === LIMIT_MS)!.fn()
    expect(r.doc.getElementById(SPLASH_ID)).toBeNull()
    expect(r.doc.body?.textContent).toContain('Opening your timeline…')
    expect(links(r.doc.body!)).toEqual([['Open your timeline', '/local'], ['Sign in', '/?add']])
    expect(session).toEqual({})
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

describe('replaceWithTimeline', () => {
  afterEach(() => {
    document.getElementById('__litro_data__')?.remove()
    vi.restoreAllMocks()
  })

  it('replaces the entry with the path, drops left-over SSR data, and tells the router', () => {
    const data = document.createElement('script')
    data.type = 'application/json'
    data.id = '__litro_data__'
    data.textContent = '{"add":false}'
    document.body.append(data)
    const replace = vi.spyOn(history, 'replaceState')
    const popstate = vi.fn()
    window.addEventListener('popstate', popstate, { once: true })
    replaceWithTimeline('/local')
    expect(replace).toHaveBeenCalledWith(null, '', '/local')
    expect(popstate).toHaveBeenCalledTimes(1)
    expect(document.getElementById('__litro_data__')).toBeNull()
    document.getElementById(SPLASH_ID)?.remove()
    document.body.inert = false
  })

  it('shows the loading screen for that timeline until it has something to show', () => {
    window.addEventListener('popstate', () => {}, { once: true })
    replaceWithTimeline('/local')
    const splash = document.getElementById(SPLASH_ID)
    expect(splash?.dataset.target).toBe('/local')
    // The forward's own popstate keeps it.
    expect(splash?.isConnected).toBe(true)
    splash?.remove()
    document.body.inert = false
  })
})
