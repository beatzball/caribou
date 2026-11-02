import { describe, it, expect, vi, afterEach } from 'vitest'
import { DECIDED_ATTR, rootForwardTarget, replaceWithTimeline } from '../_root-forward.js'
import { ROOT_FORWARD_HEAD } from '../../server/lib/root-forward-head.js'

type Store = Record<string, string>

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
  return { getItem: (k: string) => (k in store ? store[k] : null) } as unknown as Storage
}

// Runs the head script on a document whose parser stopped in the head: no
// body yet. Timers and the `pageshow` listener are kept, to run by hand.
function runHeadScript(search: string, local: Store | null, session: Store | null) {
  const body = ROOT_FORWARD_HEAD.replace(/^<script>/, '').replace(/<\/script>$/, '')
  const location = { pathname: '/', search, replace: vi.fn() }
  const doc = document.implementation.createHTMLDocument('')
  doc.body.remove()
  const timers: Array<{ fn: () => void; ms: number }> = []
  const listeners: Record<string, (e: { persisted: boolean }) => void> = {}
  const win = { addEventListener: (type: string, fn: (e: { persisted: boolean }) => void) => { listeners[type] = fn } }
  new Function('location', 'localStorage', 'sessionStorage', 'document', 'window', 'setTimeout', body)(
    location, storage(local), storage(session), doc, win,
    (fn: () => void, ms: number) => { timers.push({ fn, ms }) },
  )
  return { location, doc, timers, listeners }
}

describe('rootForwardTarget (client check)', () => {
  it.each(CASES)('%s', (_name, search, local, session, expected) => {
    expect(rootForwardTarget(search, storage(local), storage(session))).toBe(expected)
  })
})

describe('ROOT_FORWARD_HEAD (inline script before first paint)', () => {
  it.each(CASES)('%s', (_name, search, local, session, expected) => {
    const { location, doc } = runHeadScript(search, local, session)
    if (expected) {
      expect(location.replace).toHaveBeenCalledWith(expected)
      expect(doc.documentElement.hasAttribute(DECIDED_ATTR)).toBe(false)
    } else {
      expect(location.replace).not.toHaveBeenCalled()
      // The page decided to stay; the router must not check again.
      expect(doc.documentElement.hasAttribute(DECIDED_ATTR)).toBe(true)
    }
  })

  it('after 3 s with the timeline not loaded, shows a way out instead of an empty tab', () => {
    const { doc, timers } = runHeadScript('', signedIn, {})
    expect(timers).toHaveLength(1)
    expect(timers[0]!.ms).toBe(3000)
    timers[0]!.fn()
    expect(doc.body?.textContent).toContain('Opening your timeline…')
    const links = Array.from(doc.body!.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')])
    expect(links).toEqual([['Open your timeline', '/home'], ['Sign in', '/?add']])
  })

  it('the way out links to the default timeline', () => {
    const { doc, timers } = runHeadScript('', withPrefs('{"defaultTimeline":"public"}'), {})
    timers[0]!.fn()
    expect(doc.body!.querySelector('a')!.getAttribute('href')).toBe('/public')
  })

  it('the 3 s fallback leaves a body that is already there alone', () => {
    const { doc, timers } = runHeadScript('', signedIn, {})
    const body = doc.createElement('body')
    body.textContent = 'parsed'
    doc.documentElement.append(body)
    timers[0]!.fn()
    expect(doc.body?.textContent).toBe('parsed')
  })

  it('sets no timer when it stays', () => {
    expect(runHeadScript('', {}, {}).timers).toHaveLength(0)
  })

  it('a / page back from the back-forward cache checks again', () => {
    const local: Store = {}
    const { location, listeners } = runHeadScript('', local, {})
    expect(location.replace).not.toHaveBeenCalled()
    Object.assign(local, signedIn) // signed in, in another tab
    listeners.pageshow!({ persisted: false })
    expect(location.replace).not.toHaveBeenCalled()
    listeners.pageshow!({ persisted: true })
    expect(location.replace).toHaveBeenCalledWith('/home')
  })

  it('a restored page that moved off / by client-side navigation stays', () => {
    const { location, listeners, timers } = runHeadScript('?add', signedIn, {})
    location.pathname = '/about'
    location.search = ''
    listeners.pageshow!({ persisted: true })
    expect(location.replace).not.toHaveBeenCalled()
    expect(timers).toHaveLength(0)
  })

  it('a restored /?add stays', () => {
    const { location, listeners } = runHeadScript('?add', signedIn, {})
    listeners.pageshow!({ persisted: true })
    expect(location.replace).not.toHaveBeenCalled()
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
  })
})
